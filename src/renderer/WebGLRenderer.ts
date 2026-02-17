import { SceneObject, SceneState } from '../types';

export class WebGLRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private uniforms: Record<string, WebGLUniformLocation> = {};
    private quadBuffer: WebGLBuffer;

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
            'u_shapeType', 'u_shapeTypeNext', 'u_morphFactor', 'u_orientation', 'u_bgColor', 'u_timeNoise'
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

    public renderFrame(scene: SceneState, objects: SceneObject[], time: number) {
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

        const shapeMap: Record<string, number> = { Box: 0, Sphere: 1, Cone: 2, Torus: 3, Capsule: 4, Cylinder: 5 };
        const orientMap: Record<string, number> = { Horizontal: 0, Vertical: 1, Depth: 2, Diagonal: 3 };

        objects.forEach(obj => {
            if (!obj.visible) return;

            // Per-object uniforms
            gl.uniform3f(this.uniforms['u_position'], obj.position.x, obj.position.y, obj.position.z);
            gl.uniform3f(this.uniforms['u_boxSize'], obj.dimensions.x, obj.dimensions.y, obj.dimensions.z);

            const tr = Math.PI / 180;
            gl.uniform3f(this.uniforms['u_rot'], obj.rotation.x * tr, obj.rotation.y * tr, obj.rotation.z * tr);

            gl.uniform1f(this.uniforms['u_borderRadius'], obj.borderRadius);
            gl.uniform1f(this.uniforms['u_borderThickness'], obj.thickness); // Note: renamed in shader to u_borderThickness? 
            // In App.tsx it was u_borderThickness. Let's check fragment.glsl again.
            // App.tsx: uBorderThickness: gl.getUniformLocation(program, 'u_borderThickness')
            // fragment.glsl: uniform float u_borderThickness;

            gl.uniform1f(this.uniforms['u_speed'], obj.speed);
            gl.uniform1f(this.uniforms['u_trailLength'], obj.longevity); // longevity maps to trailLength
            gl.uniform1f(this.uniforms['u_ease'], obj.ease);
            gl.uniform1f(this.uniforms['u_numLines'], obj.numLines);
            gl.uniform1f(this.uniforms['u_timeNoise'], obj.timeNoise);

            gl.uniform1i(this.uniforms['u_shapeType'], shapeMap[obj.shapeType] ?? 0);
            gl.uniform1i(this.uniforms['u_shapeTypeNext'], shapeMap[(obj as any).shapeTypeNext] ?? 0);
            gl.uniform1f(this.uniforms['u_morphFactor'], (obj as any).morphFactor ?? 0.0);
            gl.uniform1i(this.uniforms['u_orientation'], orientMap[obj.orientation] ?? 0);

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
    }
}
