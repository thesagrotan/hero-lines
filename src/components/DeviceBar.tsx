import React, { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { DEVICE_TEMPLATES } from '../data/deviceTemplates';

export const DeviceBar: React.FC = () => {
    const {
        selectedObjectId,
        updateObject,
        scene,
        setScene,
        triggerTransition
    } = useSceneStore();

    const [cycling, setCycling] = useState(false);

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
            shapeType: t.shapeType
        });
    };

    const handleCycleAll = () => {
        const names = Object.keys(DEVICE_TEMPLATES);
        const duration = scene.transitionSpeed;
        const pause = 400;

        setCycling(true);
        names.forEach((name, i) => {
            setTimeout(() => {
                applyTemplate(name);
                if (i === names.length - 1) {
                    setTimeout(() => setCycling(false), duration + pause);
                }
            }, i * (duration + pause));
        });
    };

    return (
        <div className="template-bar">
            {Object.keys(DEVICE_TEMPLATES).map(name => (
                <button
                    key={name}
                    className="template-btn"
                    onClick={() => applyTemplate(name)}
                    disabled={cycling || !selectedObjectId}
                >
                    <span className="template-icon">
                        {name === 'Smartwatch' ? '⌚' : name === 'Mobile' ? '📱' : name === 'Tablet' ? '📲' : '💻'}
                    </span>
                    <span className="template-label">{name}</span>
                </button>
            ))}
            <button
                className="template-btn"
                onClick={handleCycleAll}
                disabled={cycling || !selectedObjectId}
                style={{ borderLeft: '1px solid #555' }}
            >
                <span className="template-icon">{cycling ? '⏳' : '🔄'}</span>
                <span className="template-label">{cycling ? 'Playing...' : 'Demo All'}</span>
            </button>
        </div>
    );
};
