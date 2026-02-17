import { useEffect, useRef, type RefObject } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { WebGLRenderer } from './WebGLRenderer';
import { vsSource, fsSource } from '../shaders';

export function useRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
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
            const { scene, objects, lastTransition, updateObject } = state;

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
                }
            }

            // Map objects
            const renderedObjects = objects.map(obj => {
                const baseObj = {
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

            const renderedScene = {
                ...scene,
                camera: { ...scene.camera },
                zoom: scene.zoom,
                bgColor: scene.bgColor,
            };

            // Transition logic
            const tr = transitionRef.current;
            if (tr.active) {
                const elapsed = now - tr.startTime;
                const progress = Math.min(elapsed / tr.duration, 1);
                const ease = progress;

                // Smoothly interpolate camera and zoom during transition
                renderedScene.camera.x = tr.fromCam.x + (renderedScene.camera.x - tr.fromCam.x) * ease;
                renderedScene.camera.y = tr.fromCam.y + (renderedScene.camera.y - tr.fromCam.y) * ease;
                renderedScene.camera.z = tr.fromCam.z + (renderedScene.camera.z - tr.fromCam.z) * ease;
                renderedScene.zoom = tr.fromZoom + (renderedScene.zoom - tr.fromZoom) * ease;

                // Apply transition to active object
                const targetObj: any = renderedObjects.find(o => o.id === lastTransition?.objectId) || renderedObjects[0];
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
                        const obj = state.objects.find(o => o.id === lastTransition.objectId);
                        if (obj) {
                            updateObject(obj.id, {
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

            rendererRef.current?.renderFrame(renderedScene, renderedObjects, now);
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

    return rendererRef;
}
