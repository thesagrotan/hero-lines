/**
 * SVG to 2D Signed Distance Field (SDF) texture converter.
 *
 * Parses an SVG string, extracts <path> elements, rasterizes them onto
 * an off-screen canvas, then computes a signed distance field using
 * a brute-force distance transform.
 *
 * The output Float32Array can be uploaded as an R32F WebGL texture.
 */

export const SDF_SPREAD = 32; // max pixel distance to propagate; controls edge softness

/**
 * Parse an SVG string and return a signed distance field as a Float32Array.
 * Uses browser native rendering (drawImage) to support all SVG features.
 *
 * @param svgString  Raw SVG markup
 * @param resolution Output texture size (square: resolution × resolution)
 * @returns Promise resolving to Float32Array, or null if parsing fails
 */
export function parseSvgToSdfTextureAsync(
    svgString: string,
    resolution: number = 512
): Promise<Float32Array | null> {
    return new Promise((resolve) => {
        // --- 1. Parse viewBox to determine aspect ratio ---
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) {
            resolve(null);
            return;
        }

        const viewBox = svgEl.getAttribute('viewBox');
        let vbW = 100, vbH = 100;
        if (viewBox) {
            const parts = viewBox.split(/[\s,]+/).map(Number);
            if (parts.length === 4) {
                vbW = parts[2];
                vbH = parts[3];
            }
        } else {
            vbW = parseFloat(svgEl.getAttribute('width') || '100');
            vbH = parseFloat(svgEl.getAttribute('height') || '100');
        }

        // --- 2. Load SVG into an Image via Blob ---
        const img = new Image();
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // --- 3. Rasterize onto canvas ---
            const canvas = document.createElement('canvas');
            canvas.width = resolution;
            canvas.height = resolution;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

            // Calculate scaling to fit within resolution with padding
            const padding = resolution * 0.1;
            const availRes = resolution - padding * 2;
            const scale = Math.min(availRes / vbW, availRes / vbH);

            // Center the image
            const drawW = vbW * scale;
            const drawH = vbH * scale;
            const offsetX = padding + (availRes - drawW) / 2;
            const offsetY = padding + (availRes - drawH) / 2;

            // Draw the SVG with 1px dilation (8-way) to seal gaps between paths
            // this ensures that adjacent areas are merged into a single continuous surface
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    ctx.drawImage(img, offsetX + dx, offsetY + dy, drawW, drawH);
                }
            }

            // --- 4. Generate Mask ---
            const imageData = ctx.getImageData(0, 0, resolution, resolution);
            const pixels = imageData.data;
            const mask = new Uint8Array(resolution * resolution);

            for (let i = 0; i < mask.length; i++) {
                // Alpha is at index + 3
                const alpha = pixels[i * 4 + 3];
                // Low threshold to capture anti-aliased edges and seal gaps between shapes
                mask[i] = alpha > 10 ? 1 : 0;
            }

            // --- 5. Thicken and Ensure all paths are connected ---
            dilateMask(mask, resolution, resolution, 4);
            ensureConnectivity(mask, resolution, resolution);

            // --- 6. Compute signed distance field ---
            const sdf = computeSdf(mask, resolution, resolution, SDF_SPREAD);
            resolve(sdf);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            console.error('Failed to load SVG image for SDF generation');
            resolve(null);
        };

        img.src = url;
    });
}

/**
 * Brute-force distance transform to compute an SDF from a binary mask.
 * Searches within a window of `spread` pixels around each pixel.
 *
 * Returns Float32Array with values in [-1, 1]:
 *   negative = inside the shape
 *   positive = outside the shape
 */
function computeSdf(
    mask: Uint8Array,
    width: number,
    height: number,
    spread: number
): Float32Array {
    const sdf = new Float32Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const inside = mask[idx] === 1;

            let minDist = spread;

            // Search window
            const x0 = Math.max(0, x - spread);
            const x1 = Math.min(width - 1, x + spread);
            const y0 = Math.max(0, y - spread);
            const y1 = Math.min(height - 1, y + spread);

            for (let sy = y0; sy <= y1; sy++) {
                for (let sx = x0; sx <= x1; sx++) {
                    const sIdx = sy * width + sx;
                    if (mask[sIdx] !== mask[idx]) {
                        const dx = x - sx;
                        const dy = y - sy;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < minDist) minDist = dist;
                    }
                }
            }

            // Sign: negative inside, positive outside
            sdf[idx] = (inside ? -minDist : minDist) / spread;
        }
    }

    return sdf;
}

