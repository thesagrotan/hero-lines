import { SceneObject, SceneState, TransitionSnapshot } from '../types';

/**
 * Pure function to interpolate between two scene snapshots.
 * Returns a new TransitionSnapshot with interpolated values.
 */
export function interpolateTransition(
    from: TransitionSnapshot,
    to: TransitionSnapshot,
    progress: number,
    toRotY: number
): TransitionSnapshot {
    const ease = progress; // Currently using linear, could apply easing function here if needed

    return {
        position: {
            x: from.position.x + (to.position.x - from.position.x) * ease,
            y: from.position.y + (to.position.y - from.position.y) * ease,
            z: from.position.z + (to.position.z - from.position.z) * ease,
        },
        dimensions: {
            x: from.dimensions.x + (to.dimensions.x - from.dimensions.x) * ease,
            y: from.dimensions.y + (to.dimensions.y - from.dimensions.y) * ease,
            z: from.dimensions.z + (to.dimensions.z - from.dimensions.z) * ease,
        },
        rotation: {
            x: from.rotation.x + (to.rotation.x - from.rotation.x) * ease,
            y: from.rotation.y + (toRotY - from.rotation.y) * ease,
            z: from.rotation.z + (to.rotation.z - from.rotation.z) * ease,
        },
        borderRadius: from.borderRadius + (to.borderRadius - from.borderRadius) * ease,
        camera: {
            x: from.camera.x + (to.camera.x - from.camera.x) * ease,
            y: from.camera.y + (to.camera.y - from.camera.y) * ease,
            z: from.camera.z + (to.camera.z - from.camera.z) * ease,
        },
        zoom: from.zoom + (to.zoom - from.zoom) * ease,
        shapeType: from.shapeType, // Base shape type is 'from' during transition for morphing start
        bendAmount: from.bendAmount + (to.bendAmount - from.bendAmount) * ease,
        bendAngle: from.bendAngle + (to.bendAngle - from.bendAngle) * ease,
        bendAxis: progress < 0.5 ? from.bendAxis : to.bendAxis,
        bendOffset: from.bendOffset + (to.bendOffset - from.bendOffset) * ease,
        bendLimit: from.bendLimit + (to.bendLimit - from.bendLimit) * ease,
    };
}

/**
 * Factory to create a TransitionSnapshot from a SceneObject and SceneState.
 * Ensures consistent property mapping for transitions.
 */
export function createTransitionSnapshot(
    obj: SceneObject,
    scene: SceneState
): TransitionSnapshot {
    return {
        position: { ...obj.position },
        dimensions: { ...obj.dimensions },
        borderRadius: obj.borderRadius,
        rotation: { ...obj.rotation },
        shapeType: obj.shapeType,
        bendAmount: obj.bendAmount,
        bendAngle: obj.bendAngle,
        bendAxis: obj.bendAxis,
        bendOffset: obj.bendOffset,
        bendLimit: obj.bendLimit,
        camera: { ...scene.camera },
        zoom: scene.zoom,
    };
}
