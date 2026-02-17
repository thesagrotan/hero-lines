export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export type ShapeType = 'Box' | 'Sphere' | 'Cone' | 'Torus' | 'Capsule' | 'Cylinder';
export type Orientation = 'Horizontal' | 'Vertical' | 'Depth' | 'Diagonal';

export interface SceneObject {
    id: string;
    name: string;
    visible: boolean;
    position: Vector3;
    dimensions: Vector3;
    rotation: Vector3;
    shapeType: ShapeType;
    borderRadius: number;
    orientation: Orientation;
    numLines: number;
    thickness: number;
    speed: number;
    longevity: number;
    ease: number;
    color1: string;
    color2: string;
    rimColor: string;
    timeNoise: number;
}

export interface SceneState {
    camera: Vector3;
    zoom: number;
    bgColor: string;
    transitionSpeed: number;
    transitionEase: string;
    autoCycle: {
        enabled: boolean;
        pauseTime: number;
    };
}

export interface TimelineAction {
    id: string;
    start: number;
    end: number;
    effectId: string;
    data: {
        value: any;
    };
}

export interface ObjectTimelineRow {
    objectId: string;
    property: string;
    actions: TimelineAction[];
}

export interface PropertyRow {
    id: string;
    name: string;
    type: string;
}

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
        color1: '#0d66ff',
        color2: '#4cccff',
        rimColor: '#1a66cc',
        timeNoise: 0.5,
    };
}
