import { useControls } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';
import { objectOnChange, objectOnChangeVec3 } from '../utils/levaHelpers';

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
                onChange: objectOnChangeVec3('position', updateObject),
            },
            dimensions: {
                value: { x: 1, y: 1, z: 1 },
                step: 0.05,
                onChange: objectOnChangeVec3('dimensions', updateObject),
            },
            rotation: {
                value: { x: 0, y: 0, z: 0 },
                step: 1,
                onChange: objectOnChangeVec3('rotation', updateObject),
            },
            shapeType: {
                value: 'Box',
                options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder', 'SVG'],
                onChange: objectOnChange('shapeType', updateObject),
            },
            borderRadius: {
                value: 0.1, min: 0, max: 1, step: 0.01,
                onChange: objectOnChange('borderRadius', updateObject),
            },
            numLines: {
                value: 30, min: 1, max: 100, step: 1,
                onChange: objectOnChange('numLines', updateObject),
            },
            thickness: {
                value: 0.01, min: 0.001, max: 0.1, step: 0.001,
                onChange: objectOnChange('thickness', updateObject),
            },
            orientation: {
                value: 'Horizontal',
                options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'],
                onChange: objectOnChange('orientation', updateObject),
            },
            speed: {
                value: 0.8, min: 0, max: 5, step: 0.1,
                onChange: objectOnChange('speed', updateObject),
            },
            longevity: {
                value: 0.4, min: 0.05, max: 2, step: 0.05,
                onChange: objectOnChange('longevity', updateObject),
            },
            ease: {
                value: 0.5, min: 0, max: 1, step: 0.1,
                onChange: objectOnChange('ease', updateObject),
            },
            timeNoise: {
                value: 0.5, min: 0, max: 2, step: 0.05,
                label: 'Timing Noise',
                onChange: objectOnChange('timeNoise', updateObject),
            },
            color1: {
                value: '#db5a00',
                onChange: objectOnChange('color1', updateObject),
            },
            color2: {
                value: '#101010',
                onChange: objectOnChange('color2', updateObject),
            },
            rimColor: {
                value: '#1a66cc',
                onChange: objectOnChange('rimColor', updateObject),
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
