import React, { useRef, useMemo } from 'react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import { useSceneStore } from '../store/sceneStore';
import { interpolateProperty } from '../utils/interpolation';
import { TimelineToolbar } from './TimelineToolbar';
import { exportScene, importScene } from '../utils/io';

export const TimelinePanel: React.FC = () => {
    const {
        objects,
        scene,
        setScene,
        timelineRows,
        setTimelineRows,
        isPlaying,
        setIsPlaying,
        currentTime,
        setCurrentTime
    } = useSceneStore();

    const timelineRef = useRef<any>(null);
    const sidebarRowsRef = useRef<HTMLDivElement>(null);
    const [showTimeline, setShowTimeline] = React.useState(true);

    const handleDoubleClickAction = (_e: any, { action, row }: any) => {
        const v = prompt('Value:', String(action.data.value));
        if (v !== null) {
            const newValue = isNaN(Number(v)) ? v : Number(v);
            setTimelineRows(timelineRows.map(r =>
                `${r.objectId}-${r.property}` === row.id
                    ? { ...r, actions: r.actions.map(a => a.id === action.id ? { ...a, data: { value: newValue } } : a) }
                    : r
            ));
        }
    };

    const handleContextMenuAction = (_e: any, { action, row }: any) => {
        if (confirm('Delete?')) {
            setTimelineRows(timelineRows.map(r =>
                `${r.objectId}-${r.property}` === row.id
                    ? { ...r, actions: r.actions.filter(a => a.id !== action.id) }
                    : r
            ));
        }
    };

    const handleExport = () => {
        exportScene(scene, objects, timelineRows);
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (confirm('Import data? This will overwrite current scene.')) {
            try {
                const data = await importScene(file);
                useSceneStore.setState({
                    scene: data.scene,
                    objects: data.objects,
                    timelineRows: data.timeline
                });

                if (timelineRef.current) timelineRef.current.setTime(0);
                setCurrentTime(0);
            } catch (err) {
                alert('Error importing file: ' + (err as Error).message);
            }
        }
        e.target.value = '';
    };

    // Group rows by object for the sidebar and editor
    // We sort them so they appear together
    const sortedTimelineRows = useMemo(() => {
        return [...timelineRows].sort((a, b) => {
            if (a.objectId !== b.objectId) {
                const objA = objects.find(o => o.id === a.objectId);
                const objB = objects.find(o => o.id === b.objectId);
                return (objA?.name || '').localeCompare(objB?.name || '');
            }
            return a.property.localeCompare(b.property);
        });
    }, [timelineRows, objects]);

    if (!showTimeline) {
        return (
            <button
                className="timeline-toggle-show"
                onClick={() => setShowTimeline(true)}
                style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 100 }}
            >
                <span>Show Timeline</span>
            </button>
        );
    }

    return (
        <div className="timeline-container" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '300px', background: '#111', display: 'flex', flexDirection: 'column', zIndex: 100 }}>
            <TimelineToolbar
                timelineRef={timelineRef}
                onExport={handleExport}
                onImport={handleImport}
            />

            {/* Summary Bar */}
            <div style={{ display: 'flex', gap: '15px', padding: '5px 10px', background: '#1a1a1a', borderBottom: '1px solid #333', overflowX: 'auto', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
                {sortedTimelineRows.map((row) => {
                    const obj = objects.find(o => o.id === row.objectId);
                    return (
                        <div key={`${row.objectId}-${row.property}-summary`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: '60px' }}>
                            <span style={{ color: '#888', fontSize: '9px', whiteSpace: 'nowrap' }}>{obj ? `${obj.name}: ` : ''}{row.property}</span>
                            <span style={{ color: '#00ff00', fontSize: '11px', fontFamily: 'monospace' }}>
                                {(() => {
                                    const v = interpolateProperty(timelineRows, row.objectId, row.property, currentTime, 0);
                                    return typeof v === 'number' ? v.toFixed(2) : String(v)
                                })()}
                            </span>
                        </div>
                    );
                })}
                <button
                    onClick={() => setShowTimeline(false)}
                    style={{ marginLeft: 'auto', background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                >
                    Hide
                </button>
            </div>

            <div className="timeline-body" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <div style={{ width: '180px', background: '#1a1a1a', borderRight: '1px solid #333', overflowY: 'hidden' }}>
                    <div style={{ height: '32px', borderBottom: '1px solid #333' }} />
                    <div ref={sidebarRowsRef} style={{ flex: 1, overflowY: 'hidden' }}>
                        {sortedTimelineRows.map((row, idx) => {
                            const obj = objects.find(o => o.id === row.objectId);
                            return (
                                <div key={`${row.objectId}-${row.property}-sidebar`} style={{ height: '32px', display: 'flex', alignItems: 'center', padding: '0 10px', color: '#ccc', fontSize: '11px', borderBottom: '1px solid #222', background: idx % 2 === 0 ? '#1a1a1a' : '#222', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                    <span style={{ color: '#888', marginRight: '4px' }}>{obj?.name}:</span>{row.property}
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div style={{ flex: 1, position: 'relative', background: '#000' }}>
                    <Timeline
                        ref={timelineRef}
                        editorData={sortedTimelineRows.map(r => ({
                            id: `${r.objectId}-${r.property}`,
                            actions: r.actions
                        }))}
                        effects={{ value: { id: 'value', name: 'Value' } }}
                        onChange={(data: any) => {
                            setTimelineRows(timelineRows.map(r => {
                                const newData = data.find((d: any) => d.id === `${r.objectId}-${r.property}`);
                                return newData ? { ...r, actions: newData.actions } : r;
                            }));
                        }}
                        onDoubleClickAction={handleDoubleClickAction}
                        onContextMenuAction={handleContextMenuAction}
                        rowHeight={32}
                        onScroll={({ scrollTop }) => {
                            if (sidebarRowsRef.current) sidebarRowsRef.current.scrollTop = scrollTop;
                        }}
                    />
                </div>
            </div>
        </div>
    );
};
