import { create } from 'zustand';
import { SceneObject, SceneState, TransitionState } from '../types';
import { createNewDefaultObject } from '../utils/objectFactory';
import { createTransitionSnapshot } from '../utils/transitionUtils';
import { DEVICE_TEMPLATES } from '../data/deviceTemplates';

interface SceneStore {
    // Scene-level
    scene: SceneState;
    setScene: (patch: Partial<SceneState>) => void;
    toggleAutoCycle: () => void;

    // Objects
    objects: SceneObject[];
    selectedObjectId: string | null;
    addObject: () => void;
    removeObject: (id: string) => void;
    duplicateObject: (id: string) => void;
    updateObject: (id: string, patch: Partial<SceneObject>) => void;
    applySettingsToAll: (sourceId: string, type: 'colors' | 'lines') => void;
    selectObject: (id: string | null) => void;
    getSelectedObject: () => SceneObject | undefined;

    // Transitions
    lastTransition: TransitionState | null;
    triggerTransition: (objectId: string, duration: number) => void;
    applyDeviceTemplate: (templateName: string) => void;
    setupInfiniteDevicePass: () => void;
    toggleInfinitePass: () => void;
}

const INITIAL_SCENE_STATE: SceneState = {
    camera: { x: 5.0, y: 4.5, z: 8.0 },
    zoom: 1.0,
    bgColor: '#1D1D1D',
    transitionSpeed: 4000,
    transitionEase: 'Linear',
    autoCycle: {
        enabled: false,
        pauseTime: 0,
    },
    theme: 'dark',
    infinitePass: {
        enabled: false,
        speed: 2.0,
        spacing: 8.0
    }
};

const INITIAL_OBJECT_ID = 'main-obj';

const INITIAL_OBJECT: SceneObject = {
    id: INITIAL_OBJECT_ID,
    name: 'Main Object',
    visible: true,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { x: 2.5, y: 0.8, z: 1.2 },
    rotation: { x: 0, y: 0, z: 0 },
    shapeType: 'Box',
    borderRadius: 0.1,
    orientation: 'Horizontal',
    numLines: 30,
    thickness: 0.01,
    speed: 0.1,
    longevity: 0.4,
    ease: 0.5,
    color1: '#db5a00',
    color2: '#454545',
    rimColor: '#101010',
    timeNoise: 0,
    bendAmount: 0,
    bendAngle: 0,
    bendAxis: 'X',
    bendOffset: 0,
    bendLimit: 1.0,
    svgExtrusionDepth: 0.5,
    rimIntensity: 0.4,
    rimPower: 3.0,
    wireOpacity: 0.1,
    wireIntensity: 0.1,
    layerDelay: 0.02,
    torusThickness: 0.2,
    lineBrightness: 2.5,
    wobbleAmount: 0,
    wobbleSpeed: 1,
    wobbleScale: 2,
    chromaticAberration: 0,
    pulseIntensity: 0,
    pulseSpeed: 1,
    scanlineIntensity: 0,
    // CSG Properties
    compositeMode: 'None',
    secondaryShapeType: 'Sphere',
    secondaryPosition: { x: 0, y: 0, z: 0 },
    secondaryRotation: { x: 0, y: 0, z: 0 },
    secondaryDimensions: { x: 0.5, y: 0.5, z: 0.5 },
    compositeSmoothness: 0.1,
};

