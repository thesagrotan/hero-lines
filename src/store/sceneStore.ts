import { create } from 'zustand';
import { SceneObject, SceneState, ObjectTimelineRow, createDefaultObject, PropertyRow } from '../types';

interface SceneStore {
    // Scene-level
    scene: SceneState;
    setScene: (patch: Partial<SceneState>) => void;

    // Objects
    objects: SceneObject[];
    selectedObjectId: string | null;
    addObject: () => void;
    removeObject: (id: string) => void;
    duplicateObject: (id: string) => void;
    updateObject: (id: string, patch: Partial<SceneObject>) => void;
    selectObject: (id: string | null) => void;
    getSelectedObject: () => SceneObject | undefined;

    // Timeline
    timelineRows: ObjectTimelineRow[];
    setTimelineRows: (rows: ObjectTimelineRow[]) => void;
    isPlaying: boolean;
    setIsPlaying: (playing: boolean) => void;
    currentTime: number;
    setCurrentTime: (time: number) => void;

    // Transitions
    lastTransition: { objectId: string, duration: number, timestamp: number } | null;
    triggerTransition: (objectId: string, duration: number) => void;
}

const INITIAL_SCENE_STATE: SceneState = {
    camera: { x: 5.0, y: 4.5, z: 8.0 },
    zoom: 1.0,
    bgColor: '#000000',
    transitionSpeed: 600,
    transitionEase: 'Ease In-Out',
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
    speed: 0.8,
    longevity: 0.4,
    ease: 0.5,
    color1: '#0d66ff',
    color2: '#4cccff',
    rimColor: '#1a66cc',
};

