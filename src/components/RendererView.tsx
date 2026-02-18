import React, { useRef, useEffect } from 'react';
import { useRenderer } from '../renderer/useRenderer';
import { useSceneStore } from '../store/sceneStore';
import { vec3 } from '../utils/math';

export const RendererView: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });

    const { setScene } = useSceneStore();

    // Initialize renderer hooks
    useRenderer(canvasRef);

    // Mouse controls for moving and rotating the object
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let dragMode: 'none' | 'move' | 'rotate' = 'none';

        const onMouseDown = (e: MouseEvent) => {
            const state = useSceneStore.getState();
            if (!state.selectedObjectId) return;

            if (e.button === 0) {
                // If Alt (Option) is pressed, rotate instead of move
                dragMode = e.altKey ? 'rotate' : 'move';
            } else if (e.button === 2) {
                dragMode = 'rotate';
                e.preventDefault();
            } else {
                return;
            }

            isDragging.current = true;
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = dragMode === 'move' ? 'move' : 'crosshair';
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;

            const state = useSceneStore.getState();
            const selectedObject = state.getSelectedObject();
            if (!selectedObject) return;

            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            lastMousePos.current = { x: e.clientX, y: e.clientY };

            if (dragMode === 'move') {
                const iz = 1.0 / state.scene.zoom;
                const camPos = [state.scene.camera.x * iz, state.scene.camera.y * iz, state.scene.camera.z * iz] as [number, number, number];

                const fwd = vec3.normalize([-camPos[0], -camPos[1], -camPos[2]]);
                const upWorld = [0, 1, 0] as [number, number, number];
                let right = vec3.normalize(vec3.cross(upWorld, fwd));

                if (Math.abs(vec3.dot(upWorld, fwd)) > 0.99) {
                    right = vec3.normalize(vec3.cross([1, 0, 0], fwd));
                }

                const up = vec3.cross(fwd, right);
                const sensitivity = (10.0 / window.innerHeight) / state.scene.zoom;

                const moveX = vec3.multiplyScalar(right, dx * sensitivity);
                const moveY = vec3.multiplyScalar(up, -dy * sensitivity);

                state.updateObject(selectedObject.id, {
                    position: {
                        x: selectedObject.position.x + moveX[0] + moveY[0],
                        y: selectedObject.position.y + moveX[1] + moveY[1],
                        z: selectedObject.position.z + moveX[2] + moveY[2],
                    }
                });
            } else if (dragMode === 'rotate') {
                const rotSensitivity = 0.5;
                state.updateObject(selectedObject.id, {
                    rotation: {
                        x: selectedObject.rotation.x + dy * rotSensitivity,
                        y: selectedObject.rotation.y + dx * rotSensitivity,
                        z: selectedObject.rotation.z
                    }
                });
            }
        };

        const onMouseUp = () => {
            isDragging.current = false;
            dragMode = 'none';
            if (canvas) canvas.style.cursor = 'grab';
        };

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        return () => {
            canvas.removeEventListener('mousedown', onMouseDown);
            canvas.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    // Zoom via wheel
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const wheel = (e: WheelEvent) => {
            const state = useSceneStore.getState();
            e.preventDefault();
            setScene({ zoom: Math.max(0.1, Math.min(2.0, state.scene.zoom - e.deltaY * 0.001)) });
        };

        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', wheel);
        };
    }, [setScene]);

    return <canvas ref={canvasRef} style={{ cursor: 'grab' }} />;
};
