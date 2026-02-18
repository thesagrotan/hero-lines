import React from 'react';
import { useSceneStore } from '../store/sceneStore';
import { AddObjectButton } from './AddObjectButton';
import './ObjectList.css';

export const ObjectList: React.FC = () => {
    const {
        objects,
        selectedObjectId,
        selectObject,
        updateObject,
        applySettingsToAll,
        removeObject,
        duplicateObject
    } = useSceneStore();

    return (
        <div className="object-list-panel">
            <div className="object-list-header">
                <h3>Objects</h3>
            </div>

            <div className="object-list-content">
                {objects.map((obj) => (
                    <div
                        key={obj.id}
                        className={`object-item ${selectedObjectId === obj.id ? 'selected' : ''}`}
                        onClick={() => selectObject(obj.id)}
                    >
                        <div className="object-item-main">
                            <button
                                className={`visibility-toggle ${!obj.visible ? 'hidden' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    updateObject(obj.id, { visible: !obj.visible });
                                }}
                                title={obj.visible ? "Hide Object" : "Show Object"}
                            >
                                {obj.visible ? '👁️' : '👁️‍🗨️'}
                            </button>
                            <span className="object-name">{obj.name}</span>
                        </div>

                        <div className="object-item-actions">
                            <button
                                className="action-btn duplicate"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    duplicateObject(obj.id);
                                }}
                                title="Duplicate Object"
                            >
                                📑
                            </button>
                            <button
                                className="action-btn apply-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    applySettingsToAll(obj.id, 'colors');
                                }}
                                title="Apply Colors to All"
                            >
                                🎨
                            </button>
                            <button
                                className="action-btn apply-lines"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    applySettingsToAll(obj.id, 'lines');
                                }}
                                title="Apply Lines to All"
                            >
                                📏
                            </button>
                            <button
                                className="action-btn delete"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (objects.length > 1) {
                                        removeObject(obj.id);
                                    } else {
                                        alert("Cannot delete the last object.");
                                    }
                                }}
                                title="Delete Object"
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="object-list-footer">
                <AddObjectButton />
            </div>
        </div>
    );
};
