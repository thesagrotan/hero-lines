import { useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { WebGLRenderer } from './WebGLRenderer';
import { vsSource, fsSource } from '../shaders';
import { interpolateProperty } from '../utils/interpolation';

export function useRenderer(canvasRef: React.RefObject<HTMLCanvasElement>, timelineRef: React.RefObject<any>) {
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const requestRef = useRef<number>();

    const transitionRef = useRef({
        startTime: 0,
        duration: 600,
        fromRotY: 0,
        extraSpin: 360,
        easeType: 'Ease In-Out',
        fromDims: { x: 0, y: 0, z: 0 },
        fromBR: 0,
        fromCam: { x: 0, y: 0, z: 0 },
        fromZoom: 1,
        active: false
    });

    const lastTransition = useSceneStore(s => s.lastTransition);

    useEffect(() => {
        if (!lastTransition) return;
        const tr = transitionRef.current;
        const state = useSceneStore.getState();
        const obj = state.objects.find(o => o.id === lastTransition.objectId);
        if (!obj) return;

        tr.startTime = performance.now();
        tr.duration = lastTransition.duration;
        tr.fromRotY = obj.rotation.y;
        tr.fromDims = { ...obj.dimensions };
        tr.fromBR = obj.borderRadius;
        tr.fromCam = { ...state.scene.camera };
        tr.fromZoom = state.scene.zoom;
        tr.easeType = state.scene.transitionEase;
        tr.active = true;
    }, [lastTransition]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Initialize renderer
        try {
            rendererRef.current = new WebGLRenderer(canvas, vsSource, fsSource);
        } catch (err) {
            console.error('Failed to initialize WebGL renderer:', err);
            return;
        }

        const render = (now: number) => {
            const state = useSceneStore.getState();
            const { scene, objects, isPlaying, timelineRows, setCurrentTime } = state;

            let time = state.currentTime;

            if (isPlaying && timelineRef.current) {
                time = timelineRef.current.getTime();
                setCurrentTime(time);
            }

            // Map objects with interpolated values
            const interpolatedObjects = objects.map(obj => {
                if (!isPlaying) return obj;

                return {
                    ...obj,
                    dimensions: {
                        x: interpolateProperty(timelineRows, obj.id, 'boxX', time, obj.dimensions.x),
                        y: interpolateProperty(timelineRows, obj.id, 'boxY', time, obj.dimensions.y),
                        z: interpolateProperty(timelineRows, obj.id, 'boxZ', time, obj.dimensions.z),
                    },
                    rotation: {
                        x: interpolateProperty(timelineRows, obj.id, 'rotX', time, obj.rotation.x),
                        y: interpolateProperty(timelineRows, obj.id, 'rotY', time, obj.rotation.y),
                        z: interpolateProperty(timelineRows, obj.id, 'rotZ', time, obj.rotation.z),
                    },
                    borderRadius: interpolateProperty(timelineRows, obj.id, 'borderRadius', time, obj.borderRadius),
                    numLines: interpolateProperty(timelineRows, obj.id, 'numLines', time, obj.numLines),
                    thickness: interpolateProperty(timelineRows, obj.id, 'thickness', time, obj.thickness),
                    speed: interpolateProperty(timelineRows, obj.id, 'speed', time, obj.speed),
                    longevity: interpolateProperty(timelineRows, obj.id, 'longevity', time, obj.longevity),
                    ease: interpolateProperty(timelineRows, obj.id, 'ease', time, obj.ease),
                    color1: interpolateProperty(timelineRows, obj.id, 'color1', time, obj.color1),
                    color2: interpolateProperty(timelineRows, obj.id, 'color2', time, obj.color2),
                    rimColor: interpolateProperty(timelineRows, obj.id, 'rimColor', time, obj.rimColor),
                };
            });

            // Scene-level interpolations (mapped to object-level in the store for now)
            // Note: In a true multi-object setup, scene properties should be separate tracks.
            // For now, we take them from the timeline rows if they match the main object ID 
            // or we could have a special 'scene' objectId.
            // Let's assume they are still tied to INITIAL_OBJECT_ID for now to maintain parity.
            const mainObjectId = objects[0]?.id || 'main-obj';

            const interpolatedScene = {
                ...scene,
                camera: {
                    x: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'camX', time, scene.camera.x) : scene.camera.x,
                    y: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'camY', time, scene.camera.y) : scene.camera.y,
                    z: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'camZ', time, scene.camera.z) : scene.camera.z,
                },
                zoom: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'zoom', time, scene.zoom) : scene.zoom,
                bgColor: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'bgColor', time, scene.bgColor) : scene.bgColor,
            };

            // Transition logic
            const tr = transitionRef.current;
            if (tr.active) {
                const elapsed = now - tr.startTime;
                const progress = Math.min(elapsed / tr.duration, 1);
                let ease = progress;

                if (tr.easeType === 'Ease In-Out') {
                    ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
                } else if (tr.easeType === 'Ease In') {
                    ease = progress * progress * progress;
                } else if (tr.easeType === 'Ease Out') {
                    ease = 1 - Math.pow(1 - progress, 3);
                }

                // Apply transition to FIRST object for now (parity with legacy behavior)
                if (interpolatedObjects[0]) {
                    interpolatedObjects[0].rotation.y += tr.extraSpin * ease;
                    interpolatedObjects[0].dimensions.x = tr.fromDims.x + (interpolatedObjects[0].dimensions.x - tr.fromDims.x) * ease;
                    interpolatedObjects[0].dimensions.y = tr.fromDims.y + (interpolatedObjects[0].dimensions.y - tr.fromDims.y) * ease;
                    interpolatedObjects[0].dimensions.z = tr.fromDims.z + (interpolatedObjects[0].dimensions.z - tr.fromDims.z) * ease;
                }

                if (progress >= 1) tr.active = false;
            }

            rendererRef.current?.renderFrame(interpolatedScene, interpolatedObjects, now);
            requestRef.current = requestAnimationFrame(render);
        };

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            rendererRef.current?.resize(canvas.width, canvas.height);
        };

        window.addEventListener('resize', resize);
        resize();
        requestRef.current = requestAnimationFrame(render);

        return () => {
            window.removeEventListener('resize', resize);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            rendererRef.current?.dispose();
        };
    }, [canvasRef]);

    // Expose transition trigger? Or use a separate hook?
    // For now, let's keep it simple and just provide the renderer.
    return rendererRef;
}
