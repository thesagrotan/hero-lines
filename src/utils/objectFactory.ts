import { SceneObject, ShapeType } from '../types';

/**
 * Base factory for creating a scene object with default values.
 * Only contains type-compliant defaults.
 */
export function createDefaultObject(id: string, name: string): SceneObject {
    return {
        id,
        name,
        visible: true,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        shapeType: 'Box',
        borderRadius: 0.1,
        orientation: 'Horizontal',
        numLines: 30,
        thickness: 0.01,
        speed: 1.0,
        longevity: 0.4,
        ease: 0.5,
        color1: '#db5a00',
        color2: '#454545',
        rimColor: '#101010',
        timeNoise: 0.5,
    };
}

/**
 * Factory for creating new scene objects for the UI.
 * Adds a random offset so objects don't stack perfectly.
 */
export function createNewDefaultObject(id: string, name: string): SceneObject {
    const obj = createDefaultObject(id, name);
    obj.position = {
        x: (Math.random() - 0.5) * 4,
        y: (Math.random() - 0.5) * 4,
        z: (Math.random() - 0.5) * 4,
    };
    return obj;
}
