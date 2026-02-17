import { SceneObject, RenderableObject } from '../types';

/**
 * Builds a list of RenderableObjects from SceneObjects.
 * Handles deep cloning and initialization of morph properties.
 */
export function buildRenderableObjects(objects: SceneObject[]): RenderableObject[] {
    return objects.map(obj => ({
        ...obj,
        position: { ...obj.position },
        dimensions: { ...obj.dimensions },
        rotation: { ...obj.rotation },
        shapeTypeNext: obj.shapeType,
        morphFactor: 0.0
    }));
}
