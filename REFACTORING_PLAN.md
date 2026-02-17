# Hero-Lines Refactoring Plan

> **Date:** 2026-02-17  
> **Scope:** Full codebase — React + WebGL + Zustand app  
> **Goal:** Reduce duplication, improve type-safety, separate concerns, and prepare the codebase for future extensibility (e.g. 3D object support).

---

## 1 — Summary of Issues

| # | Area | Smell / Issue | Severity |
|---|------|--------------|----------|
| 1 | `ObjectControls.tsx` | **15 near-identical `onChange` blocks** — every control repeats the same 6-line pattern: read `selectedObjectId`, find object, compare, call `updateObject`. | 🔴 Critical |
| 2 | `DeviceBar.tsx` / `useAutoCycle.ts` | **Duplicated `applyTemplate` function** — same template-application logic exists in both files with only slight differences. | 🟠 High |
| 3 | `useRenderer.ts` | **Monolithic 170-line render hook** — transition interpolation, object mapping, scene snapshot, and animation-frame management all live in one function. | 🟠 High |
| 4 | `sceneStore.ts` | **Inline transition type** — `lastTransition` has a 10-line anonymous type definition instead of a named interface. The `from` snapshot duplicates `Vector3` inlined. | 🟡 Medium |
| 5 | `WebGLRenderer.ts` | **`any` casts for morph properties** — `(obj as any).shapeTypeNext` and `(obj as any).morphFactor` bypass TypeScript. Also contains leftover debug comments (lines 100–103). | 🟡 Medium |
| 6 | `deviceTemplates.ts` | **Doesn't reuse `Vector3`** — redefines `{ x: number; y: number; z: number }` three times in the `DeviceTemplate` interface. | 🟡 Medium |
| 7 | `index.css` | **287-line monolithic stylesheet** — all component styles live in one global file; no scoping, no CSS modules. | 🟡 Medium |
| 8 | `package.json` | **Unused dependency** — `@xzdarcy/react-timeline-editor` is still listed but no imports reference it (timeline feature was removed). | 🟡 Medium |
| 9 | `SceneControls.tsx` | **Stale closure risk** — `onChange` callbacks close over the `scene` variable from render time, but Leva is initialized with `[]` deps. Values may be stale when the user changes controls rapidly. | 🟡 Medium |
| 10 | `useAutoCycle.ts` | **`useRef<any>`** for `timeoutRef` — should be `ReturnType<typeof setTimeout> \| null`. Also uses stale closure for `applyTemplate`. | 🟢 Low |
| 11 | `types.ts` | **Factory function in types file** — `createDefaultObject()` is business logic, not a type definition. | 🟢 Low |
| 12 | `fragment.glsl` | **Extremely long single-expression lines** (lines 130, 135, 140) — hard to read/maintain. | 🟢 Low |
| 13 | `WebGLRenderer.ts` | **Magic numbers / maps** — `shapeMap` and `orientMap` are recreated on every `renderFrame` call. | 🟢 Low |
| 14 | `main.tsx` | **Missing `React.StrictMode`** wrapper. | 🟢 Low |

---

## 2 — Refactoring Tasks

Each task below is independent and can be taken by a different team member. They are ordered by priority (highest first). Every task follows the rule: **no external behavior change**.

---

### Task 1 ·  Extract `ObjectControls` onChange helper (DONE)

**File:** `src/components/ObjectControls.tsx`  
**Effort:** ~30 min  
**Impact:** Removes ~150 lines of duplication

**What to do:**

1. Create a helper function (inside the file or in a new `src/utils/levaHelpers.ts`):
   ```ts
   function objectOnChange<K extends keyof SceneObject>(
     key: K,
     updateObject: (id: string, patch: Partial<SceneObject>) => void,
   ) {
     return (value: SceneObject[K]) => {
       const state = useSceneStore.getState();
       const selId = state.selectedObjectId;
       if (!selId) return;
       const obj = state.objects.find(o => o.id === selId);
       if (obj && obj[key] !== value) {
         updateObject(selId, { [key]: value } as Partial<SceneObject>);
       }
     };
   }
   ```
