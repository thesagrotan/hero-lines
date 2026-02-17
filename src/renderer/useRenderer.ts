import { useEffect, useRef, type RefObject } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { WebGLRenderer } from './WebGLRenderer';
import { vsSource, fsSource } from '../shaders';
import { TransitionSnapshot, RenderableObject, ShapeType } from '../types';
import { interpolateTransition, createTransitionSnapshot } from '../utils/transitionUtils';
import { buildRenderableObjects } from './renderUtils';

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
                    tr.startTime = now;
                    tr.duration = lastTransition.duration;
                    tr.from = { ...lastTransition.from };
                    tr.toRotY = tr.from.rotation.y + 180;
                    tr.toShapeType = obj.shapeType;
                    tr.active = true;
                    lastTransitionHandled.current = lastTransition.timestamp;
                }
            }

            // Build base renderable objects
            const renderedObjects: RenderableObject[] = buildRenderableObjects(objects);

            const renderedScene = {
                ...scene,
                camera: { ...scene.camera },
                zoom: scene.zoom,
            };

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

            rendererRef.current?.renderFrame(renderedScene, renderedObjects, now);
            requestRef.current = requestAnimationFrame(render);
        };

        const resize = () => {
            if (!canvas) return;
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
