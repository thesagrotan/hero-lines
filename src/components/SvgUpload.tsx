import React, { useRef, useCallback } from 'react';
import { useSceneStore } from '../store/sceneStore';
import './SvgUpload.css';

/**
 * Component that provides SVG file upload and extrusion controls.
 * Only renders when the selected object's shapeType is 'SVG'.
 */
export const SvgUpload: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
    const objects = useSceneStore((s) => s.objects);
    const updateObject = useSceneStore((s) => s.updateObject);

    const obj = objects.find((o) => o.id === selectedObjectId);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedObjectId) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const svgString = evt.target?.result as string;
            if (!svgString) return;

            const currentObj = useSceneStore.getState().objects.find(o => o.id === selectedObjectId);
            const currentDepth = currentObj?.svgData?.extrusionDepth ?? 0.5;

            updateObject(selectedObjectId, {
                svgData: {
                    svgString,
                    extrusionDepth: currentDepth,
                }
            });
        };
        reader.readAsText(file);
    }, [selectedObjectId, updateObject]);

    const handleExtrusionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedObjectId) return;
        const value = parseFloat(e.target.value);
        const currentObj = useSceneStore.getState().objects.find(o => o.id === selectedObjectId);
        if (!currentObj?.svgData) return;

        updateObject(selectedObjectId, {
            svgData: {
                ...currentObj.svgData,
                extrusionDepth: value,
            }
        });
    }, [selectedObjectId, updateObject]);

    if (!obj || obj.shapeType !== 'SVG') return null;

    return (
        <div className="svg-upload-panel">
            <div className="svg-upload-header">SVG Shape</div>

            <button
                className="svg-upload-btn"
                onClick={() => fileInputRef.current?.click()}
            >
                {obj.svgData?.svgString ? '✓ SVG Loaded — Change' : 'Upload SVG'}
            </button>

            <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
            />

            <div className="svg-upload-control">
                <label htmlFor="extrusion-depth">Extrusion Depth</label>
                <input
                    id="extrusion-depth"
                    type="range"
                    min="0.05"
                    max="2.0"
                    step="0.05"
                    value={obj.svgData?.extrusionDepth ?? 0.5}
                    onChange={handleExtrusionChange}
                />
                <span className="svg-upload-value">
                    {(obj.svgData?.extrusionDepth ?? 0.5).toFixed(2)}
                </span>
            </div>
        </div>
    );
};
