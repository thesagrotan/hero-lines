import { create } from 'zustand';
import { SceneObject, SceneState, createDefaultObject } from '../types';

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
    selectObject: (id: string | null) => void;
    getSelectedObject: () => SceneObject | undefined;

    // Transitions
    lastTransition: {
        objectId: string,
        duration: number,
        timestamp: number,
        from: {
            position: { x: number, y: number, z: number },
            dimensions: { x: number, y: number, z: number },
            borderRadius: number,
            rotation: { x: number, y: number, z: number },
            shapeType: string,
            camera: { x: number, y: number, z: number },
            zoom: number
        } | null
    } | null;
    triggerTransition: (objectId: string, duration: number) => void;
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
    theme: 'dark'
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
        const newObject = createDefaultObject(id, name);
        // Add some random offset
        newObject.position = {
            x: (Math.random() - 0.5) * 4,
            y: (Math.random() - 0.5) * 4,
            z: (Math.random() - 0.5) * 4,
        };

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
                from: obj ? {
                    position: { ...obj.position },
                    dimensions: { ...obj.dimensions },
                    borderRadius: obj.borderRadius,
                    rotation: { ...obj.rotation },
                    shapeType: obj.shapeType,
                    camera: { ...scene.camera },
                    zoom: scene.zoom
                } : null
            }
        });
    },
}));
