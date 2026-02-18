# WebGL Performance Audit — hero-lines

> **Date**: 2026-02-18
> **Scope**: Full rendering pipeline (`WebGLRenderer.ts`, `useRenderer.ts`, `fragment.glsl`, `svgParser.ts`, `SvgSdfManager.ts`, `renderUtils.ts`, `sceneStore.ts`)

---

## Architecture Summary

The renderer is a **fullscreen-quad raymarcher**. Every visible object triggers a separate `drawArrays(TRIANGLES, 0, 6)` call that evaluates the SDF for every pixel on screen. The fragment shader runs a 64-step front-pass and a 32-step back-pass ray march, plus 4 `map()` calls for `calcNormal`. With N objects on screen, the total per-pixel SDF evaluations scale as **N × (64 + 32 + 4) × map() cost**.

---

## Findings & Improvement Steps

### 🔴 P0 — Critical (largest FPS impact)

#### 1. Multi-Object Rendering: Full-Screen Pass Per Object
**File**: `WebGLRenderer.ts:150-232` · `fragment.glsl:main()`

**Problem**: Each object draws a fullscreen quad. With 5 objects in "Infinite Pass" mode, _every pixel_ runs the full fragment shader 5×. Most of these pixels hit nothing.

**Steps**:
1. Compute a 2D **screen-space bounding rect** for each object (project the 3D AABB corners to clip space) and set `gl.scissor()` / `gl.enable(gl.SCISSOR_TEST)` before each draw call. Pixels outside the bounding rect are skipped entirely.
2. Consider sorting objects front-to-back and using early-out via `discard` when a pixel has been fully resolved by a closer object.
3. Long-term: batch all objects into a **single draw call** by passing object data as a UBO or SSBO array and looping inside the shader, using the scissored tile approach per cluster.

---

#### 2. Chromatic Aberration: 3× Full Render Cost
**File**: `fragment.glsl:405-416`

**Problem**: When `u_chromaticAberration > 0`, `render()` is called **three times** — once per RGB channel. This triples the already-expensive raymarching work.

**Steps**:
1. Replace with a **single-pass approximation**: render once with the green ray, then apply a post-process UV offset to the R and B channels using a 2-tap texture sample. This requires rendering to an FBO first, then doing a final fullscreen blit with the offset.
2. Alternatively, offset only the ray _origin_ (not direction) and do 3× only for the _first intersection test_, sharing the normals and surface color computation.

---

#### 3. `calcNormal` Is Expensive (4 extra `map()` calls per hit)
**File**: `fragment.glsl:301-305`

**Problem**: Central-difference normal estimation calls `map()` four times with offset positions. Each `map()` call involves bending, pulse scaling, composite SDF evaluation, and optional wobble noise.

**Steps**:
1. Use **tetrahedron gradient** estimation (already in use — just confirm 4 taps, which is optimal for tetrahedron method).
2. Cache the `opBend` result: pass the already-bent `p` into `calcNormal` so the bend is not recomputed 4 extra times. Currently `calcNormal` calls `map()` which calls `opBend()` internally, so each normal costs 4 extra bend operations.
3. If normals are only needed for rim lighting and surface orientation, consider a **rougher estimate** (e.g., 2 taps along the dominant axis).

---

### 🟡 P1 — High (noticeable improvement)

#### 4. Raymarching Step Count Is Fixed
**File**: `fragment.glsl:355, 377`

**Problem**: Front pass always runs 64 steps, back pass 32 steps, regardless of scene complexity. Simple shapes (sphere, box) converge in ~10 steps but the loop keeps running.

**Steps**:
1. Add an **adaptive step threshold**: if the SDF distance is larger than a threshold (e.g., `> 5.0`), multiply the step by a relaxation factor (`t += d * 1.5`) for over-relaxation.
2. Reduce the back-pass to 16 steps for non-composite shapes.
3. Use the bounding box intersection `tBox` range to compute a tighter starting `t`, which is already done — just validate the box multiplier `1.5×` in `intersectBox` isn't too generous.

---

#### 5. Per-Frame Object Cloning
**File**: `renderUtils.ts:7-17` · `useRenderer.ts:59`

