import { useEffect, useRef, type RefObject } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { WebGLRenderer } from './WebGLRenderer';
import { vsSource, fsSource } from '../shaders';
import { interpolateProperty } from '../utils/interpolation';

export function useRenderer(canvasRef: RefObject<HTMLCanvasElement>, timelineRef: RefObject<any>) {
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const requestRef = useRef<number>();

    const transitionRef = useRef({
        startTime: 0,
        duration: 4000,
        fromPos: { x: 0, y: 0, z: 0 },
        fromRot: { x: 0, y: 0, z: 0 },
        toRotY: 0,
        fromDims: { x: 0, y: 0, z: 0 },
        fromBR: 0,
        fromCam: { x: 0, y: 0, z: 0 },
        fromZoom: 1,
        fromShapeType: 'Box' as any,
        toShapeType: 'Box' as any,
        active: false
    });

    // Track the actual rendered state in a ref so transitions can pick up exactly where we left off
    const lastRenderedState = useRef<{
        objects: Record<string, { dimensions: any, borderRadius: number, rotation: any, shapeType: any }>,
        scene: { camera: any, zoom: number }
    } | null>(null);

    const lastTransitionHandled = useRef<number>(0);

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
            const { scene, objects, isPlaying, timelineRows, setCurrentTime, lastTransition } = state;

            // Handle new transition trigger
            if (lastTransition && lastTransition.timestamp > lastTransitionHandled.current) {
                const tr = transitionRef.current;
                const obj = objects.find(o => o.id === lastTransition.objectId);
                if (obj && lastTransition.from) {
                    const from = lastTransition.from;

                    tr.startTime = now;
                    tr.duration = lastTransition.duration;

                    // Capture FROM state from the store's snapshot
                    tr.fromPos = { ...from.position };
                    tr.fromRot = { ...from.rotation };
                    tr.toRotY = tr.fromRot.y + 180;

                    tr.fromDims = { ...from.dimensions };
                    tr.fromBR = from.borderRadius;
                    tr.fromShapeType = from.shapeType;
                    tr.toShapeType = obj.shapeType;

                    tr.fromCam = { ...from.camera };
                    tr.fromZoom = from.zoom;

                    tr.active = true;
                    lastTransitionHandled.current = lastTransition.timestamp;

                    console.log(`Transition started for ${obj.name}: ${tr.fromShapeType} -> ${tr.toShapeType}`);
                    console.log(`  Pos: [${tr.fromPos.x.toFixed(2)}, ${tr.fromPos.y.toFixed(2)}, ${tr.fromPos.z.toFixed(2)}] -> [${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}]`);
                    console.log(`  Dims: [${tr.fromDims.x.toFixed(2)}, ${tr.fromDims.y.toFixed(2)}, ${tr.fromDims.z.toFixed(2)}] -> [${obj.dimensions.x.toFixed(2)}, ${obj.dimensions.y.toFixed(2)}, ${obj.dimensions.z.toFixed(2)}]`);
                }
            }

            let time = state.currentTime;
            // ... (rest of the render function remains the same, except we use the local 'scene' and 'objects' variables)
            if (isPlaying && timelineRef.current) {
                time = timelineRef.current.getTime();
                setCurrentTime(time);
            }

            // Map objects with interpolated values
            const interpolatedObjects = objects.map(obj => {
                const baseObj = isPlaying ? {
                    ...obj,
                    position: {
                        x: interpolateProperty(timelineRows, obj.id, 'posX', time, obj.position.x),
                        y: interpolateProperty(timelineRows, obj.id, 'posY', time, obj.position.y),
                        z: interpolateProperty(timelineRows, obj.id, 'posZ', time, obj.position.z),
                    },
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
                } : {
                    ...obj,
                    position: { ...obj.position },
                    dimensions: { ...obj.dimensions },
                    rotation: { ...obj.rotation }
                };

                // Add transient properties for morphing
                return {
                    ...baseObj,
                    shapeTypeNext: baseObj.shapeType,
                    morphFactor: 0.0
                };
            });

            const mainObjectId = objects[0]?.id || 'main-obj';

            const interpolatedScene = {
                ...scene,
                camera: isPlaying ? {
                    x: interpolateProperty(timelineRows, mainObjectId, 'camX', time, scene.camera.x),
                    y: interpolateProperty(timelineRows, mainObjectId, 'camY', time, scene.camera.y),
                    z: interpolateProperty(timelineRows, mainObjectId, 'camZ', time, scene.camera.z),
                } : { ...scene.camera },
                zoom: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'zoom', time, scene.zoom) : scene.zoom,
                bgColor: isPlaying ? interpolateProperty(timelineRows, mainObjectId, 'bgColor', time, scene.bgColor) : scene.bgColor,
            };

            // Transition logic
            const tr = transitionRef.current;
            if (tr.active) {
                const elapsed = now - tr.startTime;
                const progress = Math.min(elapsed / tr.duration, 1);

                // Use Linear easing as requested for continuous flow
                const ease = progress;

                // Smoothly interpolate camera and zoom during transition
                interpolatedScene.camera.x = tr.fromCam.x + (interpolatedScene.camera.x - tr.fromCam.x) * ease;
                interpolatedScene.camera.y = tr.fromCam.y + (interpolatedScene.camera.y - tr.fromCam.y) * ease;
                interpolatedScene.camera.z = tr.fromCam.z + (interpolatedScene.camera.z - tr.fromCam.z) * ease;
                interpolatedScene.zoom = tr.fromZoom + (interpolatedScene.zoom - tr.fromZoom) * ease;

                // Apply transition to active object
                const targetObj: any = interpolatedObjects.find(o => o.id === lastTransition?.objectId) || interpolatedObjects[0];
                if (targetObj) {
                    targetObj.position.x = tr.fromPos.x + (targetObj.position.x - tr.fromPos.x) * ease;
                    targetObj.position.y = tr.fromPos.y + (targetObj.position.y - tr.fromPos.y) * ease;
                    targetObj.position.z = tr.fromPos.z + (targetObj.position.z - tr.fromPos.z) * ease;

                    targetObj.rotation.x = tr.fromRot.x + (targetObj.rotation.x - tr.fromRot.x) * ease;
                    targetObj.rotation.y = tr.fromRot.y + (tr.toRotY - tr.fromRot.y) * ease;
                    targetObj.rotation.z = tr.fromRot.z + (targetObj.rotation.z - tr.fromRot.z) * ease;

                    targetObj.dimensions.x = tr.fromDims.x + (targetObj.dimensions.x - tr.fromDims.x) * ease;
                    targetObj.dimensions.y = tr.fromDims.y + (targetObj.dimensions.y - tr.fromDims.y) * ease;
                    targetObj.dimensions.z = tr.fromDims.z + (targetObj.dimensions.z - tr.fromDims.z) * ease;
                    targetObj.borderRadius = tr.fromBR + (targetObj.borderRadius - tr.fromBR) * ease;

                    // Morphing setup
                    targetObj.shapeType = tr.fromShapeType;
                    targetObj.shapeTypeNext = tr.toShapeType;
                    targetObj.morphFactor = ease;
                }

                if (progress >= 1) {
                    tr.active = false;
                    // Persist the rotation in the store to avoid snapping back
                    if (lastTransition) {
                        const s = useSceneStore.getState();
                        const obj = s.objects.find(o => o.id === lastTransition.objectId);
                        if (obj) {
                            s.updateObject(obj.id, {
                                rotation: {
                                    x: tr.fromRot.x + (obj.rotation.x - tr.fromRot.x),
                                    y: tr.toRotY,
                                    z: tr.fromRot.z + (obj.rotation.z - tr.fromRot.z)
                                }
                            });
                        }
                    }
                }
            }

            // Save the current state for the next frame's potential transition start
            lastRenderedState.current = {
                scene: { camera: { ...interpolatedScene.camera }, zoom: interpolatedScene.zoom },
                objects: interpolatedObjects.reduce((acc, obj) => {
                    acc[obj.id] = {
                        dimensions: { ...obj.dimensions },
                        borderRadius: obj.borderRadius,
                        rotation: { ...obj.rotation },
                        shapeType: (obj as any).shapeTypeNext // The target shape of this frame
                    };
                    return acc;
                }, {} as any)
            };

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
