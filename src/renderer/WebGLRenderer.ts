import { SceneState, RenderableObject } from '../types';
import { SDF_SPREAD } from '../utils/svgParser';
import { vec3, mat3, Vec3 } from '../utils/math';

const DEG_TO_RAD = Math.PI / 180;

export class WebGLRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private uniforms: Record<string, WebGLUniformLocation> = {};
    private quadBuffer: WebGLBuffer;
    private sceneUbo: WebGLBuffer;
    private objectUbo: WebGLBuffer;
    private sceneData = new Float32Array(12); // 48 bytes
    private objectData = new Float32Array(76); // 304 bytes
    private objectDataInt = new Int32Array(this.objectData.buffer);

    private svgSdfTexture: WebGLTexture | null = null;
    private svgSdfResolution: number = 0;
    private lastSdfData: Float32Array | null = null;
    private hasFloatLinear: boolean = false;

    private colorCache: Map<string, [number, number, number]> = new Map();

    private static readonly SHAPE_MAP: Record<string, number> = {
        Box: 0, Sphere: 1, Cone: 2, Torus: 3, Capsule: 4, Cylinder: 5, SVG: 6, Laptop: 7
    };
    private static readonly ORIENT_MAP: Record<string, number> = {
        Horizontal: 0, Vertical: 1, Depth: 2, Diagonal: 3
    };
    private static readonly BEND_AXIS_MAP: Record<string, number> = {
        X: 0, Y: 1, Z: 2
    };
    private static readonly COMPOSITE_MAP: Record<string, number> = {
        None: 0, Union: 1, Subtract: 2, Intersect: 3, SmoothUnion: 4
    };

    constructor(canvas: HTMLCanvasElement, vsSource: string, fsSource: string) {
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true })!;
        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;

        const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'Program link error');
        }
        this.program = program;

        // Bind Uniform Blocks
        const sceneBlockIndex = gl.getUniformBlockIndex(program, 'SceneData');
        gl.uniformBlockBinding(program, sceneBlockIndex, 0);
        this.sceneUbo = gl.createBuffer()!;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.sceneData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.sceneUbo);

        const objectBlockIndex = gl.getUniformBlockIndex(program, 'ObjectData');
        gl.uniformBlockBinding(program, objectBlockIndex, 1);
        this.objectUbo = gl.createBuffer()!;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.objectUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.objectData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, this.objectUbo);

        // Cache sampler locations
        const svgTexLoc = gl.getUniformLocation(program, 'u_svgSdfTex');
        if (svgTexLoc) this.uniforms['u_svgSdfTex'] = svgTexLoc;

        // Setup fullscreen quad
        this.quadBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Blending setup (pre-multiplied alpha)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // Cache extensions
        this.hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(info || 'Shader compile error');
        }
        return shader;
    }

    /**
     * Upload a signed distance field texture for SVG extrusion.
     */
    public uploadSvgSdfTexture(sdfData: Float32Array, resolution: number): void {
        const gl = this.gl;

        // Skip if data is the same
        if (this.lastSdfData === sdfData && this.svgSdfResolution === resolution) {
            return;
        }

        if (!this.svgSdfTexture) {
            this.svgSdfTexture = gl.createTexture();
        }

        gl.bindTexture(gl.TEXTURE_2D, this.svgSdfTexture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.R32F,
            resolution, resolution, 0,
            gl.RED, gl.FLOAT, sdfData
        );
        // Use LINEAR filtering for smooth gradients (essential for calcNormal)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.svgSdfResolution = resolution;
        this.lastSdfData = sdfData;
    }

    public renderFrame(scene: SceneState, objects: RenderableObject[], time: number) {
        const gl = this.gl;
        gl.useProgram(this.program);

        // Clear with background color
        const bg = this.hexToRgb(scene.bgColor);
        gl.clearColor(bg[0], bg[1], bg[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Enable scissor test
        gl.enable(gl.SCISSOR_TEST);

        // Scene-level UBO update
        this.sceneData[0] = gl.canvas.width;
        this.sceneData[1] = gl.canvas.height;
        this.sceneData[2] = time * 0.001;
        // sceneData[3] is padding

        const iz = 1.0 / scene.zoom;
        this.sceneData[4] = scene.camera.x * iz;
        this.sceneData[5] = scene.camera.y * iz;
        this.sceneData[6] = scene.camera.z * iz;
        // sceneData[7] is padding

        this.sceneData[8] = bg[0];
        this.sceneData[9] = bg[1];
        this.sceneData[10] = bg[2];
        // sceneData[11] is padding

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneUbo);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.sceneData);

        objects.forEach(obj => {
            if (!obj.visible) return;

            // Object-level UBO update
            // Vec3s (offsets 0, 16, 32, 48, 64, 80, 96, 112, 128)
            this.objectData[0] = obj.position.x;
            this.objectData[1] = obj.position.y;
            this.objectData[2] = obj.position.z;

            this.objectData[4] = obj.dimensions.x;
            this.objectData[5] = obj.dimensions.y;
            this.objectData[6] = obj.dimensions.z;

            this.objectData[8] = obj.rotation.x * DEG_TO_RAD;
            this.objectData[9] = obj.rotation.y * DEG_TO_RAD;
            this.objectData[10] = obj.rotation.z * DEG_TO_RAD;

            const c1 = this.hexToRgb(obj.color1);
            this.objectData[12] = c1[0];
            this.objectData[13] = c1[1];
            this.objectData[14] = c1[2];

            const c2 = this.hexToRgb(obj.color2);
            this.objectData[16] = c2[0];
            this.objectData[17] = c2[1];
            this.objectData[18] = c2[2];

            const rc = this.hexToRgb(obj.rimColor);
            this.objectData[20] = rc[0];
            this.objectData[21] = rc[1];
            this.objectData[22] = rc[2];

            this.objectData[24] = obj.secondaryPosition.x;
            this.objectData[25] = obj.secondaryPosition.y;
            this.objectData[26] = obj.secondaryPosition.z;

            this.objectData[28] = obj.secondaryRotation.x * DEG_TO_RAD;
            this.objectData[29] = obj.secondaryRotation.y * DEG_TO_RAD;
            this.objectData[30] = obj.secondaryRotation.z * DEG_TO_RAD;

            this.objectData[32] = obj.secondaryDimensions.x;
            this.objectData[33] = obj.secondaryDimensions.y;
            this.objectData[34] = obj.secondaryDimensions.z;

            // Floats (starting at index 36)
            this.objectData[36] = obj.borderRadius;
            this.objectData[37] = obj.thickness;
            this.objectData[38] = obj.speed;
            this.objectData[39] = obj.longevity; // u_trailLength

            this.objectData[40] = obj.ease;
            this.objectData[41] = obj.numLines;
            this.objectData[42] = obj.morphFactor;
            this.objectData[43] = obj.timeNoise;

            this.objectData[44] = obj.svgExtrusionDepth ?? 0.5;
            this.objectData[45] = SDF_SPREAD;
            this.objectData[46] = this.svgSdfResolution;
            this.objectData[47] = obj.bendAmount;

            this.objectData[48] = obj.bendAngle;
            this.objectData[49] = obj.bendOffset;
            this.objectData[50] = obj.bendLimit;
            this.objectData[51] = obj.rimIntensity ?? 0.4;

            this.objectData[52] = obj.rimPower ?? 3.0;
            this.objectData[53] = obj.wireOpacity ?? 0.1;
            this.objectData[54] = obj.wireIntensity ?? 0.1;
            this.objectData[55] = obj.layerDelay ?? 0.02;

            this.objectData[56] = obj.torusThickness ?? 0.2;
            this.objectData[57] = obj.lineBrightness ?? 2.5;
            this.objectData[58] = obj.wobbleAmount ?? 0;
            this.objectData[59] = obj.wobbleSpeed ?? 1;

            this.objectData[60] = obj.wobbleScale ?? 2;
            this.objectData[61] = obj.chromaticAberration ?? 0;
            this.objectData[62] = obj.pulseIntensity ?? 0;
            this.objectData[63] = obj.pulseSpeed ?? 1;

            this.objectData[64] = obj.scanlineIntensity ?? 0;
            this.objectData[65] = obj.compositeSmoothness ?? 0.1;

            // Ints (using the int32 view on the same buffer)
            this.objectDataInt[66] = WebGLRenderer.SHAPE_MAP[obj.shapeType] ?? 0;
            this.objectDataInt[67] = WebGLRenderer.SHAPE_MAP[obj.shapeTypeNext] ?? 0;
            this.objectDataInt[68] = WebGLRenderer.ORIENT_MAP[obj.orientation] ?? 0;

            const needsSvg = obj.shapeType === 'SVG' || obj.shapeTypeNext === 'SVG';
            this.objectDataInt[69] = (needsSvg && this.svgSdfTexture) ? 1 : 0;
            this.objectDataInt[70] = WebGLRenderer.BEND_AXIS_MAP[obj.bendAxis] ?? 1;
            this.objectDataInt[71] = WebGLRenderer.COMPOSITE_MAP[obj.compositeMode] ?? 0;
            this.objectDataInt[72] = WebGLRenderer.SHAPE_MAP[obj.secondaryShapeType] ?? 1;

            gl.bindBuffer(gl.UNIFORM_BUFFER, this.objectUbo);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.objectData);

            // SVG SDF texture binding remains separate
            if (needsSvg && this.svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.svgSdfTexture);
                gl.uniform1i(this.uniforms['u_svgSdfTex'], 0);
            }

            // Scissoring: Compute screen-space bounding box
            const scissor = this.calculateScissorRect(scene, obj, gl.canvas.width, gl.canvas.height);
            if (scissor) {
                if (scissor.w <= 0 || scissor.h <= 0) return;
                gl.scissor(scissor.x, scissor.y, scissor.w, scissor.h);
            } else {
                // If calculation fails or object is too close/behind, default to full screen
                gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
            }

            // Draw fullscreen quad for this object
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });

        gl.disable(gl.SCISSOR_TEST);
    }

    private calculateScissorRect(
        scene: SceneState,
        obj: RenderableObject,
        width: number,
        height: number
    ): { x: number, y: number, w: number, h: number } | null {
        const iz = 1.0 / scene.zoom;
        const camPos: Vec3 = [scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz];
        const objPos: Vec3 = [obj.position.x, obj.position.y, obj.position.z];

        // Model rotation - shader uses transpose(rotZ * rotY * rotX)
        const rx = mat3.rotateX(obj.rotation.x * DEG_TO_RAD);
        const ry = mat3.rotateY(obj.rotation.y * DEG_TO_RAD);
        const rz = mat3.rotateZ(obj.rotation.z * DEG_TO_RAD);
        const modelRot = mat3.multiply(rz, mat3.multiply(ry, rx));
        const mI = mat3.transpose(modelRot);

        // Local camera position (ro_l in shader)
        const ro_l = mat3.multiplyVec(mI, vec3.sub(camPos, objPos));

        // Camera axes in world space
        const worldFwd = vec3.normalize(vec3.multiplyScalar(camPos, -1));
        const worldUpBase: Vec3 = [0, 1, 0];
        let worldRight = vec3.normalize(vec3.cross(worldUpBase, worldFwd));

        // Handle case where fwd is parallel to up_world
        if (Math.abs(vec3.dot(worldUpBase, worldFwd)) > 0.99) {
            worldRight = vec3.normalize(vec3.cross([1, 0, 0], worldFwd));
        }
        const worldUp = vec3.cross(worldFwd, worldRight);

        // Transform axes to local space
        const fwd = vec3.normalize(mat3.multiplyVec(mI, worldFwd));
        const right = vec3.normalize(mat3.multiplyVec(mI, worldRight));
        const up = vec3.normalize(mat3.multiplyVec(mI, worldUp));

        // AABB corners in local space. 
        // We use a margin to account for effects like pulse, bend, and wobble.
        // intersectBox uses 1.5, we use 2.0 to be safe.
        const margin = 2.0;
        const b = [
            obj.dimensions.x * margin,
            obj.dimensions.y * margin,
            obj.dimensions.z * margin
        ];

        const corners: Vec3[] = [
            [-b[0], -b[1], -b[2]], [b[0], -b[1], -b[2]], [-b[0], b[1], -b[2]], [b[0], b[1], -b[2]],
            [-b[0], -b[1], b[2]], [b[0], -b[1], b[2]], [-b[0], b[1], b[2]], [b[0], b[1], b[2]]
        ];

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        let someInFront = false;

        for (const p_obj of corners) {
            const v = vec3.sub(p_obj, ro_l);
            const dist = vec3.dot(v, fwd);

            // If any corner is behind the camera plane or very close, 
            // for safety we fall back to full screen scissor if it's too complex.
            if (dist < 0.1) {
                return null;
            }

            someInFront = true;
            const uvX = vec3.dot(v, right) / dist;
            const uvY = vec3.dot(v, up) / dist;

            const px = (uvX * height) + 0.5 * width;
            const py = (uvY * height) + 0.5 * height;

            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
        }

        if (!someInFront) return { x: 0, y: 0, w: 0, h: 0 };

        // Clamp to screen and add an extra padding for safety
        // Chromatic aberration shifts the red/blue channels horizontally in UV space.
        // Shift in UV.x of 'u_chromaticAberration' corresponds to 'u_chromaticAberration * height' pixels.
        const pad = 10;
        const chromAbb = obj.chromaticAberration ?? 0;
        const chromPad = Math.abs(chromAbb) * height;

        const x = Math.max(0, Math.floor(minX - pad - chromPad));
        const y = Math.max(0, Math.floor(minY - pad));
        const w = Math.min(width, Math.ceil(maxX + pad + chromPad)) - x;
        const h = Math.min(height, Math.ceil(maxY + pad)) - y;

        return { x, y, w, h };
    }

    private hexToRgb(hex: string): [number, number, number] {
        const cached = this.colorCache.get(hex);
        if (cached) return cached;

        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        const result: [number, number, number] = [r, g, b];
        this.colorCache.set(hex, result);
        return result;
    }

    public resize(width: number, height: number) {
        this.gl.viewport(0, 0, width, height);
    }

    public dispose() {
        this.gl.deleteProgram(this.program);
        this.gl.deleteBuffer(this.quadBuffer);
        if (this.svgSdfTexture) {
            this.gl.deleteTexture(this.svgSdfTexture);
        }
    }
}
