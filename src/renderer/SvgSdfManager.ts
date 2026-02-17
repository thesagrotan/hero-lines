import { parseSvgToSdfTextureAsync } from '../utils/svgParser';

/**
 * Manages the lifecycle of SVG SDF textures.
 * Caches the computed SDF to avoid recomputing every frame.
 */
export class SvgSdfManager {
    private cachedSvgString: string | null = null;
    private cachedSdf: Float32Array | null = null;
    private resolution: number;

    constructor(resolution: number = 512) {
        this.resolution = resolution;
    }

    /**
     * Get the SDF for the given SVG string.
     * Returns cached result if the SVG hasn't changed.
     * If not cached, triggers async load and returns null until ready.
     */
    getSdf(svgString: string): Float32Array | null {
        if (svgString === this.cachedSvgString) {
            return this.cachedSdf;
        }

        // Start loading new SVG
        this.cachedSvgString = svgString;
        this.cachedSdf = null;

        parseSvgToSdfTextureAsync(svgString, this.resolution).then(sdf => {
            // Only update if current request is still valid (user hasn't switched)
            if (this.cachedSvgString === svgString) {
                this.cachedSdf = sdf;
            }
        });

        return null;
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