// Initial timeline data from App.tsx, mapped to the initial object
const INITIAL_TIMELINE_DATA: ObjectTimelineRow[] = [
    { objectId: INITIAL_OBJECT_ID, property: 'camX', actions: [{ id: 'cx1', start: 0, end: 0.1, effectId: 'value', data: { value: 5.0 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'camY', actions: [{ id: 'cy1', start: 0, end: 0.1, effectId: 'value', data: { value: 4.5 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'camZ', actions: [{ id: 'cz1', start: 0, end: 0.1, effectId: 'value', data: { value: 8.0 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'zoom', actions: [{ id: 'z1', start: 0, end: 0.1, effectId: 'value', data: { value: 1.0 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'boxX', actions: [{ id: 'bx1', start: 0, end: 0.1, effectId: 'value', data: { value: 2.5 } }, { id: 'bx2', start: 2, end: 2.1, effectId: 'value', data: { value: 4.0 } }, { id: 'bx3', start: 4, end: 4.1, effectId: 'value', data: { value: 2.5 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'boxY', actions: [{ id: 'by1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.8 } }, { id: 'by2', start: 2, end: 2.1, effectId: 'value', data: { value: 1.5 } }, { id: 'by3', start: 4, end: 4.1, effectId: 'value', data: { value: 0.8 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'boxZ', actions: [{ id: 'bz1', start: 0, end: 0.1, effectId: 'value', data: { value: 1.2 } }, { id: 'bz2', start: 3, end: 3.1, effectId: 'value', data: { value: 0.4 } }, { id: 'bz3', start: 5, end: 5.1, effectId: 'value', data: { value: 1.2 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'rotX', actions: [{ id: 'rx1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'rx2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'rotY', actions: [{ id: 'ry1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'ry2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'rotZ', actions: [{ id: 'rz1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'rz2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'shapeType', actions: [{ id: 'st1', start: 0, end: 0.1, effectId: 'value', data: { value: 'Box' } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'borderRadius', actions: [{ id: 'br1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.1 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'numLines', actions: [{ id: 'nl1', start: 0, end: 0.1, effectId: 'value', data: { value: 30 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'thickness', actions: [{ id: 'th1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.01 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'orientation', actions: [{ id: 'or1', start: 0, end: 0.1, effectId: 'value', data: { value: 'Horizontal' } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'speed', actions: [{ id: 'sp1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.8 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'longevity', actions: [{ id: 'lg1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.4 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'ease', actions: [{ id: 'ea1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.5 } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'color1', actions: [{ id: 'c1-1', start: 0, end: 0.1, effectId: 'value', data: { value: '#0d66ff' } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'color2', actions: [{ id: 'c2-1', start: 0, end: 0.1, effectId: 'value', data: { value: '#4cccff' } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'rimColor', actions: [{ id: 'rc1', start: 0, end: 0.1, effectId: 'value', data: { value: '#1a66cc' } }] },
    { objectId: INITIAL_OBJECT_ID, property: 'bgColor', actions: [{ id: 'bg1', start: 0, end: 0.1, effectId: 'value', data: { value: '#000000' } }] },
];

export const useSceneStore = create<SceneStore>((set, get) => ({
    scene: INITIAL_SCENE_STATE,
    objects: [INITIAL_OBJECT],
    selectedObjectId: INITIAL_OBJECT_ID,
    timelineRows: INITIAL_TIMELINE_DATA,
    isPlaying: false,
    setIsPlaying: (playing) => set({ isPlaying: playing }),
    currentTime: 0,
    setCurrentTime: (time) => set({ currentTime: time }),

    setScene: (patch) => set((state) => ({
        scene: { ...state.scene, ...patch }
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

        // Create initial timeline rows for the new object mirroring the properties
        const newRows: ObjectTimelineRow[] = [
            { objectId: id, property: 'boxX', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.dimensions.x } }] },
            { objectId: id, property: 'boxY', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.dimensions.y } }] },
            { objectId: id, property: 'boxZ', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.dimensions.z } }] },
            { objectId: id, property: 'rotX', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.rotation.x } }] },
            { objectId: id, property: 'rotY', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.rotation.y } }] },
            { objectId: id, property: 'rotZ', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.rotation.z } }] },
            { objectId: id, property: 'borderRadius', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.borderRadius } }] },
            { objectId: id, property: 'numLines', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.numLines } }] },
            { objectId: id, property: 'thickness', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.thickness } }] },
            { objectId: id, property: 'speed', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.speed } }] },
            { objectId: id, property: 'longevity', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.longevity } }] },
            { objectId: id, property: 'ease', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.ease } }] },
            { objectId: id, property: 'color1', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.color1 } }] },
            { objectId: id, property: 'color2', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.color2 } }] },
            { objectId: id, property: 'rimColor', actions: [{ id: crypto.randomUUID(), start: 0, end: 0.1, effectId: 'value', data: { value: newObject.rimColor } }] },
        ];

        set((state) => ({
            objects: [...state.objects, newObject],
            selectedObjectId: id,
            timelineRows: [...state.timelineRows, ...newRows]
        }));
    },

    removeObject: (id) => set((state) => ({
        objects: state.objects.filter((o) => o.id !== id),
        selectedObjectId: state.selectedObjectId === id ? (state.objects.length > 1 ? state.objects.find(o => o.id !== id)?.id || null : null) : state.selectedObjectId,
        timelineRows: state.timelineRows.filter(r => r.objectId !== id)
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

        const newTimelineRows: ObjectTimelineRow[] = get().timelineRows
            .filter(r => r.objectId === id)
            .map(r => ({
                ...r,
                objectId: newId,
                actions: r.actions.map(a => ({
                    ...a,
                    id: crypto.randomUUID()
                }))
            }));

        set((state) => ({
            objects: [...state.objects, newObject],
            selectedObjectId: newId,
            timelineRows: [...state.timelineRows, ...newTimelineRows]
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

    setTimelineRows: (rows) => set({ timelineRows: rows }),

    lastTransition: null,
    triggerTransition: (objectId, duration) => set({
        lastTransition: { objectId, duration, timestamp: Date.now() }
    }),
}));