2. Replace every `onChange` callback with a call to this helper.
3. For `Vector3` properties (`position`, `dimensions`, `rotation`), create a variant that does a deep compare on `.x .y .z`.
4. Verify: Open the Leva panel, change every control → store should update. Select a different object → Leva should sync.

---

### Task 2 ·  Deduplicate `applyTemplate` (DONE)

**Files:** `src/components/DeviceBar.tsx`, `src/hooks/useAutoCycle.ts`  
**Effort:** ~20 min

**What to do:**

1. Move the shared template-application logic to a new function in `src/store/sceneStore.ts` (as a store action) or `src/utils/templateUtils.ts`:
   ```ts
   export function applyDeviceTemplate(
     templateName: string,
     objectId: string,
     store: ReturnType<typeof useSceneStore.getState>,
   ) { ... }
   ```
2. Have both `DeviceBar.tsx` and `useAutoCycle.ts` call this shared function.
3. Verify: Click every device button manually. Toggle Auto Cycle on → verify all 4 devices are visited in order.

---

### Task 3 ·  Break up `useRenderer` hook (DONE)

**File:** `src/renderer/useRenderer.ts`  
**Effort:** ~45 min

**What to do:**

1. Extract a pure `interpolateTransition(from, to, progress)` function into `src/renderer/transition.ts`. It should accept the from-state, target-state, and a `[0,1]` progress value, returning the interpolated object + scene snapshot. This makes it unit-testable.
2. Extract the "rendered objects factory" (lines 72-86) into a separate function `buildRenderableObjects(objects)`.
3. Keep the effect + animation-frame management in `useRenderer` but have it call these extracted functions.
4. Verify: All transitions should look identical before/after. Camera zoom on scroll should still work.

---

### Task 4 ·  Type-safe morph properties (DONE)

**Files:** `src/types.ts`, `src/renderer/WebGLRenderer.ts`  
**Effort:** ~20 min

**What to do:**

1. Create a `RenderableObject` interface that extends `SceneObject` with `shapeTypeNext: ShapeType` and `morphFactor: number`.
2. Update `WebGLRenderer.renderFrame` to accept `RenderableObject[]` instead of `SceneObject[]`.
3. Remove all `(obj as any)` casts from `WebGLRenderer.ts`.
4. Update `useRenderer.ts` to build `RenderableObject[]` from the objects array.
5. Remove the leftover debug comments on lines 100–103 of `WebGLRenderer.ts`.

---

### Task 5 ·  Clean up `sceneStore` transition type (DONE)

**File:** `src/store/sceneStore.ts`, `src/types.ts`  
**Effort:** ~15 min

**What to do:**

1. Define a named `TransitionSnapshot` interface in `types.ts`:
   ```ts
   export interface TransitionSnapshot {
     position: Vector3;
     dimensions: Vector3;
     borderRadius: number;
     rotation: Vector3;
     shapeType: ShapeType;
     camera: Vector3;
     zoom: number;
   }

   export interface TransitionState {
     objectId: string;
     duration: number;
     timestamp: number;
     from: TransitionSnapshot | null;
   }
   ```
2. Replace the anonymous inline type in `sceneStore.ts` with `TransitionState | null`.
3. Verify: Device transitions should look identical.

---

### Task 6 ·  Reuse `Vector3` in `DeviceTemplate` (DONE)

**File:** `src/data/deviceTemplates.ts`  
**Effort:** ~5 min

**What to do:**

1. Import `Vector3` from `../types`.
2. Replace the 3 inline `{ x: number; y: number; z: number }` definitions in `DeviceTemplate` with `Vector3`.

---

### Task 7 ·  Fix stale closures in `SceneControls` (DONE)

