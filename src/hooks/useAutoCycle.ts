import { useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { DEVICE_TEMPLATES } from '../data/deviceTemplates';

export const useAutoCycle = () => {
    const {
        selectedObjectId,
        updateObject,
        scene,
        setScene,
        triggerTransition
    } = useSceneStore();

    const timeoutRef = useRef<any>(null);
    const currentIndexRef = useRef(0);
    const names = Object.keys(DEVICE_TEMPLATES);

    const applyTemplate = (name: string) => {
        const t = DEVICE_TEMPLATES[name];
        if (!t || !selectedObjectId) return;

        // Trigger transition animation in the store
        triggerTransition(selectedObjectId, scene.transitionSpeed);

        // Update scene settings
        setScene({
            camera: t.camera,
            zoom: t.zoom
        });

        // Update object settings
        updateObject(selectedObjectId, {
            dimensions: t.dimensions,
            borderRadius: t.borderRadius,
            shapeType: t.shapeType,
            orientation: t.orientation
        });
    };

    useEffect(() => {
        if (!scene.autoCycle.enabled || !selectedObjectId) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            return;
        }

        const cycle = () => {
            const nextIndex = (currentIndexRef.current + 1) % names.length;
            currentIndexRef.current = nextIndex;
            const nextName = names[nextIndex];

            // Getting fresh values from store to ensure we use the latest settings
            const { scene } = useSceneStore.getState();
            applyTemplate(nextName);

            const totalDuration = scene.transitionSpeed + scene.autoCycle.pauseTime;
            timeoutRef.current = setTimeout(cycle, totalDuration);
        };

        // When enabled, start first transition immediately
        const nextIndex = (currentIndexRef.current + 1) % names.length;
        currentIndexRef.current = nextIndex;
        applyTemplate(names[nextIndex]);

        const totalDuration = scene.transitionSpeed + scene.autoCycle.pauseTime;
        timeoutRef.current = setTimeout(cycle, totalDuration);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [scene.autoCycle.enabled, selectedObjectId]); // Transition speed and pause time handled inside cycle to avoid restarting useEffect on every change

    return null;
};
