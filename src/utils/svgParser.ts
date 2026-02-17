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
 * Values are normalized to roughly [-1, 1] where negative = inside the shape.
 *
 * @param svgString  Raw SVG markup
 * @param resolution Output texture size (square: resolution × resolution)
 * @returns Float32Array of length resolution², or null if parsing fails
 */
export function parseSvgToSdfTexture(
    svgString: string,
    resolution: number = 256
): Float32Array | null {
    // --- 1. Parse the SVG and extract <path> d attributes ---
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return null;

    const paths = doc.querySelectorAll('path');
    if (paths.length === 0) return null;

    // --- 2. Read viewBox or width/height for coordinate mapping ---
    const viewBox = svgEl.getAttribute('viewBox');
    let vbX = 0, vbY = 0, vbW = 100, vbH = 100;
    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
            [vbX, vbY, vbW, vbH] = parts;
        }
    } else {
        vbW = parseFloat(svgEl.getAttribute('width') || '100');
        vbH = parseFloat(svgEl.getAttribute('height') || '100');
    }

    // --- 3. Rasterize paths onto an off-screen canvas ---
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d')!;

    // Map viewBox → canvas coords (uniform scale, centered)
    // Add 10% padding so the shape doesn't touch the edges (crucial for SDF)
    const padding = resolution * 0.1;
    const availRes = resolution - padding * 2;

    const scale = Math.min(availRes / vbW, availRes / vbH);
    const offsetX = padding + (availRes - vbW * scale) / 2 - vbX * scale;
    const offsetY = padding + (availRes - vbH * scale) / 2 - vbY * scale;

    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Draw all paths filled
    ctx.fillStyle = '#FF0000'; // Draw shape in red (opaque)

    paths.forEach((pathEl) => {
        const d = pathEl.getAttribute('d');
        if (!d) return;
        const path2d = new Path2D(d);
        ctx.fill(path2d, 'nonzero');
    });

    // --- 4. Read the rasterized mask ---
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const imageData = ctx.getImageData(0, 0, resolution, resolution);
    const pixels = imageData.data;

    // Build boolean mask: true = inside shape
    const mask = new Uint8Array(resolution * resolution);
    for (let i = 0; i < mask.length; i++) {
        // Use alpha channel (index * 4 + 3) to determine inside/outside
        const alpha = pixels[i * 4 + 3];
        mask[i] = alpha > 127 ? 1 : 0;
    }

    // --- 5. Compute signed distance field ---
    const sdf = computeSdf(mask, resolution, resolution, SDF_SPREAD);

    return sdf;
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
