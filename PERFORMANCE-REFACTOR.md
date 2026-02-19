# Performance Refactor Plan

> **Goal:** Reduce fragment-shader compute load for smoother preview and lighter exports.
> The bottleneck is pure GPU fill-rate: a heavy raymarch loop runs for every pixel of a fullscreen quad.

---

## P0 — High Impact, Low Effort

### 1. Adaptive ray-step counts

**Problem:** Fixed 64 front + 32 back steps per pixel regardless of scene complexity.

**Changes** — `fragment.glsl`

```diff
- for(int i=0; i<64; i++) {
+ #ifndef MAX_STEPS
+ #define MAX_STEPS 64
+ #endif
+ for(int i=0; i<MAX_STEPS; i++) {
```

- Expose `MAX_STEPS` / `MAX_BACK_STEPS` as `#define`s injected at compile time.
- **Preview**: compile with `MAX_STEPS 40`, `MAX_BACK_STEPS 16` (or lower when FPS drops).
- **Export**: compile with `MAX_STEPS 64`, `MAX_BACK_STEPS 32` for full quality.
- The early-out for simple shapes (`if (u_compositeMode == 0 && i >= 16) break;` on back pass) already exists — extend this pattern to the front pass too.

**Files:** `fragment.glsl`, `WebGLRenderer.ts` (inject defines), `snapshotRenderer.ts` (export path).

---

### 2. Increase SDF hit threshold (adaptive epsilon)

**Problem:** `0.001` is overkill for screen preview — causes micro-stepping near surfaces.

```diff
- if(d < 0.001) { hit = true; break; }
+ if(d < HIT_EPS) { hit = true; break; }
```

- Preview: `HIT_EPS = 0.005` (barely noticeable at ≤1080p).
- Export: `HIT_EPS = 0.001` for sharp edges.
- Inject via `#define` alongside step counts.

**Files:** `fragment.glsl`, `WebGLRenderer.ts`, `snapshotRenderer.ts`.

---

### 3. Cheaper normal calculation (2-sample → tetrahedral already, but skip when possible)

**Problem:** `calcNormalBent()` calls `mapBody()` 4 times per hit pixel.

**Options (pick one):**

| Option | Saves | Trade-off |
|--------|-------|-----------|
| **A.** Skip normals for back-face pass — use `-rd` instead | 4 SDF evals on back hit | Slight rim/shading difference on back face |
| **B.** Central-difference normals (2 evals) | 2 SDF evals per hit | Slightly less accurate for sharp bevels |
| **C.** Screen-space depth normals via `dFdx`/`dFdy` | 4 SDF evals per hit | Faceted look on glancing angles |

**Recommendation:** Option **A** for both preview and export (back-face rim lighting is subtle and rarely noticed). Option **B** can be added behind a `#define` for preview mode.

**Files:** `fragment.glsl`.

---

### 4. Resolution scaling (already wired — tighten the range)

**Problem:** `resolutionScale` exists in `SceneState` and `useRenderer.ts` but defaults to `1.0`.

- Default preview to `0.75` (≈56% fewer pixels).
- Let the user slide down to `0.5` for low-end GPUs.
- Export always renders at `1.0`.
- Consider **auto-adaptive**: if FPS < 30 for 2+ seconds, reduce scale by 0.1 (floor 0.5).

**Files:** `store/sceneStore.ts` (default), `useRenderer.ts` (adaptive logic), `SceneControls.tsx` (UI label/range).

---

## P1 — High Impact, Medium Effort

### 5. Skip backface pass when front alpha ≥ 1

**Problem:** The backface raymarch runs even when the front surface is fully opaque.

The check `if (alpha < 0.95)` exists — but `getSurfaceColor` often returns low alpha for "gap" between animated lines. Two improvements:

- **Early box-miss:** if `tBox.y < 0`, skip immediately (already done).
- **Track cumulative alpha** through both passes and break as soon as `alpha >= 0.99`.
- Expose a toggle `u_enableBackface` uniform — allow users to disable the back pass entirely for simpler looks.

**Files:** `fragment.glsl`, `types.ts`, `WebGLRenderer.ts`, `snapshotRenderer.ts`.

---

### 6. SDF function specialization (reduce branching)

**Problem:** `getShapeDist()` and `mapBody()` contain `if shapeType == ...` chains evaluated per ray step.

**Options:**

