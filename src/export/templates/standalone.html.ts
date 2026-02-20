import { getSnapshotRendererSource, getSvgSdfSource } from '../snapshotRenderer';
import { vsSource, fsSource } from '../../shaders';

interface SnapshotData {
    scene: { camera: { x: number; y: number; z: number }; zoom: number; bgColor: string };
    objects: Record<string, unknown>[];
}

/**
 * Generates a self-contained HTML page that renders the snapshot.
 */
export function generateStandaloneHTML(snapshot: SnapshotData): string {
    const needsSvg = snapshot.objects.some(
        (o: any) => o.visible && o.shapeType === 'SVG' && o.svgData?.svgString
    );

    const svgSdfCode = needsSvg ? getSvgSdfSource() : '';
    const svgSdfModuleRef = needsSvg
        ? '{ SDF_SPREAD, parseSvgToSdfTextureAsync, resolution: 512 }'
        : 'null';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hero Lines Snapshot</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: ${snapshot.scene.bgColor}; }
canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
// ── Snapshot Data ──
const SNAPSHOT = ${JSON.stringify(snapshot)};

// ── Vertex Shader ──
const VS_SOURCE = ${JSON.stringify(vsSource)};

// ── Fragment Shader ──
const FS_SOURCE = ${JSON.stringify(fsSource.replace('#version 300 es', `#version 300 es
#define EXPORT_MODE
#define MAX_STEPS 48
#define MIN_STEPS 16
#define MAX_BACK_STEPS 24
#define HIT_EPS 0.003
#define SIMPLE_BACKFACE_NORMALS`))};

// ── SVG SDF Module ──
${svgSdfCode}

// ── Renderer ──
${getSnapshotRendererSource()}

// ── Boot ──
(function() {
    const canvas = document.getElementById('c');
    const renderer = initSnapshot(canvas, SNAPSHOT, VS_SOURCE, FS_SOURCE, ${svgSdfModuleRef}, SNAPSHOT.scene.resolutionScale || 0.75);
    if (!renderer) return;

    window.addEventListener('resize', () => renderer.resize());
    renderer.start();
})();
</script>
</body>
</html>`;
}
