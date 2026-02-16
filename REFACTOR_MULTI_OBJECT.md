# Multi-Object Canvas Refactoring Plan

> A step-by-step guide for the dev team to refactor **hero-lines** from a single-object app into a multi-object canvas.
> Each step is self-contained and can be taken as an individual PR.

---

## Table of Contents

1. [Current Architecture Overview](#1-current-architecture-overview)
2. [Step 1 — Extract GLSL Shaders](#step-1--extract-glsl-shaders)
3. [Step 2 — Define the Object Data Model](#step-2--define-the-object-data-model)
4. [Step 3 — Create a Scene Store (State Management)](#step-3--create-a-scene-store-state-management)
5. [Step 4 — Build a Multi-Object WebGL Renderer](#step-4--build-a-multi-object-webgl-renderer)
6. [Step 5 — Rebuild the Leva Panel (Per-Object Controls)](#step-5--rebuild-the-leva-panel-per-object-controls)
7. [Step 6 — Rebuild the Device Panel (Per-Object Templates)](#step-6--rebuild-the-device-panel-per-object-templates)
8. [Step 7 — Rebuild the Timeline (Per-Object Tracks)](#step-7--rebuild-the-timeline-per-object-tracks)
9. [Step 8 — Scene-Level UI (Object List, Add/Remove, Selection)](#step-8--scene-level-ui-object-list-addremove-selection)
10. [Step 9 — Update Import/Export for Multi-Object](#step-9--update-importexport-for-multi-object)
11. [Step 10 — Final Integration & Cleanup](#step-10--final-integration--cleanup)

---

## 1. Current Architecture Overview

Everything lives in a **single `App.tsx` (452 lines)**:
- **Inline GLSL shaders** — vertex + fragment source as template literals
- **One `useControls()` (Leva)** — a flat panel with folders: Transformations, Lines & Animation, Appearance, Transition
- **One `timelineData` state** — a flat array of `TimelineRow[]` with 21 property rows, all belonging to the single object
- **One `useEffect()` render loop** — sets up WebGL2 context, compiles shaders, and runs `requestAnimationFrame` with hardcoded uniform names
- **Device templates** — a `DEVICE_TEMPLATES` record that applies presets to the single global object
- **Import/Export** — serialises the single Leva state + timeline data to JSON

### Key Problems for Multi-Object
| Problem | Detail |
|---|---|
| Hardcoded uniforms | Each property is a single `u_boxSize`, `u_color1`, etc. — no per-object concept |
| Single draw call | One fullscreen quad with raymarching — cannot composite multiple objects |
| Flat Leva panel | Controls directly mutate the single object; no object selection |
| Flat timeline | All 21 rows belong to one object; no grouping or scoping |
| No data model | There is no "object" entity — state is spread across Leva + timeline + shader |

---

## Step 1 — Extract GLSL Shaders

**Goal:** Move shaders out of `App.tsx` into their own files so they can be imported and eventually parameterised.

### Tasks
- [ ] Create `src/shaders/vertex.glsl` — move `vsSource`
- [ ] Create `src/shaders/fragment.glsl` — move `fsSource`
- [ ] Add Vite raw import support: in `vite.config.ts`, ensure `?raw` imports work (they do by default in Vite 5)
- [ ] In `App.tsx`, replace the template literals with:
  ```ts
  import vsSource from './shaders/vertex.glsl?raw'
  import fsSource from './shaders/fragment.glsl?raw'
  ```
- [ ] Add a `src/shaders/index.ts` barrel export
- [ ] Verify the app still renders identically

### Why first?
This is a zero-risk refactor that immediately shrinks `App.tsx` by ~140 lines and makes the shader code editable with GLSL tooling.

---

## Step 2 — Define the Object Data Model

**Goal:** Create a TypeScript type that represents a single canvas object, with all its properties centralised.

### Tasks
- [ ] Create `src/types.ts` with the following types:

```ts
/** A unique object on the canvas */
export interface SceneObject {
  id: string                // uuid
  name: string              // user-visible label, e.g. "Box 1"
  visible: boolean          // can be toggled off

  // Transformation
  position: { x: number; y: number; z: number }  // NEW: world-space offset
  dimensions: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }

  // Shape
  shapeType: ShapeType
  borderRadius: number
  orientation: Orientation

  // Lines & Animation
  numLines: number
  thickness: number
  speed: number
  longevity: number
  ease: number

  // Appearance
  color1: string
  color2: string
  rimColor: string

  // Camera is SCENE-level, not per-object (see below)
}

export type ShapeType = 'Box' | 'Sphere' | 'Cone' | 'Torus' | 'Capsule' | 'Cylinder'
export type Orientation = 'Horizontal' | 'Vertical' | 'Depth' | 'Diagonal'

/** Scene-level state (shared across all objects) */
export interface SceneState {
  camera: { x: number; y: number; z: number }
  zoom: number
  bgColor: string
  transitionSpeed: number
  transitionEase: string
}

/** Timeline keyframe row, now scoped to an object */
export interface ObjectTimelineRow {
  objectId: string       // which SceneObject this row belongs to
  property: string       // e.g. 'boxX', 'rotY', 'color1'
  actions: TimelineAction[]
}
```

- [ ] Move existing `TimelineAction`, `TimelineRow`, `PropertyAction`, `PropertyRow` interfaces into this file
- [ ] Export a `createDefaultObject(): SceneObject` factory function with sensible defaults (current hardcoded values)

### Design Decisions
- **Camera & background** are scene-level, not per-object. There is one camera.
- **Position** is a new property — currently the single object is always at origin. Multi-object requires an offset.
- The `position` will be passed to the shader as a `u_position` uniform and subtracted in `map()`.

---

## Step 3 — Create a Scene Store (State Management)

**Goal:** Replace the implicit state (Leva + `useState` + refs) with an explicit store that holds the full scene.

### Tasks
- [ ] Install `zustand` (lightweight, works perfectly with React + imperative render loops):
  ```bash
  npm install zustand
  ```
- [ ] Create `src/store/sceneStore.ts`:

```ts
import { create } from 'zustand'
import { SceneObject, SceneState, ObjectTimelineRow, createDefaultObject } from '../types'

interface SceneStore {
  // Scene-level
  scene: SceneState
  setScene: (patch: Partial<SceneState>) => void

  // Objects
  objects: SceneObject[]
  selectedObjectId: string | null
  addObject: () => void
  removeObject: (id: string) => void
  duplicateObject: (id: string) => void
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  selectObject: (id: string | null) => void
  getSelectedObject: () => SceneObject | undefined

  // Timeline
  timelineRows: ObjectTimelineRow[]
  setTimelineRows: (rows: ObjectTimelineRow[]) => void
  captureKeyframe: (time: number) => void
}
```

- [ ] Migrate the current hardcoded defaults as the initial state:
  - One default object (matching current Leva defaults)
  - Scene state (camera, zoom, bgColor, transition)
  - Timeline rows scoped to that object
- [ ] The store should be **subscribable imperatively** (for the render loop) — Zustand supports `store.getState()` without React re-renders

### Why Zustand?
- Minimal boilerplate.
- Can read state inside `requestAnimationFrame` without React hooks (`useRef` pattern is no longer needed).
- Framework-agnostic subscribe for the WebGL renderer.

---

## Step 4 — Build a Multi-Object WebGL Renderer

**Goal:** Refactor the render loop to iterate over `objects[]` and draw each one.

### High-Level Approach
The current shader raymarches **one** SDF against a fullscreen quad. For multi-object, the options are:

| Approach | Complexity | Quality |
|---|---|---|
| **A — Multi-pass compositing** (one draw call per object, blend results) | Medium | Good — preserves per-object raymarching |
| B — Single-pass union SDF | High | Best — but requires dynamic shader generation for N objects |
| C — Instanced rendering | Low | Limited — doesn't work well with raymarching |

**Recommended: Approach A (Multi-pass compositing)**

### Tasks
- [ ] Create `src/renderer/WebGLRenderer.ts` — a class that owns the GL context:
  ```ts
  class WebGLRenderer {
    private gl: WebGL2RenderingContext
    private program: WebGLProgram
    private uniforms: Record<string, WebGLUniformLocation>

    constructor(canvas: HTMLCanvasElement) { /* compile shaders, setup buffers */ }

    renderFrame(scene: SceneState, objects: SceneObject[], time: number) {
      // Clear with bgColor
      // For each visible object:
      //   1. Set per-object uniforms (position, dimensions, rotation, colors, etc.)
      //   2. Draw fullscreen quad
      //   3. Blend additively (gl.blendFunc(gl.ONE, gl.ONE))
    }

    resize(width: number, height: number) { /* ... */ }
    dispose() { /* cleanup */ }
  }
  ```
- [ ] **Modify the fragment shader** to support `u_position`:
  ```glsl
  uniform vec3 u_position;
  // In main():
  //   Offset the ray origin: ro_l -= u_position;
  //   Or equivalently offset p in map()
  ```
- [ ] Enable additive blending between object passes:
  ```ts
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  ```
- [ ] Create `src/renderer/useRenderer.ts` — a React hook that:
  - Creates the `WebGLRenderer` on mount
  - Subscribes to the Zustand store
  - Runs `requestAnimationFrame` loop calling `renderer.renderFrame()`
  - Handles resize and cleanup
- [ ] Remove the old `useEffect` render loop from `App.tsx`

### Shader Change Detail
Add to fragment shader uniforms:
```glsl
uniform vec3 u_position;
```
In `main()`, offset the local-space ray:
```glsl
vec3 ro_local = mI * (u_camPos - u_position);
```
This shifts each object to its own position.

---

## Step 5 — Rebuild the Leva Panel (Per-Object Controls)

**Goal:** The Leva panel should show controls for the **currently selected object**, plus scene-level controls.

### Tasks
- [ ] Create `src/components/ObjectControls.tsx`:
  - Uses `useControls()` with a **dynamic store key** based on `selectedObjectId`
  - When the selected object changes, the panel re-renders with that object's values
  - On change, calls `store.updateObject(id, patch)`
- [ ] Create `src/components/SceneControls.tsx`:
  - Camera, zoom, bgColor, transition settings
  - Calls `store.setScene(patch)`
- [ ] **Sync strategy**: Leva's `set()` is used to push store values → Leva when selection changes. Leva's `onChange` pushes Leva → store.
- [ ] Remove the old `useControls()` from `App.tsx`

### Leva Dynamic Store Pattern
```tsx
// ObjectControls.tsx
const obj = useSceneStore(s => s.objects.find(o => o.id === s.selectedObjectId))

const [, set] = useControls(
  () => ({
    Transformations: folder({
      position: { value: obj?.position ?? {x:0,y:0,z:0}, step: 0.1 },
      dimensions: { value: obj?.dimensions ?? {x:1,y:1,z:1}, step: 0.05 },
      rotation: { value: obj?.rotation ?? {x:0,y:0,z:0}, step: 1 },
    }),
    // ... other folders
  }),
  { store: levaStore },  // use a named store to control it
  [selectedObjectId]  // re-create when selection changes
)
```

---

## Step 6 — Rebuild the Device Panel (Per-Object Templates)

**Goal:** Device templates apply to the **selected object**, not to global state.

### Tasks
- [ ] Create `src/components/DeviceBar.tsx`:
  - Renders the same template buttons (Smartwatch, Mobile, Tablet, Laptop, Demo All)
  - On click, applies the template to the **selected object** via `store.updateObject()`
  - "Demo All" cycles templates on the selected object
  - If no object is selected, show a disabled state or toast
- [ ] Move `DEVICE_TEMPLATES` into `src/data/deviceTemplates.ts`
- [ ] Update the template shape to match `Partial<SceneObject>` (instead of raw Leva values):
  ```ts
  export const DEVICE_TEMPLATES: Record<string, Partial<SceneObject>> = {
    Smartwatch: {
      dimensions: { x: 0.8, y: 1.0, z: 0.3 },
      borderRadius: 0.35,
      shapeType: 'Box',
    },
    // ... camera and zoom stay at scene level
  }
  ```
- [ ] The transition animation logic (`transitionRef`) should move into the store or a dedicated `src/utils/transition.ts` utility
- [ ] Remove the old template bar from `App.tsx`

---

## Step 7 — Rebuild the Timeline (Per-Object Tracks)

**Goal:** The timeline should show tracks **grouped by object**, with the ability to expand/collapse each object's tracks.

### Tasks
- [ ] Create `src/components/TimelinePanel.tsx`:
  - Reads `timelineRows` from the store, grouped by `objectId`
  - Renders a collapsible header per object (click to expand/collapse)
  - Each object's tracks are the same 21 properties as today, but prefixed with the object name (e.g. `Box 1 / rotX`)
  - Keeps the existing Play/Pause, Capture, Reset, Export, Import buttons
- [ ] Create `src/components/TimelineToolbar.tsx` — extracted toolbar (play, capture, reset, etc.)
- [ ] Update `safeInterpolate` to accept `objectId`:
  ```ts
  function interpolateProperty(
    rows: ObjectTimelineRow[],
    objectId: string,
    property: string,
    time: number,
    defaultValue: any
  ): any
  ```
  Move this to `src/utils/interpolation.ts`
- [ ] Update the render loop to call `interpolateProperty` per object
- [ ] The "Capture Keyframe" button should capture **all objects** (or only the selected one — decide with team)
- [ ] Remove the old timeline JSX from `App.tsx`

### Timeline Data Migration
Old format:
```ts
[{ id: 'boxX', actions: [...] }, ...]  // flat, one object assumed
```
New format:
```ts
[{ objectId: 'obj-1', property: 'boxX', actions: [...] }, ...]
```

---

## Step 8 — Scene-Level UI (Object List, Add/Remove, Selection)

**Goal:** Add a sidebar or overlay that lists all objects and allows CRUD operations.

### Tasks
- [ ] Create `src/components/ObjectList.tsx`:
  - Lists all objects by name
  - Click to select (highlights, Leva panel updates)
  - Right-click or button to delete
  - Visibility toggle (eye icon)
  - Drag-to-reorder (optional, can defer)
- [ ] Create `src/components/AddObjectButton.tsx`:
  - "+" button, adds a new object with defaults at a random offset position
  - The new object becomes selected
- [ ] Create `src/components/DuplicateObjectButton.tsx`:
  - Copies the selected object (with new ID, offset position, appended name)
- [ ] Style the object list with the same glassmorphism aesthetic as `template-bar`

### Proposed Layout
```
┌──────────────────────────────────────────────┐
│  [FPS]     [Device Templates]     [+/-]      │  ← top bar
├────────┬─────────────────────────────────────┤
│ Object │                                     │
│  List  │           Canvas                    │  ← main area
│ ────── │                                     │
│ □ Box1 │                                     │
│ ■ Box2 │                                     │
│   [+]  │                                     │
├────────┴─────────────────────────────────┬───┤
│  [▶ Play] [Capture] [Reset]              │   │  ← timeline
│  ─ Box 1 ──────────────────────          │Lva│
│    boxX  ◆────────◆──────◆               │   │
│    rotY  ◆──────────────◆                │   │
│  ─ Box 2 ──────────────────────          │   │
│    boxX  ◆────◆                          │   │
└──────────────────────────────────────────┴───┘
```

---

## Step 9 — Update Import/Export for Multi-Object

**Goal:** The JSON format should support N objects with their individual timelines.

### Tasks
- [ ] Update `handleExport` to serialise:
  ```json
  {
    "version": 2,
    "scene": { "camera": {...}, "zoom": 1, "bgColor": "#000" },
    "objects": [
      { "id": "...", "name": "Box 1", ... },
      { "id": "...", "name": "Box 2", ... }
    ],
    "timeline": [
      { "objectId": "...", "property": "boxX", "actions": [...] },
      ...
    ]
  }
  ```
- [ ] Update `handleImport` to:
  - Detect `version` field → if missing, treat as legacy single-object format and migrate
  - Validate `objects` array
  - Replace the entire store state
- [ ] Create `src/utils/migration.ts`:
  - `migrateV1ToV2(legacyData)` — wraps old flat data into one object + scoped timeline
- [ ] Move export/import logic to `src/utils/io.ts`

---

## Step 10 — Final Integration & Cleanup

**Goal:** Wire everything together in a clean `App.tsx` that is mostly composition.

### Tasks
- [ ] Rewrite `App.tsx` as a thin shell:
  ```tsx
  export default function App() {
    const canvasRef = useRef(null)
    useRenderer(canvasRef)  // custom hook handles the render loop

    return (
      <div className="app">
        <canvas ref={canvasRef} />
        <FPSCounter />
        <DeviceBar />
        <ObjectList />
        <ObjectControls />
        <SceneControls />
        <TimelinePanel />
      </div>
    )
  }
  ```
- [ ] Delete all old inline code from `App.tsx`
- [ ] Move CSS from `index.css` into component-scoped CSS modules or a shared `styles/` directory
- [ ] Final file structure should look like:
  ```
  src/
  ├── App.tsx                    (~30 lines, composition only)
  ├── main.tsx
  ├── types.ts                   (data model)
  ├── store/
  │   └── sceneStore.ts          (Zustand store)
  ├── shaders/
  │   ├── vertex.glsl
  │   ├── fragment.glsl
  │   └── index.ts
  ├── renderer/
  │   ├── WebGLRenderer.ts       (imperative GL class)
  │   └── useRenderer.ts         (React hook)
  ├── components/
  │   ├── ObjectList.tsx
  │   ├── ObjectControls.tsx
  │   ├── SceneControls.tsx
  │   ├── DeviceBar.tsx
  │   ├── TimelinePanel.tsx
  │   ├── TimelineToolbar.tsx
  │   ├── AddObjectButton.tsx
  │   └── FPSCounter.tsx
  ├── utils/
  │   ├── interpolation.ts       (safeInterpolate, extracted)
  │   ├── transition.ts          (device transition animation)
  │   ├── io.ts                  (import/export)
  │   └── migration.ts           (v1 → v2 format)
  ├── data/
  │   └── deviceTemplates.ts
  └── styles/
      └── index.css
  ```
- [ ] Verify the app renders correctly with one object (parity with current version)
- [ ] Test adding a second object and rendering both
- [ ] Test import of old v1 JSON files (backwards compatibility)

---

## Suggested PR Order

| PR | Step | Risk | Reversible? |
|---|---|---|---|
| **PR 1** | Step 1 (Extract shaders) | 🟢 None | Yes |
| **PR 2** | Step 2 (Data model) | 🟢 None (types only) | Yes |
| **PR 3** | Step 3 (Zustand store) | 🟡 Medium (state migration) | Revert store |
| **PR 4** | Step 4 (Renderer) | 🟡 Medium (GL changes) | Swap renderer |
| **PR 5** | Steps 5+6 (Leva + Device panel) | 🟡 Medium (UI rebuild) | Feature flag |
| **PR 6** | Step 7 (Timeline) | 🟡 Medium (UI rebuild) | Feature flag |
| **PR 7** | Step 8 (Object list UI) | 🟢 Low (additive) | Yes |
| **PR 8** | Step 9 (Import/Export) | 🟢 Low | Yes |
| **PR 9** | Step 10 (Cleanup) | 🟢 Low | Yes |

---

## Notes for the Team

- **Do NOT attempt all steps at once.** Each step should end with a working app.
- **Step 3 is the pivot point** — once the store exists, the rest is wiring.
- The shader change in Step 4 (adding `u_position`) is tiny but critical — test thoroughly.
- Leva has quirks with dynamic stores. If issues arise, consider `leva`'s `useStoreContext` or switching to `dat.gui` / a custom panel.
- The current `@xzdarcy/react-timeline-editor` library may need to be extended or replaced if per-object grouping proves difficult. Evaluate after Step 7.
