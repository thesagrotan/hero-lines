import { useSceneStore } from '../store/sceneStore';
import { SceneObject, SceneState } from '../types';
import { generateStandaloneHTML } from './templates/standalone.html';
import { generateWebComponentJS } from './templates/webcomponent.js';

/**
 * Strips editor-only fields from SceneState, keeping only rendering-relevant data.
 */
function snapshotScene(scene: SceneState) {
    return {
        camera: { ...scene.camera },
        zoom: scene.zoom,
        bgColor: scene.bgColor,
    };
}

/**
 * Strips editor-only fields from SceneObject[], keeping all rendering properties.
 */
function snapshotObjects(objects: SceneObject[]) {
    return objects
        .filter(o => o.visible)
        .map(o => {
            const snap: Record<string, unknown> = {
                visible: true,
                position: { ...o.position },
                dimensions: { ...o.dimensions },
                rotation: { ...o.rotation },
                shapeType: o.shapeType,
                borderRadius: o.borderRadius,
                orientation: o.orientation,
                numLines: o.numLines,
                thickness: o.thickness,
                speed: o.speed,
                longevity: o.longevity,
                ease: o.ease,
                color1: o.color1,
                color2: o.color2,
                rimColor: o.rimColor,
                timeNoise: o.timeNoise,
                svgExtrusionDepth: o.svgExtrusionDepth,
                rimIntensity: o.rimIntensity,
                rimPower: o.rimPower,
                wireOpacity: o.wireOpacity,
                wireIntensity: o.wireIntensity,
                layerDelay: o.layerDelay,
                torusThickness: o.torusThickness,
                lineBrightness: o.lineBrightness,
                bendAmount: o.bendAmount,
                bendAngle: o.bendAngle,
                bendAxis: o.bendAxis,
                bendOffset: o.bendOffset,
                bendLimit: o.bendLimit,
                wobbleAmount: o.wobbleAmount,
                wobbleSpeed: o.wobbleSpeed,
                wobbleScale: o.wobbleScale,
                chromaticAberration: o.chromaticAberration,
                pulseIntensity: o.pulseIntensity,
                pulseSpeed: o.pulseSpeed,
                scanlineIntensity: o.scanlineIntensity,
                compositeMode: o.compositeMode,
                secondaryShapeType: o.secondaryShapeType,
                secondaryPosition: { ...o.secondaryPosition },
                secondaryRotation: { ...o.secondaryRotation },
                secondaryDimensions: { ...o.secondaryDimensions },
                compositeSmoothness: o.compositeSmoothness,
            };

            // Only include SVG data if the object uses SVG shape
            if (o.shapeType === 'SVG' && o.svgData?.svgString) {
                snap.svgData = {
                    svgString: o.svgData.svgString,
                    extrusionDepth: o.svgData.extrusionDepth,
                };
            }

            return snap;
        });
}

function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function getTimestamp(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Export the current scene as a self-contained HTML file.
 */
export function exportSnapshotHTML() {
    const { scene, objects } = useSceneStore.getState();
    const snapshot = {
        scene: snapshotScene(scene),
        objects: snapshotObjects(objects),
    };
    const html = generateStandaloneHTML(snapshot);
    downloadFile(html, `hero-lines-${getTimestamp()}.html`, 'text/html');
}

/**
 * Export the current scene as a Web Component JS file.
 */
export function exportSnapshotWebComponent() {
    const { scene, objects } = useSceneStore.getState();
    const snapshot = {
        scene: snapshotScene(scene),
        objects: snapshotObjects(objects),
    };
    const js = generateWebComponentJS(snapshot);
    downloadFile(js, `hero-lines-${getTimestamp()}.js`, 'application/javascript');
}
