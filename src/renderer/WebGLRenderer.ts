import { SceneState, RenderableObject, Vector3 } from '../types';
import { SDF_SPREAD } from '../utils/svgParser';
import { vec3, mat3, Vec3 } from '../utils/math';

const DEG_TO_RAD = Math.PI / 180;

export class WebGLRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private prepassProgram: WebGLProgram;
    private uniforms: Record<string, WebGLUniformLocation> = {};
    private prepassUniforms: Record<string, WebGLUniformLocation> = {};
    private quadBuffer: WebGLBuffer;
    private sceneUbo: WebGLBuffer;
    private objectUbo: WebGLBuffer;

    private prepassFbos: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null];
    private prepassTextures: [WebGLTexture | null, WebGLTexture | null] = [null, null];
    private prepassIndex = 0;
    private prepassResolutionScale = 0.5;

    private sceneData = new Float32Array(24); // 96 bytes (added 12 floats for previous state)
    private objectData = new Float32Array(96); // 384 bytes (Task 13: added renderBoxSize and margin)
    private objectDataInt = new Int32Array(this.objectData.buffer);

    private prevCamPos = new Float32Array(3);
    private prevObjStates: Map<string, { position: Vector3, rotation: Vector3, dimensions: Vector3 }> = new Map();

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

    constructor(canvas: HTMLCanvasElement, vsSource: string, fsSource: string, prepassSource: string) {
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

        const pvs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const pfs = this.createShader(gl.FRAGMENT_SHADER, prepassSource);
        const prepassProgram = gl.createProgram()!;
        gl.attachShader(prepassProgram, pvs);
        gl.attachShader(prepassProgram, pfs);
        gl.linkProgram(prepassProgram);
        if (!gl.getProgramParameter(prepassProgram, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prepassProgram) || 'Prepass program link error');
        }
        this.prepassProgram = prepassProgram;

        // Bind Uniform Blocks
        const sceneBlockIndex = gl.getUniformBlockIndex(program, 'SceneData');
        gl.uniformBlockBinding(program, sceneBlockIndex, 0);
        const prepassSceneBlockIndex = gl.getUniformBlockIndex(prepassProgram, 'SceneData');
        gl.uniformBlockBinding(prepassProgram, prepassSceneBlockIndex, 0);

        this.sceneUbo = gl.createBuffer()!;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.sceneData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.sceneUbo);

        const objectBlockIndex = gl.getUniformBlockIndex(program, 'ObjectData');
        gl.uniformBlockBinding(program, objectBlockIndex, 1);
        const prepassObjectBlockIndex = gl.getUniformBlockIndex(prepassProgram, 'ObjectData');
        gl.uniformBlockBinding(prepassProgram, prepassObjectBlockIndex, 1);

        this.objectUbo = gl.createBuffer()!;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.objectUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, this.objectData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, this.objectUbo);

        // Cache sampler locations
        const svgTexLoc = gl.getUniformLocation(program, 'u_svgSdfTex');
        if (svgTexLoc) this.uniforms['u_svgSdfTex'] = svgTexLoc;

        const prepassTexLoc = gl.getUniformLocation(program, 'u_prepassTex');
        if (prepassTexLoc) this.uniforms['u_prepassTex'] = prepassTexLoc;

        const prevPrepassTexLoc = gl.getUniformLocation(program, 'u_prevPrepassTex');
        if (prevPrepassTexLoc) this.uniforms['u_prevPrepassTex'] = prevPrepassTexLoc;

        const prepassSvgTexLoc = gl.getUniformLocation(prepassProgram, 'u_svgSdfTex');
        if (prepassSvgTexLoc) this.prepassUniforms['u_svgSdfTex'] = prepassSvgTexLoc;

        const prepassPrevTexLoc = gl.getUniformLocation(prepassProgram, 'u_prevPrepassTex');
        if (prepassPrevTexLoc) this.prepassUniforms['u_prevPrepassTex'] = prepassPrevTexLoc;

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
        gl.getExtension('EXT_color_buffer_float');
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        let finalSource = source;
        if (type === this.gl.FRAGMENT_SHADER) {
            finalSource = source.replace('#version 300 es', `#version 300 es
#define MAX_STEPS 40
#define MAX_BACK_STEPS 16
#define HIT_EPS 0.005
#define CHEAP_NORMALS
#define SIMPLE_BACKFACE_NORMALS`);
        }
        this.gl.shaderSource(shader, finalSource);
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

        // 1. Scene-level UBO update (shared by both passes)
        const currentRes = [gl.canvas.width, gl.canvas.height];
        const currentTime = time * 0.001;
        const iz = 1.0 / scene.zoom;
        const currentCam = [scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz];
        const bg = this.hexToRgb(scene.bgColor);

        // Previous Scene State (Indices 12-23)
        this.sceneData.copyWithin(12, 0, 12); // Shift current to previous

        // Current Scene State (Indices 0-11)
        this.sceneData[0] = currentRes[0];
        this.sceneData[1] = currentRes[1];
        this.sceneData[2] = currentTime;
        this.sceneData[4] = currentCam[0];
        this.sceneData[5] = currentCam[1];
        this.sceneData[6] = currentCam[2];
        this.sceneData[8] = bg[0];
        this.sceneData[9] = bg[1];
        this.sceneData[10] = bg[2];

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneUbo);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.sceneData);

        // Clear main framebuffer with background color
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(bg[0], bg[1], bg[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 2. Render each object
        objects.forEach(obj => {
            if (!obj.visible) return;

            // Object-level UBO update
            this.updateObjectUbo(obj);

            const currPrepassIndex = this.prepassIndex;
            const prevPrepassIndex = 1 - this.prepassIndex;

            // Ensure no textures are bound to units that could cause feedback loops during pre-pass
            this.unbindAllTextures();

            // Pass 1: PRE-PASS (Half Resolution)
            if (this.prepassFbos[currPrepassIndex]) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepassFbos[currPrepassIndex]);
                gl.viewport(0, 0, gl.canvas.width * this.prepassResolutionScale, gl.canvas.height * this.prepassResolutionScale);
                gl.useProgram(this.prepassProgram);

                // Disable blending for pre-pass (writing hit distance, no transparency needed)
                gl.disable(gl.BLEND);

                // Clear pre-pass buffer with -1.0 (miss)
                gl.clearColor(-1.0, 0.0, 0.0, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                this.bindTextures(obj, this.prepassProgram, this.prepassUniforms);

                // Bind PREVIOUS pre-pass texture for reprojection hint
                if (this.prepassTextures[prevPrepassIndex]) {
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_2D, this.prepassTextures[prevPrepassIndex]);
                    gl.uniform1i(this.prepassUniforms['u_prevPrepassTex'], 2);
                }

                gl.drawArrays(gl.TRIANGLES, 0, 6);

                // Re-enable blending for main pass
                gl.enable(gl.BLEND);

                // Unbind previous pre-pass texture to avoid feedback loop
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, null);
            }

            // Pass 2: MAIN PASS (Full Resolution)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            gl.useProgram(this.program);

            // Enable scissor test ONLY for the main pass to save fill-rate on the final shade
            gl.enable(gl.SCISSOR_TEST);
            const scissor = this.calculateScissorRect(scene, obj, gl.canvas.width, gl.canvas.height);
            if (scissor && scissor.w > 0 && scissor.h > 0) {
                gl.scissor(scissor.x, scissor.y, scissor.w, scissor.h);
            } else {
                gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
            }

            this.bindTextures(obj, this.program, this.uniforms);

            // Bind current pre-pass texture to main shader
            if (this.prepassTextures[currPrepassIndex]) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.prepassTextures[currPrepassIndex]);
                gl.uniform1i(this.uniforms['u_prepassTex'], 1);
            }

            // Bind previous pre-pass texture to main shader (optional use)
            if (this.prepassTextures[prevPrepassIndex]) {
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, this.prepassTextures[prevPrepassIndex]);
                gl.uniform1i(this.uniforms['u_prevPrepassTex'], 2);
            }

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.disable(gl.SCISSOR_TEST);

            // Unbind textures after main pass to avoid feedback loop in next pre-pass
            this.unbindAllTextures();
        });

        // Swap pre-pass buffers for next frame
        this.prepassIndex = 1 - this.prepassIndex;
    }

    private updateObjectUbo(obj: RenderableObject) {
        // Object-level UBO update logic moved from renderFrame
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
        this.objectData[58] = obj.compositeSmoothness ?? 0.1;

        // Ints (using the int32 view on the same buffer)
        this.objectDataInt[59] = WebGLRenderer.SHAPE_MAP[obj.shapeType] ?? 0;
        this.objectDataInt[60] = WebGLRenderer.SHAPE_MAP[obj.shapeTypeNext] ?? 0;
        this.objectDataInt[61] = WebGLRenderer.ORIENT_MAP[obj.orientation] ?? 0;

        const needsSvg = obj.shapeType === 'SVG' || obj.shapeTypeNext === 'SVG';
        this.objectDataInt[62] = (needsSvg && this.svgSdfTexture) ? 1 : 0;
        this.objectDataInt[63] = WebGLRenderer.BEND_AXIS_MAP[obj.bendAxis] ?? 1;
        this.objectDataInt[64] = WebGLRenderer.COMPOSITE_MAP[obj.compositeMode] ?? 0;
        this.objectDataInt[65] = WebGLRenderer.SHAPE_MAP[obj.secondaryShapeType] ?? 1;
        this.objectDataInt[66] = obj.enableBackface ? 1 : 0;

        // Task 13: Calculate combined bounding box for CSG shapes
        const margin = (Math.abs(obj.bendAmount) < 0.05 && obj.compositeMode === 'None') ? 1.2 : 2.0;
        this.objectData[67] = margin;

        let rbX = obj.dimensions.x, rbY = obj.dimensions.y, rbZ = obj.dimensions.z;
        if (obj.compositeMode !== 'None') {
            // Transform secondary box corners to primary local space
            const sr = [obj.secondaryRotation.x * DEG_TO_RAD, obj.secondaryRotation.y * DEG_TO_RAD, obj.secondaryRotation.z * DEG_TO_RAD];
            const rot = mat3.multiply(mat3.rotateZ(sr[2]), mat3.multiply(mat3.rotateY(sr[1]), mat3.rotateX(sr[0])));
            const sd = obj.secondaryDimensions;
            const sp = obj.secondaryPosition;
            const corners = [
                [-sd.x, -sd.y, -sd.z], [sd.x, -sd.y, -sd.z], [-sd.x, sd.y, -sd.z], [sd.x, sd.y, -sd.z],
                [-sd.x, -sd.y, sd.z], [sd.x, -sd.y, sd.z], [-sd.x, sd.y, sd.z], [sd.x, sd.y, sd.z]
            ];
            for (const c of corners) {
                const p = vec3.add([sp.x, sp.y, sp.z], mat3.multiplyVec(rot, c as Vec3));
                rbX = Math.max(rbX, Math.abs(p[0]));
                rbY = Math.max(rbY, Math.abs(p[1]));
                rbZ = Math.max(rbZ, Math.abs(p[2]));
            }
        }
        this.objectData[68] = rbX;
        this.objectData[69] = rbY;
        this.objectData[70] = rbZ;

        // Previous Object State (Indices 72-83)
        const prevState = this.prevObjStates.get(obj.id);
        if (prevState) {
            this.objectData[72] = prevState.position.x;
            this.objectData[73] = prevState.position.y;
            this.objectData[74] = prevState.position.z;

            this.objectData[76] = prevState.dimensions.x;
            this.objectData[77] = prevState.dimensions.y;
            this.objectData[78] = prevState.dimensions.z;

            this.objectData[80] = prevState.rotation.x * DEG_TO_RAD;
            this.objectData[81] = prevState.rotation.y * DEG_TO_RAD;
            this.objectData[82] = prevState.rotation.z * DEG_TO_RAD;
        } else {
            // First frame: copy current to previous
            this.objectData[72] = obj.position.x;
            this.objectData[73] = obj.position.y;
            this.objectData[74] = obj.position.z;
            this.objectData[76] = obj.dimensions.x;
            this.objectData[77] = obj.dimensions.y;
            this.objectData[78] = obj.dimensions.z;
            this.objectData[80] = obj.rotation.x * DEG_TO_RAD;
            this.objectData[81] = obj.rotation.y * DEG_TO_RAD;
            this.objectData[82] = obj.rotation.z * DEG_TO_RAD;
        }

        this.prevObjStates.set(obj.id, {
            position: { ...obj.position },
            rotation: { ...obj.rotation },
            dimensions: { ...obj.dimensions }
        });

        this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.objectUbo);
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, this.objectData);
    }

    private unbindAllTextures() {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    private bindTextures(obj: RenderableObject, program: WebGLProgram, uniforms: Record<string, WebGLUniformLocation>) {
        const gl = this.gl;
        const needsSvg = obj.shapeType === 'SVG' || obj.shapeTypeNext === 'SVG';
        if (needsSvg && this.svgSdfTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.svgSdfTexture);
            const loc = uniforms['u_svgSdfTex'];
            if (loc) gl.uniform1i(loc, 0);
        }
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

        // Task 7 & 13: Adaptive margin and combined bounds
        const margin = (Math.abs(obj.bendAmount) < 0.05 && obj.compositeMode === 'None') ? 1.2 : 2.0;

        // Calculate the same rbX, rbY, rbZ as in updateObjectUbo to ensure consistency
        let rbX = obj.dimensions.x, rbY = obj.dimensions.y, rbZ = obj.dimensions.z;
        if (obj.compositeMode !== 'None') {
            const sr = [obj.secondaryRotation.x * DEG_TO_RAD, obj.secondaryRotation.y * DEG_TO_RAD, obj.secondaryRotation.z * DEG_TO_RAD];
            const rot = mat3.multiply(mat3.rotateZ(sr[2]), mat3.multiply(mat3.rotateY(sr[1]), mat3.rotateX(sr[0])));
            const sd = obj.secondaryDimensions;
            const sp = obj.secondaryPosition;
            const cornersSecondary = [
                [-sd.x, -sd.y, -sd.z], [sd.x, -sd.y, -sd.z], [-sd.x, sd.y, -sd.z], [sd.x, sd.y, -sd.z],
                [-sd.x, -sd.y, sd.z], [sd.x, -sd.y, sd.z], [-sd.x, sd.y, sd.z], [sd.x, sd.y, sd.z]
            ];
            for (const c of cornersSecondary) {
                const p = vec3.add([sp.x, sp.y, sp.z], mat3.multiplyVec(rot, c as Vec3));
                rbX = Math.max(rbX, Math.abs(p[0]));
                rbY = Math.max(rbY, Math.abs(p[1]));
                rbZ = Math.max(rbZ, Math.abs(p[2]));
            }
        }

        const b = [rbX * margin, rbY * margin, rbZ * margin];

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
        const pad = 10;

        const x = Math.max(0, Math.floor(minX - pad));
        const y = Math.max(0, Math.floor(minY - pad));
        const w = Math.min(width, Math.ceil(maxX + pad)) - x;
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
        this.setupPrepassFbo(width, height);
    }

    private setupPrepassFbo(width: number, height: number) {
        const gl = this.gl;
        const w = Math.floor(width * this.prepassResolutionScale);
        const h = Math.floor(height * this.prepassResolutionScale);

        for (let i = 0; i < 2; i++) {
            if (this.prepassFbos[i]) gl.deleteFramebuffer(this.prepassFbos[i]);
            if (this.prepassTextures[i]) gl.deleteTexture(this.prepassTextures[i]);

            this.prepassTextures[i] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.prepassTextures[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            this.prepassFbos[i] = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepassFbos[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.prepassTextures[i], 0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    public dispose() {
        this.gl.deleteProgram(this.program);
        this.gl.deleteProgram(this.prepassProgram);
        this.gl.deleteBuffer(this.quadBuffer);
        if (this.svgSdfTexture) this.gl.deleteTexture(this.svgSdfTexture);
        for (let i = 0; i < 2; i++) {
            if (this.prepassFbos[i]) this.gl.deleteFramebuffer(this.prepassFbos[i]);
            if (this.prepassTextures[i]) this.gl.deleteTexture(this.prepassTextures[i]);
        }
    }
}
