import { getSnapshotRendererSource, getSvgSdfSource } from '../snapshotRenderer';
import { vsSource, fsSource } from '../../shaders';

interface SnapshotData {
    scene: { camera: { x: number; y: number; z: number }; zoom: number; bgColor: string };
    objects: Record<string, unknown>[];
}

/**
 * Generates a self-contained JS file defining a <hero-lines-snapshot> Web Component.
 */
export function generateWebComponentJS(snapshot: SnapshotData): string {
    const needsSvg = snapshot.objects.some(
        (o: any) => o.visible && o.shapeType === 'SVG' && o.svgData?.svgString
    );

    const svgSdfCode = needsSvg ? getSvgSdfSource() : '';
    const svgSdfModuleRef = needsSvg
        ? '{ SDF_SPREAD, parseSvgToSdfTextureAsync, resolution: 512 }'
        : 'null';

    return `(function() {
"use strict";

// ── Snapshot Data ──
const SNAPSHOT = ${JSON.stringify(snapshot)};

// ── Vertex Shader ──
const VS_SOURCE = ${JSON.stringify(vsSource)};

// ── Fragment Shader ──
const FS_SOURCE = ${JSON.stringify(fsSource)};

// ── SVG SDF Module ──
${svgSdfCode}

// ── Renderer ──
${getSnapshotRendererSource()}

class HeroLinesSnapshot extends HTMLElement {
    constructor() {
        super();
        this._renderer = null;
        this._ro = null;
    }

    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = \`
            <style>
                :host { display: block; width: 100%; height: 100%; overflow: hidden; }
                canvas { display: block; width: 100%; height: 100%; }
            </style>
            <canvas></canvas>
        \`;
        const canvas = shadow.querySelector('canvas');
        this._renderer = initSnapshot(canvas, SNAPSHOT, VS_SOURCE, FS_SOURCE, ${svgSdfModuleRef});
        if (!this._renderer) return;

        this._ro = new ResizeObserver(() => this._renderer.resize());
        this._ro.observe(canvas);
        this._renderer.start();
    }

    disconnectedCallback() {
        if (this._ro) this._ro.disconnect();
        if (this._renderer) this._renderer.dispose();
    }

    static get observedAttributes() { return ['paused']; }

    attributeChangedCallback(name, _old, val) {
        if (name === 'paused' && this._renderer) {
            this._renderer.paused = (val !== null);
        }
    }
}

if (!customElements.get('hero-lines-snapshot')) {
    customElements.define('hero-lines-snapshot', HeroLinesSnapshot);
}
})();
`;
}
