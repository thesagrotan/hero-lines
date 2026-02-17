import React from 'react';
import { useSceneStore } from '../store/sceneStore';
import { DEVICE_TEMPLATES } from '../data/deviceTemplates';
import './DeviceBar.css';

export const DeviceBar: React.FC = () => {
    const {
        selectedObjectId,
        scene,
        toggleAutoCycle,
        applyDeviceTemplate
    } = useSceneStore();

    const isAutoCycling = scene.autoCycle.enabled;

    return (
        <div className="template-bar">
            {Object.keys(DEVICE_TEMPLATES).map(name => (
                <button
                    key={name}
                    className="template-btn"
                    onClick={() => applyDeviceTemplate(name)}
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
