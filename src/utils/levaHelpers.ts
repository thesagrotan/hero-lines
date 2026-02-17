import { useSceneStore } from '../store/sceneStore';
import { SceneObject, Vector3 } from '../types';

/**
 * Creates an onChange callback for a primitive SceneObject property.
 * Reads fresh state from the store and only dispatches an update if the value actually changed.
 */
export function objectOnChange<K extends keyof SceneObject>(
    key: K,
    updateObject: (id: string, patch: Partial<SceneObject>) => void,
) {
    return (value: SceneObject[K]) => {
        const state = useSceneStore.getState();
        const selId = state.selectedObjectId;
        if (!selId) return;
        const obj = state.objects.find(o => o.id === selId);
        if (obj && value !== obj[key]) {
            updateObject(selId, { [key]: value } as Partial<SceneObject>);
        }
    };
}

/**
 * Creates an onChange callback for a Vector3 SceneObject property (position, dimensions, rotation).
 * Compares x, y, z individually before dispatching.
 */
export function objectOnChangeVec3<K extends keyof SceneObject>(
    key: K,
    updateObject: (id: string, patch: Partial<SceneObject>) => void,
) {
    return (value: Vector3) => {
        const state = useSceneStore.getState();
        const selId = state.selectedObjectId;
        if (!selId) return;
        const obj = state.objects.find(o => o.id === selId);
        if (!obj) return;
        const current = obj[key] as Vector3;
        if (value.x !== current.x || value.y !== current.y || value.z !== current.z) {
            updateObject(selId, { [key]: value } as Partial<SceneObject>);
        }
    };
}
