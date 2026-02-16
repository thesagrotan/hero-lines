import { SceneState, SceneObject, ObjectTimelineRow } from '../types';
import { migrateV1ToV2, SceneDataV2 } from './migration';

export function exportScene(scene: SceneState, objects: SceneObject[], timeline: ObjectTimelineRow[]) {
    const data: SceneDataV2 = {
        version: 2,
        scene,
        objects,
        timeline
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hero-lines-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export async function importScene(file: File): Promise<SceneDataV2> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const rawData = JSON.parse(event.target?.result as string);
                const migratedData = migrateV1ToV2(rawData);
                resolve(migratedData);
            } catch (err) {
                reject(new Error('Failed to parse or migrate JSON: ' + (err as Error).message));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}