**Problem**: `buildRenderableObjects()` creates a new object array with cloned `position`, `dimensions`, `rotation`, and `svgData` every single frame via spread. At 60 FPS with 5 objects, that's 300 object allocations + 1200 sub-object allocations per second, generating GC pressure.

**Steps**:
1. **Pre-allocate** a reusable `RenderableObject[]` buffer and mutate it in-place each frame instead of cloning.
2. Copy scalar properties only on change (use a dirty flag or version counter on each `SceneObject`).
3. Since React reconciliation doesn't see these objects (they're only used for GL), there's no need for immutability here.

---

#### 6. Uniform Upload Overhead (40+ `gl.uniform*` calls per object per frame)
**File**: `WebGLRenderer.ts:150-232`

**Problem**: Per object, ~40 individual `gl.uniform*` calls are made. While each call is fast, the cumulative driver overhead is non-trivial, especially with multiple objects.

**Steps**:
1. Pack per-object data into a **Uniform Buffer Object (UBO)** with a single `gl.bufferSubData()` call per object. Group related uniforms (e.g., all `vec3`s together, then all `float`s) to respect `std140` alignment.
2. Scene-level uniforms (`u_time`, `u_resolution`, `u_camPos`, `u_bgColor`) should be in a separate UBO that's updated once per frame.
3. Short-term: at minimum, skip updating uniforms that haven't changed since the last frame (maintain a shadow state for each object).

---

#### 7. Zustand `getState()` Called Every Frame
**File**: `useRenderer.ts:40`

**Problem**: `useSceneStore.getState()` is called inside `requestAnimationFrame`. While Zustand's `getState()` is cheapish, it forces a full destructure of the store including transition data, even if nothing changed.

**Steps**:
1. Use **Zustand `subscribe`** to react only to changes: maintain a local ref that is updated via a subscription, and read from the ref in the render loop.
2. Alternatively, use `subscribeWithSelector` to subscribe only to `scene` and `objects` slices.

---

### 🟢 P2 — Medium (quality-of-life / edge cases)

#### 8. SVG SDF Brute-Force Distance Transform
**File**: `svgParser.ts:120-159`

**Problem**: `computeSdf()` uses an O(n² · spread²) brute-force search. For a 512×512 texture with spread=32, that's ~512² × 64² ≈ 1.1 billion iterations. This blocks the main thread during SVG load.

**Steps**:
1. Replace with a **Jump Flood Algorithm (JFA)** or **parallel EDT (8SSEDT)** which run in O(n² log n) time.
2. Move the computation to a **Web Worker** to avoid blocking the main thread.
3. Consider computing the SDF on the GPU via a multi-pass shader (JFA maps perfectly to fragment shaders).

---

#### 9. Canvas Resize Sets Full `window.innerWidth`
**File**: `useRenderer.ts:153-158`

**Problem**: Canvas is always set to full device resolution. On Retina/HiDPI displays this means 4× the pixel count (e.g., 5120×2880 on a 5K display), all fed through an expensive raymarcher.

**Steps**:
1. Apply a **resolution scale factor** (e.g., `0.5` to `1.0`) that can be controlled by the user or auto-detected:
   ```ts
   const scale = window.devicePixelRatio > 1 ? 0.5 : 1.0;
   canvas.width = window.innerWidth * scale;
   canvas.height = window.innerHeight * scale;
   ```
2. Use CSS to stretch the canvas back to fill the viewport: `canvas.style.width = '100%'; canvas.style.height = '100%';`
3. Expose this as a "Quality" slider in the UI.

---

#### 10. `OES_texture_float_linear` Extension Queried Per Upload
**File**: `WebGLRenderer.ts:114`

**Problem**: `gl.getExtension('OES_texture_float_linear')` is called every time `uploadSvgSdfTexture` runs. Extension queries are cheap but redundant.

**Steps**:
1. Query the extension once in the constructor and cache the result.

---

#### 11. Duplicate `requestAnimationFrame` Loop (FPSCounter)
**File**: `FPSCounter.tsx:9-24` · `useRenderer.ts:150`

**Problem**: `FPSCounter` runs its own independent `requestAnimationFrame` loop just to count frames. This means two rAF callbacks are in flight every frame.

