import { SceneState, SceneObject } from '../types';
import { createDefaultObject } from './objectFactory';

export interface SceneDataV2 {
    version: 2;
    scene: SceneState;
    objects: SceneObject[];
}

export function migrateV1ToV2(data: any): SceneDataV2 {
    // If it's already V2, return as is (with basic validation)
    if (data.version === 2) {
        return data as SceneDataV2;
    }

    // Default V2 structure
    const migrated: SceneDataV2 = {
        version: 2,
        scene: data.scene || {
            camera: { x: 0, y: 0, z: 5 },
            zoom: 1,
            bgColor: '#000000',
            transitionSpeed: 1,
            transitionEase: 'easeInOutCubic'
        },
        objects: [],
    };

    // Case 1: Legacy format with 'leva' and 'timeline' (v1)
    if (data.leva && data.timeline) {
        const objectId = 'legacy-obj-1';
        const name = 'Legacy Object';

        // Convert Leva state to SceneObject
        const leva = data.leva;
        const obj = createDefaultObject(objectId, name);

        // Map Leva fields to SceneObject
        if (leva.dimensions) obj.dimensions = leva.dimensions;
        if (leva.rotation) obj.rotation = leva.rotation;
        if (leva.shapeType) obj.shapeType = leva.shapeType;
        if (leva.borderRadius !== undefined) obj.borderRadius = leva.borderRadius;
        if (leva.orientation) obj.orientation = leva.orientation;
        if (leva.numLines !== undefined) obj.numLines = leva.numLines;
        if (leva.thickness !== undefined) obj.thickness = leva.thickness;
        if (leva.speed !== undefined) obj.speed = leva.speed;
        if (leva.longevity !== undefined) obj.longevity = leva.longevity;
        if (leva.ease !== undefined) obj.ease = leva.ease;
        if (leva.color1) obj.color1 = leva.color1;
        if (leva.color2) obj.color2 = leva.color2;
        if (leva.rimColor) obj.rimColor = leva.rimColor;

        migrated.objects.push(obj);
    }
    // Case 2: Just a raw array (very old timeline-only format)
    else if (Array.isArray(data)) {
        const objectId = 'legacy-obj-1';
        migrated.objects.push(createDefaultObject(objectId, 'Legacy Object'));
    }
    // Case 3: Empty or unknown format, provide defaults
    else {
        const objectId = 'obj-1';
        migrated.objects.push(createDefaultObject(objectId, 'Box 1'));
    }

    return migrated;
}
