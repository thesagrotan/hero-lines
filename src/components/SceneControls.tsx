import { useControls, folder } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';

export const SceneControls = () => {
    const { scene, setScene } = useSceneStore();

    const [, set] = useControls(() => ({
        camera: {
            value: { x: scene.camera.x, y: scene.camera.y, z: scene.camera.z },
            step: 0.1,
            onChange: (v: any) => {
                const current = useSceneStore.getState().scene.camera;
                if (v.x !== current.x || v.y !== current.y || v.z !== current.z) {
                    setScene({ camera: v });
                }
            }
        },
        zoom: {
            value: scene.zoom,
            min: 0.01, max: 20.0, step: 0.05,
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.zoom) setScene({ zoom: v });
            }
        },
        bgColor: {
            value: scene.bgColor,
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.bgColor) setScene({ bgColor: v });
            }
        },
        transitionSpeed: {
            value: scene.transitionSpeed, min: 100, max: 2000, step: 50, label: 'Duration (ms)',
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.transitionSpeed) setScene({ transitionSpeed: v });
            }
        },
        transitionEase: {
            value: scene.transitionEase, options: ['Ease In-Out', 'Ease In', 'Ease Out', 'Linear'], label: 'Easing',
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.transitionEase) setScene({ transitionEase: v as any });
            }
        },
        theme: {
            value: scene.theme,
            options: ['dark', 'light'],
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.theme) {
                    const bgColor = v === 'light' ? '#f5f5f7' : '#000000';
                    setScene({ theme: v, bgColor });
                }
            }
        },
        resolutionScale: {
            value: scene.resolutionScale,
            min: 0.1, max: 1.0, step: 0.05, label: 'Render Quality',
            onChange: (v: any) => {
                if (v !== useSceneStore.getState().scene.resolutionScale) setScene({ resolutionScale: v });
            }
        },
        'Device Animation': folder({
            'Auto Cycle': {
                value: scene.autoCycle.enabled,
                onChange: (v: any) => {
                    const { autoCycle } = useSceneStore.getState().scene;
                    if (v !== autoCycle.enabled) {
                        setScene({ autoCycle: { ...autoCycle, enabled: v } });
                    }
                }
            },
            'Pause Time': {
                value: scene.autoCycle.pauseTime,
                min: 500, max: 5000, step: 100, label: 'Pause (ms)',
                onChange: (v: any) => {
                    const { autoCycle } = useSceneStore.getState().scene;
                    if (v !== autoCycle.pauseTime) {
                        setScene({ autoCycle: { ...autoCycle, pauseTime: v } });
                    }
                }
            }
        })
    }), []); // Stable panel

    // Sync store changes back to Leva (from templates, resets, etc.)
    useEffect(() => {
        set({
            camera: scene.camera,
            zoom: scene.zoom,
            bgColor: scene.bgColor,
            transitionSpeed: scene.transitionSpeed,
            transitionEase: scene.transitionEase,
            theme: scene.theme,
            resolutionScale: scene.resolutionScale,
            'Auto Cycle': scene.autoCycle.enabled,
            'Pause Time': scene.autoCycle.pauseTime,
        } as any);
    }, [scene.camera, scene.zoom, scene.bgColor, scene.transitionSpeed, scene.transitionEase, scene.theme, scene.resolutionScale, scene.autoCycle.enabled, scene.autoCycle.pauseTime, set]);

    return null;
};