**Steps**:
1. Expose a frame counter from the renderer and read it in `FPSCounter` instead of running a separate loop.
2. Or, consolidate into a single rAF loop that both renders and updates the FPS count.

---

#### 12. RendererView Re-Renders on Zoom Change
**File**: `RendererView.tsx:7, 26`

**Problem**: `useSceneStore()` is called with full store subscription. The wheel handler references `scene.zoom`, causing the React component to re-render on every zoom change. The canvas is already managed by WebGL and doesn't need React re-renders.

**Steps**:
1. Use `useSceneStore.getState()` inside the wheel callback instead of binding `scene` to React state:
   ```tsx
   const wheel = (e: WheelEvent) => {
     e.preventDefault();
     const { scene, setScene } = useSceneStore.getState();
     setScene({ zoom: Math.max(0.1, Math.min(2.0, scene.zoom - e.deltaY * 0.001)) });
   };
   ```
2. Remove the `scene` dependency from the effect to avoid re-installing the event listener on every zoom.

---

### 🔵 P3 — Low (future optimizations)

#### 13. Shader Branching on Shape Type
**File**: `fragment.glsl:233-247`

**Problem**: `getShapeDist()` uses a chain of `if` statements to select the SDF function. On some GPUs this causes warp divergence.

**Steps**:
1. For the common case of a single shape type in a scene, set a `#define` at compile time and build specialized shader variants (e.g., box-only, sphere-only).
2. Alternatively, restructure as a switch statement — most modern drivers optimize `switch` better than `if-else` chains.

---

#### 14. Wire Color: Complex Box-Only Branch in Surface Shader
**File**: `fragment.glsl:337`

**Problem**: The wire-frame edge detection for boxes is a long expression evaluated for every pixel's surface color, even for non-box shapes and when `wireIntensity = 0`.

**Steps**:
1. Guard the wire calculation with `if (u_shapeType == 0 && u_wireIntensity > 0.0)`.
2. Extract into a separate function for readability and potential compiler optimization.

---

#### 15. `hexToRgb` Color Conversion at Render Time
**File**: `WebGLRenderer.ts:222-228`

**Problem**: Three color conversions per object per frame. While cached, the cache lookup still happens every frame.

**Steps**:
1. Convert colors to `[r, g, b]` at the **store level** when the user changes them, and pass pre-converted values to the renderer.
2. Store colors as `Float32Array(3)` in the `SceneObject` to eliminate object creation and cache lookups entirely.

---

## Priority Summary

| Priority | Item | Estimated Impact | Effort |
|----------|------|-----------------|--------|
| 🔴 P0 | Scissor-rect per object | Very High | Low |
| 🔴 P0 | Fix chromatic aberration (3× cost) | Very High | Medium |
| 🔴 P0 | Optimize `calcNormal` bend redundancy | High | Low |
| 🟡 P1 | Adaptive ray step count | High | Low |
| 🟡 P1 | Eliminate per-frame object cloning | Medium | Low |
| 🟡 P1 | Uniform Buffer Objects | Medium | Medium |
| 🟡 P1 | Zustand subscription optimization | Medium | Low |
| 🟢 P2 | JFA/Worker for SVG SDF | High (load time) | Medium |
| 🟢 P2 | Resolution scaling / DPR handling | High (HiDPI) | Low |
| 🟢 P2 | Cache `OES_texture_float_linear` | Trivial | Trivial |
| 🟢 P2 | Consolidate rAF loops | Low | Low |
| 🟢 P2 | Fix RendererView re-renders | Low | Low |
| 🔵 P3 | Shader specialization per shape | Medium | High |
| 🔵 P3 | Guard wire color branch | Low | Trivial |
| 🔵 P3 | Pre-convert colors at store level | Low | Low |

---

## Measurement Plan

Before implementing any change, establish baselines:

1. **GPU frame time**: use `EXT_disjoint_timer_query_webgl2` to measure actual GPU time per frame.
2. **FPS under load**: use the existing `FPSCounter` with 1, 3, and 5 objects on screen.
3. **Chrome DevTools Performance tab**: record a 5-second trace to identify long tasks and GC pauses.
4. **Spector.js**: capture a single frame to inspect draw calls, state changes, and uniform uploads.

After each optimization, re-measure against the baseline and log the delta.
