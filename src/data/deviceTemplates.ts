import { SceneObject, SceneState } from '../types';

export interface DeviceTemplate {
    dimensions: { x: number; y: number; z: number };
    borderRadius: number;
    shapeType: SceneObject['shapeType'];
    camera: { x: number; y: number; z: number };
    zoom: number;
}

export const DEVICE_TEMPLATES: Record<string, DeviceTemplate> = {
    Smartwatch: {
        dimensions: { x: 0.8, y: 1.0, z: 0.3 },
        borderRadius: 0.35,
        shapeType: 'Box',
        camera: { x: 3.0, y: 2.5, z: 5.0 },
        zoom: 0.7
    },
    Mobile: {
        dimensions: { x: 1.0, y: 2.0, z: 0.2 },
        borderRadius: 0.15,
        shapeType: 'Box',
        camera: { x: 4.0, y: 3.5, z: 6.5 },
        zoom: 0.85
    },
    Tablet: {
        dimensions: { x: 2.0, y: 2.8, z: 0.15 },
        borderRadius: 0.12,
        shapeType: 'Box',
        camera: { x: 5.0, y: 4.5, z: 8.0 },
        zoom: 1.0
    },
    Laptop: {
        dimensions: { x: 3.5, y: 2.2, z: 0.12 },
        borderRadius: 0.08,
        shapeType: 'Box',
        camera: { x: 6.0, y: 5.0, z: 10.0 },
        zoom: 1.1
    },
};