export const useSceneStore = create<SceneStore>((set, get) => ({
    scene: INITIAL_SCENE_STATE,
    objects: [INITIAL_OBJECT],
    selectedObjectId: INITIAL_OBJECT_ID,

    setScene: (patch) => set((state) => ({
        scene: { ...state.scene, ...patch }
    })),
    toggleAutoCycle: () => set((state) => ({
        scene: {
            ...state.scene,
            autoCycle: {
                ...state.scene.autoCycle,
                enabled: !state.scene.autoCycle.enabled
            }
        }
    })),

    addObject: () => {
        const id = crypto.randomUUID();
        const state = get();
        const name = `Object ${state.objects.length + 1}`;
        const newObject = createNewDefaultObject(id, name);

        set((state) => ({
            objects: [...state.objects, newObject],
            selectedObjectId: id,
        }));
    },

    removeObject: (id) => set((state) => ({
        objects: state.objects.filter((o) => o.id !== id),
        selectedObjectId: state.selectedObjectId === id ? (state.objects.length > 1 ? state.objects.find(o => o.id !== id)?.id || null : null) : state.selectedObjectId,
    })),

    duplicateObject: (id) => {
        const source = get().objects.find((o) => o.id === id);
        if (!source) return;

        const newId = crypto.randomUUID();
        const newObject: SceneObject = {
            ...source,
            id: newId,
            name: `${source.name} (Copy)`,
            position: { ...source.position, x: source.position.x + 0.5, y: source.position.y + 0.5 }
        };

        set((state) => ({
            objects: [...state.objects, newObject],
            selectedObjectId: newId,
        }));
    },

    updateObject: (id, patch) => set((state) => ({
        objects: state.objects.map((o) => (o.id === id ? { ...o, ...patch } : o))
    })),

    applySettingsToAll: (sourceId, type) => {
        const { objects } = get();
        const source = objects.find(o => o.id === sourceId);
        if (!source) return;

        let patch: Partial<SceneObject> = {};
        if (type === 'colors') {
            patch = {
                color1: source.color1,
                color2: source.color2,
                rimColor: source.rimColor
            };
        } else {
            patch = {
                numLines: source.numLines,
                thickness: source.thickness,
                orientation: source.orientation,
                speed: source.speed,
                longevity: source.longevity,
                ease: source.ease,
                timeNoise: source.timeNoise,
                wobbleAmount: source.wobbleAmount,
                wobbleSpeed: source.wobbleSpeed,
                wobbleScale: source.wobbleScale,
                chromaticAberration: source.chromaticAberration,
                pulseIntensity: source.pulseIntensity,
                pulseSpeed: source.pulseSpeed,
                scanlineIntensity: source.scanlineIntensity,
            };
        }

        set((state) => ({
            objects: state.objects.map(o => ({ ...o, ...patch }))
        }));
    },

    selectObject: (id) => set({ selectedObjectId: id }),

    getSelectedObject: () => {
        const { objects, selectedObjectId } = get();
        return objects.find((o) => o.id === selectedObjectId);
    },

    lastTransition: null,
    triggerTransition: (objectId, duration) => {
        const state = get();
        const obj = state.objects.find(o => o.id === objectId);
        const scene = state.scene;

        set({
            lastTransition: {
                objectId,
                duration,
                timestamp: Date.now(),
                from: obj ? createTransitionSnapshot(obj, scene) : null
            }
        });
    },

    applyDeviceTemplate: (templateName) => {
        const { selectedObjectId, scene, triggerTransition, setScene, updateObject, objects } = get();
        const t = DEVICE_TEMPLATES[templateName];
        if (!t || !selectedObjectId) return;

        // If we were in infinite pass mode, reset to just this object
        let newObjects = objects;
        if (scene.infinitePass.enabled) {
            const currentObj = objects.find(o => o.id === selectedObjectId);
            if (currentObj) {
                newObjects = [currentObj];
            }
        }

        // Trigger transition animation in the store
        triggerTransition(selectedObjectId, scene.transitionSpeed);

        // Update scene settings
        setScene({
            camera: t.camera,
            zoom: t.zoom,
            infinitePass: {
                ...scene.infinitePass,
                enabled: false
            }
        });

        // Update object settings
        set({ objects: newObjects });
        updateObject(selectedObjectId, {
            position: t.position,
            dimensions: t.dimensions,
            borderRadius: t.borderRadius,
            rotation: t.rotation,
            shapeType: t.shapeType,
            orientation: t.orientation
        });
    },

    setupInfiniteDevicePass: () => {
        const { objects, setScene } = get();

        // Inherit style from current objects if possible
        const baseObj = objects[0];
        const baseStyle = baseObj ? {
            color1: baseObj.color1,
            color2: baseObj.color2,
            rimColor: baseObj.rimColor,
            numLines: baseObj.numLines,
            thickness: baseObj.thickness,
            speed: baseObj.speed,
            longevity: baseObj.longevity,
            ease: baseObj.ease,
            timeNoise: baseObj.timeNoise,
            svgExtrusionDepth: baseObj.svgExtrusionDepth,
            rimIntensity: baseObj.rimIntensity,
            rimPower: baseObj.rimPower,
            wireOpacity: baseObj.wireOpacity,
            wireIntensity: baseObj.wireIntensity,
            layerDelay: baseObj.layerDelay,
            torusThickness: baseObj.torusThickness,
            lineBrightness: baseObj.lineBrightness,
            wobbleAmount: baseObj.wobbleAmount,
            wobbleSpeed: baseObj.wobbleSpeed,
            wobbleScale: baseObj.wobbleScale,
            chromaticAberration: baseObj.chromaticAberration,
            pulseIntensity: baseObj.pulseIntensity,
            pulseSpeed: baseObj.pulseSpeed,
            scanlineIntensity: baseObj.scanlineIntensity,
        } : {
            color1: '#db5a00',
            color2: '#454545',
            rimColor: '#101010',
            numLines: 35,
            thickness: 0.012,
            speed: 0.8,
            longevity: 0.6,
            ease: 0.5,
            timeNoise: 0.5,
            svgExtrusionDepth: 0.5,
            rimIntensity: 0.4,
            rimPower: 3.0,
            wireOpacity: 0.1,
            wireIntensity: 0.1,
            layerDelay: 0.02,
            torusThickness: 0.2,
            lineBrightness: 2.5,
            wobbleAmount: 0,
            wobbleSpeed: 1,
            wobbleScale: 2,
            chromaticAberration: 0,
            pulseIntensity: 0,
            pulseSpeed: 1,
            scanlineIntensity: 0,
        };

        // Use predefined device order for consistent feel
        const deviceNames = Object.keys(DEVICE_TEMPLATES);
        const newObjects: SceneObject[] = deviceNames.map((name, i) => {
            const template = DEVICE_TEMPLATES[name];
            return {
                id: `pass-${name.toLowerCase()}`,
                name: `Pass ${name}`,
                visible: true,
                position: { x: 0, y: 0, z: -i * 8.0 }, // Spread along Z
                dimensions: template.dimensions,
                rotation: template.rotation,
                shapeType: template.shapeType,
                borderRadius: template.borderRadius,
                orientation: template.orientation,
                ...baseStyle,
                // Keep the alternating color pattern only if we don't have a base object
                color1: baseObj ? baseStyle.color1 : (i % 2 === 0 ? '#db5a00' : '#00aedb'),
                bendAmount: 0,
                bendAngle: 0,
                bendAxis: 'Y',
                bendOffset: 0,
                bendLimit: 1.0,
                svgExtrusionDepth: baseStyle.svgExtrusionDepth,
                rimIntensity: baseStyle.rimIntensity,
                rimPower: baseStyle.rimPower,
                wireOpacity: baseStyle.wireOpacity,
                wireIntensity: baseStyle.wireIntensity,
                layerDelay: baseStyle.layerDelay,
                torusThickness: baseStyle.torusThickness,
                lineBrightness: baseStyle.lineBrightness,
                compositeMode: 'None',
                secondaryShapeType: 'Sphere',
                secondaryPosition: { x: 0, y: 0, z: 0 },
                secondaryRotation: { x: 0, y: 0, z: 0 },
                secondaryDimensions: { x: 0.5, y: 0.5, z: 0.5 },
                compositeSmoothness: 0.1,
            };
        });

        set({
            objects: newObjects,
            selectedObjectId: newObjects[0].id,
            scene: {
                ...get().scene,
                camera: { x: 8.0, y: 6.0, z: 12.0 },
                zoom: 1.0,
                infinitePass: {
                    ...get().scene.infinitePass,
                    enabled: true
                }
            }
        });
    },

    toggleInfinitePass: () => {
        set((state) => ({
            scene: {
                ...state.scene,
                infinitePass: {
                    ...state.scene.infinitePass,
                    enabled: !state.scene.infinitePass.enabled
                }
            }
        }));
    },
}));
