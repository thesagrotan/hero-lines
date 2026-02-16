import React from 'react';
import { useSceneStore } from '../store/sceneStore';

export const AddObjectButton: React.FC = () => {
    const addObject = useSceneStore((state) => state.addObject);

    return (
        <button className="add-object-btn" onClick={addObject} title="Add New Object">
            <span className="add-icon">+</span>
            <span className="add-label">New Object</span>
        </button>
    );
};
