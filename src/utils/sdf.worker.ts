/// <reference lib="webworker" />

/**
 * Web Worker for computing Signed Distance Field (SDF) from a binary mask.
 * Uses Jump Flood Algorithm (JFA) for O(N log N) performance.
 */

interface Point {
    x: number;
    y: number;
}

const worker: Worker = self as any;

worker.onmessage = (e: MessageEvent) => {
    const { mask, width, height, spread } = e.data;
    const sdf = computeSdfJFA(mask, width, height, spread);
    worker.postMessage({ sdf }, [sdf.buffer]);
};

function computeSdfJFA(
    mask: Uint8Array,
    width: number,
    height: number,
    spread: number
): Float32Array {
    // We need to compute distance to the nearest edge.
    // We'll do two JFA passes: 
    // 1. Find distance to nearest 'on' pixel for 'off' pixels (external distance)
    // 2. Find distance to nearest 'off' pixel for 'on' pixels (internal distance)

    const externalDist = computeDistances(mask, width, height, 1); // distances to 'on'
    const internalDist = computeDistances(mask, width, height, 0); // distances to 'off'

    const sdf = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const d_ext = externalDist[i];
        const d_int = internalDist[i];

        // Signed distance: positive outside (mask=0), negative inside (mask=1)
        if (mask[i] === 0) {
            sdf[i] = Math.min(spread, d_ext) / spread;
        } else {
            sdf[i] = -Math.min(spread, d_int) / spread;
        }
    }

    return sdf;
}

function computeDistances(
    mask: Uint8Array,
    width: number,
    height: number,
    targetValue: number
): Float32Array {
    const size = width * height;
    // Store nearest target coordinates as (x, y) packed into a single Int32
    // We use -1 to represent "not yet found"
    const pointsX = new Int32Array(size).fill(-1);
    const pointsY = new Int32Array(size).fill(-1);

    // 1. Seed
    for (let i = 0; i < size; i++) {
        if (mask[i] === targetValue) {
            pointsX[i] = i % width;
            pointsY[i] = Math.floor(i / width);
        }
    }

    // 2. Jump Flood
    let step = Math.max(width, height);
    while (step >= 1) {
        step = Math.floor(step / 2);
        if (step < 1 && step * 2 === 1) {
            // we already did step=1? no, if step was 1, floor(step/2) is 0.
        }

        // For each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                // Check 8 neighbors at 'step' distance
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;

                        const nx = x + dx * step;
                        const ny = y + dy * step;

                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
                            const seedX = pointsX[nIdx];
                            const seedY = pointsY[nIdx];

                            if (seedX !== -1) {
                                // Calculate distance from (x, y) to this seed
                                const distSq = (x - seedX) ** 2 + (y - seedY) ** 2;

                                const currentSeedX = pointsX[idx];
                                const currentSeedY = pointsY[idx];

                                if (currentSeedX === -1) {
                                    pointsX[idx] = seedX;
                                    pointsY[idx] = seedY;
                                } else {
                                    const currentDistSq = (x - currentSeedX) ** 2 + (y - currentSeedY) ** 2;
                                    if (distSq < currentDistSq) {
                                        pointsX[idx] = seedX;
                                        pointsY[idx] = seedY;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (step === 1) break;
    }

    // 3. Convert to distance
    const dists = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        const seedX = pointsX[i];
        const seedY = pointsY[i];

        if (seedX === -1) {
            dists[i] = Math.max(width, height);
        } else {
            dists[i] = Math.sqrt((x - seedX) ** 2 + (y - seedY) ** 2);
        }
    }

    return dists;
}
