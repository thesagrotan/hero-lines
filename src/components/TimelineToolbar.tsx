import React, { useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';

interface TimelineToolbarProps {
    timelineRef: React.RefObject<any>;
    onExport: () => void;
    onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({ timelineRef, onExport, onImport }) => {
    const {
        isPlaying,
        setIsPlaying,
        currentTime,
        setCurrentTime,
        scene,
        selectedObjectId,
        objects,
        timelineRows,
        setTimelineRows
    } = useSceneStore();

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handlePlayPause = () => {
        if (isPlaying) {
            timelineRef.current?.pause();
            setIsPlaying(false);
        } else {
            timelineRef.current?.play({ autoEnd: true });
            setIsPlaying(true);
        }
    };

    const handleReset = () => {
        timelineRef.current?.setTime(0);
        setCurrentTime(0);
    };

    const handleCaptureKeyframe = () => {
        const obj = objects.find(o => o.id === selectedObjectId);
        if (!obj) return;

        const t = currentTime;
        const map: any = {
            camX: scene.camera.x, camY: scene.camera.y, camZ: scene.camera.z, zoom: scene.zoom, bgColor: scene.bgColor,
            boxX: obj.dimensions.x, boxY: obj.dimensions.y, boxZ: obj.dimensions.z,
            rotX: obj.rotation.x, rotY: obj.rotation.y, rotZ: obj.rotation.z,
            shapeType: obj.shapeType, borderRadius: obj.borderRadius, numLines: obj.numLines,
            thickness: obj.thickness, orientation: obj.orientation, speed: obj.speed,
            longevity: obj.longevity, ease: obj.ease, color1: obj.color1, color2: obj.color2, rimColor: obj.rimColor
        };

        setTimelineRows(timelineRows.map(row => {
            const val = map[row.property];
            if (val === undefined || row.objectId !== obj.id) return row;

            const idx = row.actions.findIndex(a => Math.abs(a.start - t) < 0.1);
            let acts = [...row.actions];

            if (idx >= 0) {
                acts[idx] = { ...acts[idx], data: { ...acts[idx].data, value: val } };
            } else {
                acts.push({
                    id: `${row.property}-${Date.now()}`,
                    start: t,
                    end: t + 0.1,
                    effectId: 'value',
                    data: { value: val }
                });
            }
            return { ...row, actions: acts };
        }));
    };

    return (
        <div style={{ padding: '8px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid #333', background: '#222' }}>
            <button
                onClick={handlePlayPause}
                style={{ padding: '6px 16px', cursor: 'pointer', background: isPlaying ? '#ff4444' : '#44ff44', border: 'none', color: '#000', borderRadius: '4px', fontWeight: 'bold' }}
            >
                {isPlaying ? 'Pause' : 'Play'}
            </button>
            <span style={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace', minWidth: '80px' }}>
                {currentTime.toFixed(2)}s
            </span>
            <button
                onClick={handleCaptureKeyframe}
                style={{ padding: '6px 12px', background: '#0d66ff', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
            >
                Capture
            </button>
            <button
                onClick={handleReset}
                style={{ padding: '6px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
                Reset
            </button>
            <button
                onClick={onExport}
                style={{ padding: '6px 12px', background: '#ec4899', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
                Export
            </button>
            <button
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '6px 12px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
                Import
            </button>
            <input
                type="file"
                ref={fileInputRef}
                onChange={onImport}
                accept=".json"
                style={{ display: 'none' }}
            />
        </div>
    );
};
