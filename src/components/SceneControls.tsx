import { useControls, folder } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';

export const SceneControls = () => {
    const { scene, setScene } = useSceneStore();

    const [controls, set] = useControls(() => ({
        Scene: folder({
            camera: { value: scene.camera, step: 0.1 },
            zoom: { value: scene.zoom, min: 0.1, max: 2.0, step: 0.05 },
            bgColor: { value: scene.bgColor },
        }),
        Transition: folder({
            transitionSpeed: { value: scene.transitionSpeed, min: 100, max: 2000, step: 50, label: 'Duration (ms)' },
            transitionEase: { value: scene.transitionEase, options: ['Ease In-Out', 'Ease In', 'Ease Out', 'Linear'], label: 'Easing' },
        }),
    }), [scene.camera, scene.zoom, scene.bgColor, scene.transitionSpeed, scene.transitionEase]);

    // Push local Leva changes to store
    useEffect(() => {
        setScene({
            camera: controls.camera,
            zoom: controls.zoom,
            bgColor: controls.bgColor,
            transitionSpeed: controls.transitionSpeed,
            transitionEase: controls.transitionEase,
        });
    }, [controls, setScene]);

    // Sync store changes back to Leva (e.g. from templates or reset)
    useEffect(() => {
        set({
            camera: scene.camera,
            zoom: scene.zoom,
            bgColor: scene.bgColor,
            transitionSpeed: scene.transitionSpeed,
            transitionEase: scene.transitionEase,
        });
    }, [scene, set]);

    return null;
};
