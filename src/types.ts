export type ShapeType = 'Box' | 'Sphere' | 'Cone' | 'Torus' | 'Capsule' | 'Cylinder';
export type Orientation = 'Horizontal' | 'Vertical' | 'Depth' | 'Diagonal';

/** A unique object on the canvas */
export interface SceneObject {
    id: string;                // uuid
    name: string;              // user-visible label, e.g. "Box 1"
    visible: boolean;          // can be toggled off

    // Transformation
    position: { x: number; y: number; z: number };
    dimensions: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };

    // Shape
    shapeType: ShapeType;
    borderRadius: number;
    orientation: Orientation;

    // Lines & Animation
    numLines: number;
    thickness: number;
    speed: number;
    longevity: number;
    ease: number;

    // Appearance
    color1: string;
    color2: string;
    rimColor: string;
}

/** Scene-level state (shared across all objects) */
export interface SceneState {
    camera: { x: number; y: number; z: number };
    zoom: number;
    bgColor: string;
    transitionSpeed: number;
    transitionEase: string;
}

export interface TimelineAction {
    id: string;
    start: number;
    end: number;
    effectId: string;
    data?: any;
}

export interface TimelineRow {
    id: string;
    actions: TimelineAction[];
}

/** Timeline keyframe row, now scoped to an object */
export interface ObjectTimelineRow {
    objectId: string;       // which SceneObject this row belongs to
    property: string;       // e.g. 'boxX', 'rotY', 'color1'
    actions: TimelineAction[];
}

export interface PropertyAction extends TimelineAction {
    data: {
        value: number | string;
    }
}

export interface PropertyRow extends TimelineRow {
    actions: PropertyAction[];
}

export const createDefaultObject = (id: string, name: string): SceneObject => ({
    id,
    name,
    visible: true,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    shapeType: 'Box',
    borderRadius: 0.2,
    orientation: 'Horizontal',
    numLines: 40,
    thickness: 0.05,
    speed: 0.1,
    longevity: 0.5,
    ease: 0.2,
    color1: '#ff0000',
    color2: '#0000ff',
    rimColor: '#ffffff',
});
