import React, { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { DEVICE_TEMPLATES } from '../data/deviceTemplates';

export const DeviceBar: React.FC = () => {
    const {
        selectedObjectId,
        updateObject,
        scene,
        setScene,
        triggerTransition,
        toggleAutoCycle
    } = useSceneStore();

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
            position: t.position,
            dimensions: t.dimensions,
            borderRadius: t.borderRadius,
            rotation: t.rotation,
            shapeType: t.shapeType,
            orientation: t.orientation
        });
    };

    const isAutoCycling = scene.autoCycle.enabled;

    return (
        <div className="template-bar">
            {Object.keys(DEVICE_TEMPLATES).map(name => (
                <button
                    key={name}
                    className="template-btn"
                    onClick={() => applyTemplate(name)}
                    disabled={isAutoCycling || !selectedObjectId}
                >
                    <span className="template-icon">
                        {name === 'Smartwatch' ? '⌚' : name === 'Mobile' ? '📱' : name === 'Tablet' ? '📲' : '💻'}
                    </span>
                    <span className="template-label">{name}</span>
                </button>
            ))}
            <button
                className={`template-btn ${isAutoCycling ? 'active' : ''}`}
                onClick={toggleAutoCycle}
                disabled={!selectedObjectId}
                style={{ borderLeft: '1px solid #555' }}
            >
                <span className="template-icon">{isAutoCycling ? '⏹️' : '🔄'}</span>
                <span className="template-label">{isAutoCycling ? 'Stop Animation' : 'Auto Cycle'}</span>
            </button>
        </div>
    );
};
