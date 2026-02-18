export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export type ShapeType = 'Box' | 'Sphere' | 'Cone' | 'Torus' | 'Capsule' | 'Cylinder' | 'SVG' | 'Laptop';

export interface SvgData {
    svgString: string;
    extrusionDepth: number;
}
export type Orientation = 'Horizontal' | 'Vertical' | 'Depth' | 'Diagonal';

export type CompositeMode = 'None' | 'Union' | 'Subtract' | 'Intersect' | 'SmoothUnion';

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
    svgData?: SvgData;
    svgExtrusionDepth: number;
    rimIntensity: number;
    rimPower: number;
    wireOpacity: number;
    wireIntensity: number;
    layerDelay: number;
    torusThickness: number;
    lineBrightness: number;
    bendAmount: number;
    bendAngle: number;
    bendAxis: 'X' | 'Y' | 'Z';
    bendOffset: number;
    bendLimit: number;
    wobbleAmount: number;
    wobbleSpeed: number;
    wobbleScale: number;
    chromaticAberration: number;
    pulseIntensity: number;
    pulseSpeed: number;
    scanlineIntensity: number;
    // CSG Properties
    compositeMode: CompositeMode;
    secondaryShapeType: ShapeType;
    secondaryPosition: Vector3;
    secondaryRotation: Vector3;
    secondaryDimensions: Vector3;
    compositeSmoothness: number;
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
    theme: 'dark' | 'light';
    infinitePass: {
        enabled: boolean;
        speed: number;
        spacing: number;
    };
}

export interface RenderableObject extends SceneObject {
    shapeTypeNext: ShapeType;
    morphFactor: number;
}

export interface TransitionSnapshot extends Pick<SceneObject, 'position' | 'dimensions' | 'borderRadius' | 'rotation' | 'shapeType' | 'bendAmount' | 'bendAngle' | 'bendAxis' | 'bendOffset' | 'bendLimit'> {
    camera: Vector3;
    zoom: number;
}

export interface TransitionState {
    objectId: string;
    duration: number;
    timestamp: number;
    from: TransitionSnapshot | null;
}

export interface PropertyRow {
    id: string;
    name: string;
    type: string;
}
