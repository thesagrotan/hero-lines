import { useEffect, useRef, type RefObject } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { WebGLRenderer } from './WebGLRenderer';
import { SvgSdfManager } from './SvgSdfManager';
import { vsSource, fsSource, prepassSource } from '../shaders';
import { TransitionSnapshot, RenderableObject, ShapeType } from '../types';
import { interpolateTransition, createTransitionSnapshot } from '../utils/transitionUtils';
import { updateRenderableObjects } from './renderUtils';

export function useRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const requestRef = useRef<number>();

    const transitionRef = useRef({
        startTime: 0,
        duration: 4000,
        from: null as TransitionSnapshot | null,
        toRotY: 0,
        toShapeType: 'Box' as ShapeType,
        active: false
    });

    const lastTransitionHandled = useRef<number>(0);
    const renderedObjectsRef = useRef<RenderableObject[]>([]);


    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Initialize renderer
        let svgSdfManager: SvgSdfManager;
        try {
            rendererRef.current = new WebGLRenderer(canvas, vsSource, fsSource, prepassSource);
            svgSdfManager = new SvgSdfManager(512);
        } catch (err) {
            console.error('Failed to initialize WebGL renderer:', err);
            return;
        }

        // Keep a local reference to the store state to avoid calling getState() every frame
        let state = useSceneStore.getState();
        let lastScale = state.scene.resolutionScale;

        const resize = () => {
            if (!canvas) return;
            const currentScale = useSceneStore.getState().scene.resolutionScale;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr * currentScale;
            canvas.height = window.innerHeight * dpr * currentScale;
            canvas.style.width = window.innerWidth + 'px';
            canvas.style.height = window.innerHeight + 'px';
            rendererRef.current?.resize(canvas.width, canvas.height);
        };

        const unsubscribe = useSceneStore.subscribe((newState) => {
            if (newState.scene.resolutionScale !== lastScale) {
                lastScale = newState.scene.resolutionScale;
                resize();
            }
            state = newState;
        });

        let frames = 0;
        let lastTime = 0;

        const render = (now: number) => {
            const { scene, objects, lastTransition, updateObject, setFps } = state;

            // Update FPS count
            frames++;
            if (now - lastTime >= 1000) {
                setFps(Math.round((frames * 1000) / (now - lastTime)));
                frames = 0;
                lastTime = now;
            }

            // Handle new transition trigger
            if (lastTransition && lastTransition.timestamp > lastTransitionHandled.current) {
                const tr = transitionRef.current;
                const obj = objects.find(o => o.id === lastTransition.objectId);
                if (obj && lastTransition.from) {
                    tr.startTime = now;
                    tr.duration = lastTransition.duration;
                    tr.from = { ...lastTransition.from };
                    tr.toRotY = tr.from.rotation.y + 180;
                    tr.toShapeType = obj.shapeType;
                    tr.active = true;
                    lastTransitionHandled.current = lastTransition.timestamp;
                }
            }

            // Build base renderable objects (using persistent buffer to avoid allocations)
            updateRenderableObjects(objects, renderedObjectsRef.current);
            const renderedObjects = renderedObjectsRef.current;


            const renderedScene = {
                ...scene,
                zoom: scene.zoom,
            };

            // Infinite Pass Animation Logic
            if (scene.infinitePass.enabled) {
                const pass = scene.infinitePass;
                const totalSpacing = pass.spacing * renderedObjects.length;
                const offset = (now * 0.001 * pass.speed) % totalSpacing;

                const focusZ = 0.0;
                const rangeZ = totalSpacing * 0.5;

                renderedObjects.forEach((obj, i) => {
                    // Linear Z from -rangeZ to +rangeZ relative to focusZ
                    let linearZ = (obj.position.z + offset) % totalSpacing;
                    if (linearZ > totalSpacing * 0.5) linearZ -= totalSpacing;
                    if (linearZ < -totalSpacing * 0.5) linearZ += totalSpacing;

                    // Normalize linearZ to [-1, 1]
                    const t = linearZ / (totalSpacing * 0.5);

                    // Warp Z: Blend linear and cubic to prevent absolute clustering at the center
                    // This ensures objects keep moving and don't overlap as easily
                    const warpedT = (0.15 * t) + (0.85 * Math.pow(t, 3));
                    obj.position.z = focusZ + warpedT * 25.0; // Increased visual stretch

                    // Dynamic Rotation: Rotate more as it gets further from the focus
                    const rotationIntensity = t * t * 45; // Max 45 degrees rotation at edges
                    obj.rotation.y += rotationIntensity;
                    obj.rotation.x += rotationIntensity * 0.5;
                });
            }

            // Transition logic
            const tr = transitionRef.current;
            if (tr.active && tr.from) {
                const elapsed = now - tr.startTime;
                const progress = Math.min(elapsed / tr.duration, 1);

                // Apply transition to active object
                const targetObj = renderedObjects.find(o => o.id === lastTransition?.objectId);
                if (targetObj) {
                    const interpolated = interpolateTransition(
                        tr.from,
                        createTransitionSnapshot(targetObj, scene),
                        progress,
                        tr.toRotY
                    );

                    // Update camera and object from interpolated values
                    renderedScene.camera = interpolated.camera;
                    renderedScene.zoom = interpolated.zoom;

                    targetObj.position = interpolated.position;
                    targetObj.dimensions = interpolated.dimensions;
                    targetObj.borderRadius = interpolated.borderRadius;
                    targetObj.rotation = interpolated.rotation;

                    // Morphing setup
                    targetObj.shapeType = tr.from.shapeType;
                    targetObj.shapeTypeNext = tr.toShapeType;
                    targetObj.morphFactor = progress;
                }

                if (progress >= 1) {
                    tr.active = false;
                    // Persist the rotation in the store to avoid snapping back
                    if (lastTransition && targetObj) {
                        updateObject(lastTransition.objectId, {
                            rotation: { ...targetObj.rotation }
                        });
                    }
                }
            }

            // Upload SVG SDF texture if any object needs it
            const svgObj = renderedObjects.find(
                o => o.visible && (o.shapeType === 'SVG' || o.shapeTypeNext === 'SVG') && o.svgData?.svgString
            );
            if (svgObj?.svgData?.svgString && rendererRef.current) {
                const sdf = svgSdfManager.getSdf(svgObj.svgData.svgString);
                if (sdf) {
                    rendererRef.current.uploadSvgSdfTexture(sdf, svgSdfManager.getResolution());
                }
            }

            rendererRef.current?.renderFrame(renderedScene, renderedObjects, now);
            requestRef.current = requestAnimationFrame(render);
        };

        window.addEventListener('resize', resize);
        resize();
        requestRef.current = requestAnimationFrame(render);

        return () => {
            unsubscribe();
            window.removeEventListener('resize', resize);
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            rendererRef.current?.dispose();
        };

    }, [canvasRef]);

    return rendererRef;
}