**File:** `src/components/SceneControls.tsx`  
**Effort:** ~20 min

**What to do:**

1. Apply the same pattern used in `ObjectControls.tsx`: read fresh state via `useSceneStore.getState()` inside each `onChange` callback, instead of closing over `scene` from render time.
2. Verify: Rapidly change camera/zoom/bgColor → values should not revert or flicker.

---

### Task 8 ·  Remove unused dependency (DONE)

**File:** `package.json`  
**Effort:** ~2 min  

**What to do:**

1. Run: `npm uninstall @xzdarcy/react-timeline-editor` (DONE)
2. Verify: `npm run dev` still works. (VERIFIED)

---

### Task 9 ·  Split `index.css` into component-scoped files (DONE)

**File:** `src/index.css` → multiple files  
**Effort:** ~30 min

**What to do:**

1. Create CSS files next to each component:
   - `src/components/FPSCounter.css` (`.fps-counter`)
   - `src/components/DeviceBar.css` (`.template-bar`, `.template-btn`, `.template-icon`, `.template-label`)
   - `src/components/ObjectList.css` (`.object-list-panel` and all children)
2. Keep global layout & theme variables in `src/index.css`.
3. Import each CSS file in its corresponding component.
4. Verify: UI should look identical. Dark/light theme toggle should still work.

---

### Task 10 ·  Hoist static maps out of `renderFrame` (DONE)

**File:** `src/renderer/WebGLRenderer.ts`  
**Effort:** ~5 min

**What to do:**

1. Move `shapeMap` and `orientMap` to module-level constants (outside the class or as `private static readonly` members).
2. This avoids recreating them on every frame.

---

### Task 11 ·  Move `createDefaultObject` out of types (DONE)

**Files:** `src/types.ts` → `src/utils/objectFactory.ts`  
**Effort:** ~10 min

**What to do:**

1. Create `src/utils/objectFactory.ts` and move `createDefaultObject` there.
2. Update all import sites: `sceneStore.ts`, `migration.ts`.
3. `types.ts` should only contain type/interface definitions.

---

### Task 12 ·  Fix minor type issues (DONE)

**Files:** Various  
**Effort:** ~10 min

**What to do:**

1. `useAutoCycle.ts` line 14 — change `useRef<any>` to `useRef<ReturnType<typeof setTimeout> | null>(null)`.
2. `SceneControls.tsx` line 72 — remove the `as any` cast on the Leva config object.
3. `DeviceBar.tsx` line 1 — remove unused `useState` import.

---

### Task 13 ·  Add `React.StrictMode` (DONE)

**File:** `src/main.tsx`  
**Effort:** ~2 min

**What to do:**

1. Wrap the `<App />` component in `<React.StrictMode>`.
2. Verify: App should render without double-render issues.

---

## 3 — Dependency Graph

Tasks can be worked on in parallel unless noted below:

```
Task 1  ─┐
Task 7  ─┤ (both touch Leva onChange pattern — coordinate)
         │
Task 4  ─┤
Task 3  ─┤ (both touch renderer layer — Task 4 first, then Task 3)
         │
Task 5  ─┤
Task 6  ─┤ (both touch types.ts — merge PRs carefully)
Task 11 ─┘

Task 2, 8, 9, 10, 12, 13  — fully independent of each other and the above
```

---

## 4 — Out of Scope

The following items were observed but are **not** part of this refactoring pass:

- **Fragment shader readability** — long single-line expressions in `fragment.glsl` could benefit from line-breaks and comments, but changing shader code risks subtle rendering differences. Defer to a dedicated shader cleanup task.
- **Test infrastructure** — the project currently has no tests (`"test": "echo \"Error: no test specified\"` in `package.json`). Setting up Vitest / Testing Library is recommended as a follow-up but is not a refactoring task.
- **3D object file support** — per the existing implementation plan in a prior conversation. Separate feature work.