/**
 * Ensures that all 'on' pixels (1) in the mask form a single connected component.
 * If multiple components exist, they are joined by thin bridges.
 */
function ensureConnectivity(mask: Uint8Array, width: number, height: number): void {
    const labels = new Int32Array(width * height).fill(-1);
    let componentCount = 0;

    // 1. Label components using BFS
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1 && labels[i] === -1) {
            componentCount++;
            const queue = [i];
            labels[i] = componentCount;
            let head = 0;
            while (head < queue.length) {
                const idx = queue[head++];
                const x = idx % width;
                const y = Math.floor(idx / width);

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
                            if (mask[nIdx] === 1 && labels[nIdx] === -1) {
                                labels[nIdx] = componentCount;
                                queue.push(nIdx);
                            }
                        }
                    }
                }
            }
        }
    }

    if (componentCount <= 1) return;

    // 2. Bridge components
    // We start with component 1 and find the closest pixel of any other component.
    const connectedToMain = new Set([1]);
    const mainMask = new Uint8Array(width * height);
    for (let i = 0; i < labels.length; i++) if (labels[i] === 1) mainMask[i] = 1;

    while (connectedToMain.size < componentCount) {
        // Multi-source BFS from mainMask to find nearest other component
        const queue: number[] = [];
        const dists = new Int32Array(width * height).fill(-1);
        const parents = new Int32Array(width * height).fill(-1);

        for (let i = 0; i < mask.length; i++) {
            if (mainMask[i] === 1) {
                queue.push(i);
                dists[i] = 0;
            }
        }

        let head = 0;
        let foundIdx = -1;
        while (head < queue.length) {
            const idx = queue[head++];
            const x = idx % width;
            const y = Math.floor(idx / width);

            // Check if we hit a different component
            if (mask[idx] === 1 && labels[idx] !== -1 && !connectedToMain.has(labels[idx])) {
                foundIdx = idx;
                break;
            }

            // 8-way for geometric shortest paths (including diagonals)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (dists[nIdx] === -1) {
                            dists[nIdx] = dists[idx] + 1;
                            parents[nIdx] = idx;
                            queue.push(nIdx);
                        }
                    }
                }
            }
        }

        if (foundIdx !== -1) {
            const newLabel = labels[foundIdx];
            // Trace back and draw a thick bridge (3px width)
            let curr = foundIdx;
            while (curr !== -1) {
                // If we reach any pixel that was already part of the main group, the bridge is complete.
                // We check this BEFORE thickening to avoid immediate exit.
                if (mainMask[curr] === 1) break;

                const cx = curr % width;
                const cy = Math.floor(curr / width);

                // Draw 10x10 block for thickness (ensure bridges are wide enough for the lines)
                const thickness = 10;
                const half = Math.floor(thickness / 2);
                for (let dy = -half; dy <= half; dy++) {
                    for (let dx = -half; dx <= half; dx++) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const bIdx = ny * width + nx;
                            mask[bIdx] = 1;
                            mainMask[bIdx] = 1; // Mark bridge as connected
                        }
                    }
                }

                curr = parents[curr];
            }
            // Add all pixels of the newly connected component to mainMask
            for (let i = 0; i < labels.length; i++) {
                if (labels[i] === newLabel) {
                    mainMask[i] = 1;
                }
            }
            connectedToMain.add(newLabel);
        } else {
            // Should not happen if there are other components
            break;
        }
    }
}

/**
 * Simple binary dilation pass to thicken the mask.
 * Uses a max filter over a 3x3 neighborhood.
 */
function dilateMask(mask: Uint8Array, width: number, height: number, iterations: number): void {
    for (let iter = 0; iter < iterations; iter++) {
        const copy = new Uint8Array(mask);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (copy[idx] === 1) continue;

                // Check 8-neighborhood
                neighborLoop:
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (copy[ny * width + nx] === 1) {
                                mask[idx] = 1;
                                break neighborLoop;
                            }
                        }
                    }
                }
            }
        }
    }
}
