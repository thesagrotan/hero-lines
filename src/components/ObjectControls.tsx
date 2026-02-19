import { useControls, folder } from 'leva';
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
            'Shape': folder({
                shapeType: {
                    value: 'Box',
                    options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder', 'SVG', 'Laptop'],
                    onChange: objectOnChange('shapeType', updateObject),
                },
                borderRadius: {
                    value: 0.1, min: 0, max: 1, step: 0.01,
                    label: 'Border Radius',
                    onChange: objectOnChange('borderRadius', updateObject),
                },
                orientation: {
                    value: 'Horizontal',
                    options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'],
                    onChange: objectOnChange('orientation', updateObject),
                },
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
                svgExtrusionDepth: {
                    value: 0.5, min: 0.01, max: 2, step: 0.01,
                    label: 'SVG Extrusion',
                    onChange: objectOnChange('svgExtrusionDepth', updateObject),
                },
                wireOpacity: {
                    value: 0.1, min: 0, max: 1, step: 0.01,
                    label: 'Wire Opacity',
                    onChange: objectOnChange('wireOpacity', updateObject),
                },
                wireIntensity: {
                    value: 0.1, min: 0, max: 1, step: 0.01,
                    label: 'Wire Intensity',
                    onChange: objectOnChange('wireIntensity', updateObject),
                },
                torusThickness: {
                    value: 0.2, min: 0.05, max: 0.5, step: 0.01,
                    label: 'Torus Thickness',
                    onChange: objectOnChange('torusThickness', updateObject),
                },
            }, { collapsed: false }),

            'Lines': folder({
                numLines: {
                    value: 30, min: 1, max: 100, step: 1,
                    label: 'Num Lines',
                    onChange: objectOnChange('numLines', updateObject),
                },
                thickness: {
                    value: 0.01, min: 0.001, max: 0.1, step: 0.001,
                    onChange: objectOnChange('thickness', updateObject),
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
                layerDelay: {
                    value: 0.02, min: 0.001, max: 0.1, step: 0.001,
                    label: 'Layer Delay',
                    onChange: objectOnChange('layerDelay', updateObject),
                },
                lineBrightness: {
                    value: 2.5, min: 0.5, max: 5, step: 0.1,
                    label: 'Brightness',
                    onChange: objectOnChange('lineBrightness', updateObject),
                },
            }, { collapsed: true }),

            'Colors': folder({
                color1: {
                    value: '#db5a00',
                    label: 'Line Color',
                    onChange: objectOnChange('color1', updateObject),
                },
                color2: {
                    value: '#101010',
                    label: 'Trail Color',
                    onChange: objectOnChange('color2', updateObject),
                },
                rimColor: {
                    value: '#1a66cc',
                    label: 'Rim Color',
                    onChange: objectOnChange('rimColor', updateObject),
                },
                rimIntensity: {
                    value: 0.4, min: 0, max: 2, step: 0.05,
                    label: 'Rim Intensity',
                    onChange: objectOnChange('rimIntensity', updateObject),
                },
                rimPower: {
                    value: 3.0, min: 0.5, max: 10, step: 0.1,
                    label: 'Rim Power',
                    onChange: objectOnChange('rimPower', updateObject),
                },
            }, { collapsed: true }),

            'Bend': folder({
                bendAmount: {
                    value: 0, min: -2, max: 2, step: 0.01,
                    label: 'Amount',
                    onChange: objectOnChange('bendAmount', updateObject),
                },
                bendAngle: {
                    value: 0, min: 0, max: 360, step: 1,
                    label: 'Angle',
                    onChange: objectOnChange('bendAngle', updateObject),
                },
                bendAxis: {
                    value: 'Y',
                    options: ['X', 'Y', 'Z'],
                    label: 'Axis',
                    onChange: objectOnChange('bendAxis', updateObject),
                },
                bendOffset: {
                    value: 0, min: -2, max: 2, step: 0.01,
                    label: 'Offset',
                    onChange: objectOnChange('bendOffset', updateObject),
                },
                bendLimit: {
                    value: 1, min: 0.1, max: 5, step: 0.01,
                    label: 'Limit',
                    onChange: objectOnChange('bendLimit', updateObject),
                },
            }, { collapsed: true }),



            'Composite': folder({
                compositeMode: {
                    value: 'None',
                    options: ['None', 'Union', 'Subtract', 'Intersect', 'SmoothUnion'],
                    label: 'Mode',
                    onChange: objectOnChange('compositeMode', updateObject),
                },
                secondaryShapeType: {
                    value: 'Sphere',
                    options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder', 'SVG', 'Laptop'],
                    label: 'Secondary Shape',
                    onChange: objectOnChange('secondaryShapeType', updateObject),
                },
                secondaryPosition: {
                    value: { x: 0, y: 0, z: 0 },
                    step: 0.05,
                    label: 'Secondary Pos',
                    render: (get) => get('Composite.compositeMode') !== 'None',
                    onChange: objectOnChangeVec3('secondaryPosition', updateObject),
                },
                secondaryRotation: {
                    value: { x: 0, y: 0, z: 0 },
                    step: 1,
                    label: 'Secondary Rot',
                    render: (get) => get('Composite.compositeMode') !== 'None',
                    onChange: objectOnChangeVec3('secondaryRotation', updateObject),
                },
                secondaryDimensions: {
                    value: { x: 0.5, y: 0.5, z: 0.5 },
                    step: 0.05,
                    label: 'Secondary Size',
                    render: (get) => get('Composite.compositeMode') !== 'None',
                    onChange: objectOnChangeVec3('secondaryDimensions', updateObject),
                },
                compositeSmoothness: {
                    value: 0.1, min: 0.01, max: 1, step: 0.01,
                    label: 'Smoothness',
                    render: (get) => get('Composite.compositeMode') === 'SmoothUnion',
                    onChange: objectOnChange('compositeSmoothness', updateObject),
                },
            }, { collapsed: true }),
        }),
        []
    );

    // Sync store changes back to Leva
    useEffect(() => {
        if (!obj) return;
        (set as any)({
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
            bendAmount: obj.bendAmount,
            bendAngle: obj.bendAngle,
            bendAxis: obj.bendAxis,
            bendOffset: obj.bendOffset,
            bendLimit: obj.bendLimit,
            svgExtrusionDepth: obj.svgExtrusionDepth,
            rimIntensity: obj.rimIntensity,
            rimPower: obj.rimPower,
            wireOpacity: obj.wireOpacity,
            wireIntensity: obj.wireIntensity,
            layerDelay: obj.layerDelay,
            torusThickness: obj.torusThickness,
            lineBrightness: obj.lineBrightness,

            compositeMode: obj.compositeMode,
            secondaryShapeType: obj.secondaryShapeType,
            secondaryPosition: obj.secondaryPosition,
            secondaryRotation: obj.secondaryRotation,
            secondaryDimensions: obj.secondaryDimensions,
            compositeSmoothness: obj.compositeSmoothness,
        });
    }, [obj, set]);

    return null;
};
