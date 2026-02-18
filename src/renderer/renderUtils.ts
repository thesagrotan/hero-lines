import { SceneObject, RenderableObject, Vector3 } from '../types';

/**
 * Syncs an array of RenderableObjects with SceneObjects in-place.
 * This avoids per-frame allocations and reduces GC pressure.
 */
export function updateRenderableObjects(
    source: SceneObject[],
    target: RenderableObject[]
): RenderableObject[] {
    // 1. Adjust target array size
    if (target.length !== source.length) {
        if (target.length < source.length) {
            // Grow: Add new objects
            for (let i = target.length; i < source.length; i++) {
                const src = source[i];
                target[i] = {
                    ...src,
                    position: { ...src.position },
                    dimensions: { ...src.dimensions },
                    rotation: { ...src.rotation },
                    secondaryPosition: { ...src.secondaryPosition },
                    secondaryRotation: { ...src.secondaryRotation },
                    secondaryDimensions: { ...src.secondaryDimensions },
                    svgData: src.svgData ? { ...src.svgData } : undefined,
                    shapeTypeNext: src.shapeType,
                    morphFactor: 0.0,
                } as RenderableObject;
            }
        } else {
            // Shrink: Remove extra objects
            target.length = source.length;
        }
    }

    // 2. Sync properties in-place
    for (let i = 0; i < source.length; i++) {
        const src = source[i];
        const dst = target[i];

        // Save local object references before they are overwritten by Object.assign
        const pos = dst.position;
        const dims = dst.dimensions;
        const rot = dst.rotation;
        const sPos = dst.secondaryPosition;
        const sRot = dst.secondaryRotation;
        const sDims = dst.secondaryDimensions;

        // Shallow copy all properties first
        Object.assign(dst, src);

        // Restore local object references and sync values from source
        // This prevents dst from sharing references with the store objects,
        // which would cause the store to be mutated during animations.
        dst.position = pos;
        syncVector3(dst.position, src.position);

        dst.dimensions = dims;
        syncVector3(dst.dimensions, src.dimensions);

        dst.rotation = rot;
        syncVector3(dst.rotation, src.rotation);

        dst.secondaryPosition = sPos;
        syncVector3(dst.secondaryPosition, src.secondaryPosition);

        dst.secondaryRotation = sRot;
        syncVector3(dst.secondaryRotation, src.secondaryRotation);

        dst.secondaryDimensions = sDims;
        syncVector3(dst.secondaryDimensions, src.secondaryDimensions);

        // SVG Data cloning (needs special handling as it's optional and nested)
        if (src.svgData) {
            if (!dst.svgData) {
                dst.svgData = { ...src.svgData };
            } else {
                dst.svgData.svgString = src.svgData.svgString;
                dst.svgData.extrusionDepth = src.svgData.extrusionDepth;
            }
        } else {
            dst.svgData = undefined;
        }

        // Reset morph properties (they will be overridden by transition logic if active)
        dst.shapeTypeNext = src.shapeType;
        dst.morphFactor = 0.0;
    }

    return target;
}

function syncVector3(dst: Vector3, src: Vector3) {
    dst.x = src.x;
    dst.y = src.y;
    dst.z = src.z;
}

