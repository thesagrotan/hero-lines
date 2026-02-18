import { SceneState, RenderableObject } from '../types';
import { SDF_SPREAD } from '../utils/svgParser';

const DEG_TO_RAD = Math.PI / 180;

export class WebGLRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private uniforms: Record<string, WebGLUniformLocation> = {};
    private quadBuffer: WebGLBuffer;

    private svgSdfTexture: WebGLTexture | null = null;
    private svgSdfResolution: number = 0;

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

        // Cache uniform locations
        const uniformNames = [
            'u_time', 'u_resolution', 'u_camPos', 'u_position', 'u_boxSize', 'u_rot',
            'u_borderRadius', 'u_borderThickness', 'u_speed', 'u_trailLength',
            'u_ease', 'u_color1', 'u_color2', 'u_rimColor', 'u_numLines',
            'u_shapeType', 'u_shapeTypeNext', 'u_morphFactor', 'u_orientation', 'u_bgColor', 'u_timeNoise',
            'u_svgSdfTex', 'u_svgExtrusionDepth', 'u_hasSvgSdf',
            'u_svgSpread', 'u_svgResolution', 'u_bendAmount', 'u_bendAngle', 'u_bendAxis',
            'u_bendOffset', 'u_bendLimit', 'u_rimIntensity', 'u_wireOpacity',
            'u_rimPower', 'u_layerDelay', 'u_wireIntensity', 'u_torusThickness', 'u_lineBrightness',
            'u_wobbleAmount', 'u_wobbleSpeed', 'u_wobbleScale', 'u_chromaticAberration',
            'u_pulseIntensity', 'u_pulseSpeed', 'u_scanlineIntensity',
            'u_compositeMode', 'u_secondaryShapeType', 'u_secondaryPosition', 'u_secondaryRotation', 'u_secondaryDimensions', 'u_compositeSmoothness'
        ];

        uniformNames.forEach(name => {
            const loc = gl.getUniformLocation(program, name);
            if (loc) this.uniforms[name] = loc;
        });

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

        if (!this.svgSdfTexture) {
            this.svgSdfTexture = gl.createTexture();
        }

        // Enable linear filtering for float textures if available
        gl.getExtension('OES_texture_float_linear');

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
    }

    public renderFrame(scene: SceneState, objects: RenderableObject[], time: number) {
        const gl = this.gl;
        gl.useProgram(this.program);

        // Clear with background color
        const bg = this.hexToRgb(scene.bgColor);
        gl.clearColor(bg[0], bg[1], bg[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Scene-level uniforms
        gl.uniform2f(this.uniforms['u_resolution'], gl.canvas.width, gl.canvas.height);
        gl.uniform1f(this.uniforms['u_time'], time * 0.001);

        const iz = 1.0 / scene.zoom;
        gl.uniform3f(this.uniforms['u_camPos'], scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz);
        gl.uniform3f(this.uniforms['u_bgColor'], bg[0], bg[1], bg[2]);

        objects.forEach(obj => {
            if (!obj.visible) return;

            // Per-object uniforms
            gl.uniform3f(this.uniforms['u_position'], obj.position.x, obj.position.y, obj.position.z);
            gl.uniform3f(this.uniforms['u_boxSize'], obj.dimensions.x, obj.dimensions.y, obj.dimensions.z);

            gl.uniform3f(
                this.uniforms['u_rot'],
                obj.rotation.x * DEG_TO_RAD,
                obj.rotation.y * DEG_TO_RAD,
                obj.rotation.z * DEG_TO_RAD
            );

            gl.uniform1f(this.uniforms['u_borderRadius'], obj.borderRadius);
            gl.uniform1f(this.uniforms['u_borderThickness'], obj.thickness);

            gl.uniform1f(this.uniforms['u_speed'], obj.speed);
            gl.uniform1f(this.uniforms['u_trailLength'], obj.longevity); // longevity maps to trailLength
            gl.uniform1f(this.uniforms['u_ease'], obj.ease);
            gl.uniform1f(this.uniforms['u_numLines'], obj.numLines);
            gl.uniform1f(this.uniforms['u_timeNoise'], obj.timeNoise);
            gl.uniform1f(this.uniforms['u_bendAmount'], obj.bendAmount);
            gl.uniform1f(this.uniforms['u_bendAngle'], obj.bendAngle);
            gl.uniform1f(this.uniforms['u_bendOffset'], obj.bendOffset);
            gl.uniform1f(this.uniforms['u_bendLimit'], obj.bendLimit);
            gl.uniform1i(this.uniforms['u_bendAxis'], WebGLRenderer.BEND_AXIS_MAP[obj.bendAxis] ?? 1);
            gl.uniform1f(this.uniforms['u_rimIntensity'], obj.rimIntensity ?? 0.4);
            gl.uniform1f(this.uniforms['u_wireOpacity'], obj.wireOpacity ?? 0.1);
            gl.uniform1f(this.uniforms['u_rimPower'], obj.rimPower ?? 3.0);
            gl.uniform1f(this.uniforms['u_layerDelay'], obj.layerDelay ?? 0.02);
            gl.uniform1f(this.uniforms['u_wireIntensity'], obj.wireIntensity ?? 0.1);
            gl.uniform1f(this.uniforms['u_torusThickness'], obj.torusThickness ?? 0.2);
            gl.uniform1f(this.uniforms['u_lineBrightness'], obj.lineBrightness ?? 2.5);
            gl.uniform1f(this.uniforms['u_wobbleAmount'], obj.wobbleAmount ?? 0);
            gl.uniform1f(this.uniforms['u_wobbleSpeed'], obj.wobbleSpeed ?? 1);
            gl.uniform1f(this.uniforms['u_wobbleScale'], obj.wobbleScale ?? 2);
            gl.uniform1f(this.uniforms['u_chromaticAberration'], obj.chromaticAberration ?? 0);
            gl.uniform1f(this.uniforms['u_pulseIntensity'], obj.pulseIntensity ?? 0);
            gl.uniform1f(this.uniforms['u_pulseSpeed'], obj.pulseSpeed ?? 1);
            gl.uniform1f(this.uniforms['u_scanlineIntensity'], obj.scanlineIntensity ?? 0);

            gl.uniform1i(this.uniforms['u_shapeType'], WebGLRenderer.SHAPE_MAP[obj.shapeType] ?? 0);
            gl.uniform1i(this.uniforms['u_shapeTypeNext'], WebGLRenderer.SHAPE_MAP[obj.shapeTypeNext] ?? 0);
            gl.uniform1f(this.uniforms['u_morphFactor'], obj.morphFactor);
            gl.uniform1i(this.uniforms['u_orientation'], WebGLRenderer.ORIENT_MAP[obj.orientation] ?? 0);
            gl.uniform1i(this.uniforms['u_compositeMode'], WebGLRenderer.COMPOSITE_MAP[obj.compositeMode] ?? 0);
            gl.uniform1i(this.uniforms['u_secondaryShapeType'], WebGLRenderer.SHAPE_MAP[obj.secondaryShapeType] ?? 1);
            gl.uniform3f(this.uniforms['u_secondaryPosition'], obj.secondaryPosition.x, obj.secondaryPosition.y, obj.secondaryPosition.z);
            gl.uniform3f(
                this.uniforms['u_secondaryRotation'],
                obj.secondaryRotation.x * DEG_TO_RAD,
                obj.secondaryRotation.y * DEG_TO_RAD,
                obj.secondaryRotation.z * DEG_TO_RAD
            );
            gl.uniform3f(this.uniforms['u_secondaryDimensions'], obj.secondaryDimensions.x, obj.secondaryDimensions.y, obj.secondaryDimensions.z);
            gl.uniform1f(this.uniforms['u_compositeSmoothness'], obj.compositeSmoothness ?? 0.1);

            // SVG SDF texture binding
            const needsSvg = obj.shapeType === 'SVG' || obj.shapeTypeNext === 'SVG';
            if (needsSvg && this.svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this.svgSdfTexture);
                gl.uniform1i(this.uniforms['u_svgSdfTex'], 0);
                gl.uniform1i(this.uniforms['u_hasSvgSdf'], 1);
                gl.uniform1f(this.uniforms['u_svgExtrusionDepth'], obj.svgExtrusionDepth ?? 0.5);
                gl.uniform1f(this.uniforms['u_svgSpread'], SDF_SPREAD);
                gl.uniform1f(this.uniforms['u_svgResolution'], this.svgSdfResolution);
            } else {
                gl.uniform1i(this.uniforms['u_hasSvgSdf'], 0);
            }

            const c1 = this.hexToRgb(obj.color1);
            const c2 = this.hexToRgb(obj.color2);
            const rc = this.hexToRgb(obj.rimColor);

            gl.uniform3f(this.uniforms['u_color1'], c1[0], c1[1], c1[2]);
            gl.uniform3f(this.uniforms['u_color2'], c2[0], c2[1], c2[2]);
            gl.uniform3f(this.uniforms['u_rimColor'], rc[0], rc[1], rc[2]);

            // Draw fullscreen quad for this object
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });
    }

    private hexToRgb(hex: string): [number, number, number] {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
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
