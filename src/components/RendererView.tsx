import React, { useRef, useEffect } from 'react';
import { useRenderer } from '../renderer/useRenderer';
import { useSceneStore } from '../store/sceneStore';

export const RendererView: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { scene, setScene } = useSceneStore();

    // Initialize renderer hooks
    useRenderer(canvasRef);

    // Zoom via wheel
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            setScene({ zoom: Math.max(0.1, Math.min(2.0, scene.zoom - e.deltaY * 0.001)) });
        };

        canvas.addEventListener('wheel', wheel, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', wheel);
        };
    }, [scene.zoom, setScene]);

    return <canvas ref={canvasRef} />;
};
