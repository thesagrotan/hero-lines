import { useControls, folder } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';

export const ObjectControls = () => {
    const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
    const objects = useSceneStore((s) => s.objects);
    const updateObject = useSceneStore((s) => s.updateObject);

    const obj = objects.find((o) => o.id === selectedObjectId);

    const [controls, set] = useControls(
        () => ({
            [obj?.name || 'Object']: folder({
                Transformations: folder({
                    position: { value: obj?.position ?? { x: 0, y: 0, z: 0 }, step: 0.1 },
                    dimensions: { value: obj?.dimensions ?? { x: 1, y: 1, z: 1 }, step: 0.05 },
                    rotation: { value: obj?.rotation ?? { x: 0, y: 0, z: 0 }, step: 1 },
                }),
                'Lines & Animation': folder({
                    shapeType: {
                        value: obj?.shapeType ?? 'Box',
                        options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder'],
                    },
                    borderRadius: { value: obj?.borderRadius ?? 0.1, min: 0, max: 1, step: 0.01 },
                    numLines: { value: obj?.numLines ?? 30, min: 1, max: 100, step: 1 },
                    thickness: { value: obj?.thickness ?? 0.01, min: 0.001, max: 0.1, step: 0.001 },
                    orientation: {
                        value: obj?.orientation ?? 'Horizontal',
                        options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'],
                    },
                    speed: { value: obj?.speed ?? 0.8, min: 0, max: 5, step: 0.1 },
                    longevity: { value: obj?.longevity ?? 0.4, min: 0.05, max: 2, step: 0.05 },
                    ease: { value: obj?.ease ?? 0.5, min: 0, max: 1, step: 0.1 },
                }),
                Appearance: folder({
                    color1: obj?.color1 ?? '#0d66ff',
                    color2: obj?.color2 ?? '#4cccff',
                    rimColor: obj?.rimColor ?? '#1a66cc',
                }),
            }),
        }),
        [selectedObjectId, obj?.name]
    );

    // Push local Leva changes to store
    useEffect(() => {
        if (selectedObjectId) {
            updateObject(selectedObjectId, {
                position: controls.position,
                dimensions: controls.dimensions,
                rotation: controls.rotation,
                shapeType: controls.shapeType as any,
                borderRadius: controls.borderRadius,
                numLines: controls.numLines,
                thickness: controls.thickness,
                orientation: controls.orientation as any,
                speed: controls.speed,
                longevity: controls.longevity,
                ease: controls.ease,
                color1: controls.color1,
                color2: controls.color2,
                rimColor: controls.rimColor,
            });
        }
    }, [controls, selectedObjectId, updateObject]);

    // Sync store changes back to Leva
    useEffect(() => {
        if (obj) {
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
            });
        }
    }, [obj, set]);

    return null;
};
