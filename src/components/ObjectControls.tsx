import { useControls, folder } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';

export const ObjectControls = () => {
    const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
    const objects = useSceneStore((s) => s.objects);
    const updateObject = useSceneStore((s) => s.updateObject);

    const obj = objects.find((o) => o.id === selectedObjectId);

    const [, set] = useControls(
        () => ({
            position: {
                value: { x: 0, y: 0, z: 0 },
                step: 0.1,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && (v.x !== currentObj.position.x || v.y !== currentObj.position.y || v.z !== currentObj.position.z)) {
                        updateObject(selId, { position: v });
                    }
                }
            },
            dimensions: {
                value: { x: 1, y: 1, z: 1 },
                step: 0.05,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && (v.x !== currentObj.dimensions.x || v.y !== currentObj.dimensions.y || v.z !== currentObj.dimensions.z)) {
                        updateObject(selId, { dimensions: v });
                    }
                }
            },
            rotation: {
                value: { x: 0, y: 0, z: 0 },
                step: 1,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && (v.x !== currentObj.rotation.x || v.y !== currentObj.rotation.y || v.z !== currentObj.rotation.z)) {
                        updateObject(selId, { rotation: v });
                    }
                }
            },
            shapeType: {
                value: 'Box',
                options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder'],
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.shapeType) {
                        updateObject(selId, { shapeType: v as any });
                    }
                }
            },
            borderRadius: {
                value: 0.1, min: 0, max: 1, step: 0.01,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.borderRadius) {
                        updateObject(selId, { borderRadius: v });
                    }
                }
            },
            numLines: {
                value: 30, min: 1, max: 100, step: 1,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.numLines) {
                        updateObject(selId, { numLines: v });
                    }
                }
            },
            thickness: {
                value: 0.01, min: 0.001, max: 0.1, step: 0.001,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.thickness) {
                        updateObject(selId, { thickness: v });
                    }
                }
            },
            orientation: {
                value: 'Horizontal',
                options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'],
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.orientation) {
                        updateObject(selId, { orientation: v as any });
                    }
                }
            },
            speed: {
                value: 0.8, min: 0, max: 5, step: 0.1,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.speed) {
                        updateObject(selId, { speed: v });
                    }
                }
            },
            longevity: {
                value: 0.4, min: 0.05, max: 2, step: 0.05,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.longevity) {
                        updateObject(selId, { longevity: v });
                    }
                }
            },
            ease: {
                value: 0.5, min: 0, max: 1, step: 0.1,
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.ease) {
                        updateObject(selId, { ease: v });
                    }
                }
            },
            timeNoise: {
                value: 0.5, min: 0, max: 2, step: 0.05,
                label: 'Timing Noise',
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.timeNoise) {
                        updateObject(selId, { timeNoise: v });
                    }
                }
            },
            color1: {
                value: '#0d66ff',
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.color1) {
                        updateObject(selId, { color1: v });
                    }
                }
            },
            color2: {
                value: '#4cccff',
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.color2) {
                        updateObject(selId, { color2: v });
                    }
                }
            },
            rimColor: {
                value: '#1a66cc',
                onChange: (v) => {
                    const selId = useSceneStore.getState().selectedObjectId;
                    if (!selId) return;
                    const currentObj = useSceneStore.getState().objects.find(o => o.id === selId);
                    if (currentObj && v !== currentObj.rimColor) {
                        updateObject(selId, { rimColor: v });
                    }
                }
            },
        }),
        []
    );

    // Sync store changes back to Leva
    useEffect(() => {
        if (!obj) return;
        set({
            position: obj.position,
            dimensions: obj.dimensions,
            rotation: obj.rotation,
            shapeType: obj.shapeType,
            borderRadius: obj.borderRadius,
            numLines: obj.numLines,
            thickness: obj.thickness,
            orientation: obj.orientation,
            speed: obj.speed,
            longevity: obj.longevity,
            ease: obj.ease,
            color1: obj.color1,
            color2: obj.color2,
            rimColor: obj.rimColor,
            timeNoise: obj.timeNoise,
        });
    }, [obj, set]);

    return null;
};
