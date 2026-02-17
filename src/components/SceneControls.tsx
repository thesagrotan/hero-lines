import { useControls, folder } from 'leva';
import { useSceneStore } from '../store/sceneStore';
import { useEffect } from 'react';

export const SceneControls = () => {
    const { scene, setScene } = useSceneStore();

    const [, set] = useControls(() => ({
        camera: {
            value: scene.camera,
            step: 0.1,
            onChange: (v: any) => {
                if (v.x !== scene.camera.x || v.y !== scene.camera.y || v.z !== scene.camera.z) {
                    setScene({ camera: v });
                }
            }
        },
        zoom: {
            value: scene.zoom,
            min: 0.1, max: 2.0, step: 0.05,
            onChange: (v: any) => {
                if (v !== scene.zoom) setScene({ zoom: v });
            }
        },
        bgColor: {
            value: scene.bgColor,
            onChange: (v: any) => {
                if (v !== scene.bgColor) setScene({ bgColor: v });
            }
        },
        transitionSpeed: {
            value: scene.transitionSpeed, min: 100, max: 2000, step: 50, label: 'Duration (ms)',
            onChange: (v: any) => {
                if (v !== scene.transitionSpeed) setScene({ transitionSpeed: v });
            }
        },
        transitionEase: {
            value: scene.transitionEase, options: ['Ease In-Out', 'Ease In', 'Ease Out', 'Linear'], label: 'Easing',
            onChange: (v: any) => {
                if (v !== scene.transitionEase) setScene({ transitionEase: v as any });
            }
        },
        theme: {
            value: scene.theme,
            options: ['dark', 'light'],
            onChange: (v: any) => {
                if (v !== scene.theme) {
                    const bgColor = v === 'light' ? '#f5f5f7' : '#000000';
                    setScene({ theme: v, bgColor });
                }
            }
        },
        'Device Animation': folder({
            'Auto Cycle': {
                value: scene.autoCycle.enabled,
                onChange: (v: any) => {
                    if (v !== scene.autoCycle.enabled) {
                        setScene({ autoCycle: { ...scene.autoCycle, enabled: v } });
                    }
                }
            },
            'Pause Time': {
                value: scene.autoCycle.pauseTime,
                min: 500, max: 5000, step: 100, label: 'Pause (ms)',
                onChange: (v: any) => {
                    if (v !== scene.autoCycle.pauseTime) {
                        setScene({ autoCycle: { ...scene.autoCycle, pauseTime: v } });
                    }
                }
            }
        })
    } as any), []); // Stable panel

    // Sync store changes back to Leva (from templates, resets, etc.)
    useEffect(() => {
        set({
            camera: scene.camera,
            zoom: scene.zoom,
            bgColor: scene.bgColor,
            transitionSpeed: scene.transitionSpeed,
            transitionEase: scene.transitionEase,
            theme: scene.theme,
            'Auto Cycle': scene.autoCycle.enabled,
            'Pause Time': scene.autoCycle.pauseTime,
        });
    }, [scene.camera, scene.zoom, scene.bgColor, scene.transitionSpeed, scene.transitionEase, scene.theme, scene.autoCycle.enabled, scene.autoCycle.pauseTime, set]);

    return null;
};