| Option | Effort | Savings |
|--------|--------|---------|
| **A.** Pre-compile separate shader variants per shape | High | Eliminates all branches |
| **B.** Move branching outside inner loop via `#define SHAPE_TYPE` | Medium | Eliminates most branches |
| **C.** Keep branches, add `early return` in `mapBody` when `compositeMode == 0` and `morphFactor == 0` | Low | Avoids secondary SDF + morph path |

**Recommendation:** Start with **C** (trivial). Consider **B** later if profiling shows branch divergence is a measurable problem.

For option **C** in `mapBody()`:

```glsl
float mapBody(vec3 pBent, vec3 boxSize, float radius) {
    // Fast path: no morph, no composite
    if (u_morphFactor <= 0.0 && u_compositeMode == 0) {
        return getShapeDist(pBent, boxSize, radius, u_shapeType);
    }
    // ... existing slow path
}
```

**Files:** `fragment.glsl`.

---

### 7. Tighter bounding-box for scissor test

**Problem:** Scissor margin is `2.0×` object dimensions — wastes pixels on simple shapes.

- When `bendAmount ≈ 0` and `compositeMode == None`, reduce margin to `1.2×`.
- When bend/composite active, keep `2.0×`.
- This saves up to ~40% fragment invocations for centered objects.

**Files:** `WebGLRenderer.ts` (`calculateScissorRect`), `snapshotRenderer.ts`.

---

## P2 — Medium Impact, Medium Effort

### 8. Distance-based step acceleration

**Problem:** Ray marches with constant `t += d;` — near-miss rays creep slowly.

Add over-stepping for rays far from the surface:

```glsl
float stepScale = (d > 0.1) ? 1.5 : 1.0;
t += d * stepScale;
```

Small risk of stepping through thin features — mitigate by clamping `stepScale` when `d` is decreasing.

**Files:** `fragment.glsl`.

---

### 9. `fwidth()` caching

**Problem:** `fwidth(sliceCoord)` is called inside `getSurfaceColor`, which runs for every hit pixel (front + back).

- Compute `fwidth` once per fragment in `main()` and pass it in, or compute it once in `render()` before calling `getSurfaceColor`.

**Files:** `fragment.glsl`.

---

### 10. Skip `opBend` when bend is zero

**Problem:** `opBend` already has `if (abs(k) < 0.001) return p;` — but it's still called twice (front + back) per pixel.

- Move the check to the call site in `map()` to avoid the function call overhead entirely:

```glsl
float map(vec3 p, vec3 boxSize, float radius) {
    vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, ...);
    return mapBody(pBent, boxSize, radius);
}
```

This is a micro-optimization but applied billions of times per frame.

**Files:** `fragment.glsl`.

---

## P3 — Nice-to-Have / Future

### 11. Half-resolution pre-pass

Render a half-res depth-only pass first, then only evaluate the full shader for pixels near the surface. Complex to implement in WebGL2 (requires render-to-texture + second pass).

### 12. Temporal reprojection

Reuse SDF results from the previous frame for static scenes. Only useful when animation is paused / slow.

### 13. Bounding-volume hierarchy for composite shapes

When `compositeMode != None`, compute a tighter per-primitive bounding box to early-reject one of the two SDFs.

---

## Implementation Order

| Phase | Items | Expected FPS Gain |
|-------|-------|-------------------|
| **Phase 1** | #1, #2, #4, #6C, #10 | ~40–60% faster preview |
| **Phase 2** | #3A, #5, #7 | ~20–30% additional |
| **Phase 3** | #8, #9 | ~5–10% additional |
| **Future** | #11, #12, #13 | Situational |

---

## Preview vs Export Quality Matrix

| Parameter | Preview (Default) | Export |
|-----------|--------------------|--------|
| `MAX_STEPS` | 40 | 64 |
| `MAX_BACK_STEPS` | 16 | 32 |
| `HIT_EPS` | 0.005 | 0.001 |
| `resolutionScale` | 0.75 | 1.0 |
| Back-face normals | Use `-rd` | Full `calcNormalBent` |
| Scissor margin | 1.2× (simple) / 2.0× (complex) | 2.0× |

---

## Verification

- **A/B FPS comparison**: toggle each optimization behind `#define` flags and compare FPS with the Leva FPS counter already in the app.
- **Visual diff**: screenshot before/after each change at export quality — ensure no visible degradation.
- **Export test**: export a Web Component, open in browser, verify animation runs smoothly and looks identical to the current export.
