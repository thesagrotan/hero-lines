import { parseSvgToSdfTexture } from '../utils/svgParser';

/**
 * Manages the lifecycle of SVG SDF textures.
 * Caches the computed SDF to avoid recomputing every frame.
 */
export class SvgSdfManager {
    private cachedSvgString: string | null = null;
    private cachedSdf: Float32Array | null = null;
    private resolution: number;

    constructor(resolution: number = 256) {
        this.resolution = resolution;
    }

    /**
     * Get the SDF for the given SVG string.
     * Returns cached result if the SVG hasn't changed.
     */
    getSdf(svgString: string): Float32Array | null {
        if (svgString === this.cachedSvgString && this.cachedSdf) {
            return this.cachedSdf;
        }

        const sdf = parseSvgToSdfTexture(svgString, this.resolution);
        if (sdf) {
            this.cachedSvgString = svgString;
            this.cachedSdf = sdf;
        }
        return sdf;
    }

    getResolution(): number {
        return this.resolution;
    }

    /** Clear the cache (e.g. when the object is deleted). */
    clear(): void {
        this.cachedSvgString = null;
        this.cachedSdf = null;
    }
}
