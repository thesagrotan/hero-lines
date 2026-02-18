import React from 'react';
import { exportSnapshotHTML, exportSnapshotWebComponent } from '../export/snapshotExporter';
import './ExportPanel.css';

export const ExportPanel: React.FC = () => {
    return (
        <div className="export-panel">
            <button className="export-btn" onClick={exportSnapshotHTML} title="Download as self-contained HTML file">
                ⬇ Export HTML
            </button>
            <button className="export-btn" onClick={exportSnapshotWebComponent} title="Download as Web Component JS file">
                ⬇ Export Component
            </button>
        </div>
    );
};
