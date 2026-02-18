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
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${snapshot.scene.bgColor}}
canvas{display:block;width:100%;height:100%}
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
const FS_SOURCE = ${JSON.stringify(fsSource)};

// ── SVG SDF Module ──
${svgSdfCode}

// ── Renderer ──
${getSnapshotRendererSource()}

// ── Boot ──
(function() {
    const canvas = document.getElementById('c');
    const renderer = initSnapshot(canvas, SNAPSHOT, VS_SOURCE, FS_SOURCE, ${svgSdfModuleRef}, 1.0);
    if (!renderer) return;

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas);
    renderer.start();
})();
</script>
</body>
</html>`;
}
