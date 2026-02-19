/**
 * Returns the JavaScript source code for the minimal snapshot render loop.
 * This code is embedded directly into the exported HTML/Web Component files.
 * It has zero dependencies — pure vanilla JS + WebGL2.
 */
export function getSnapshotRendererSource(): string {
    return `
const DEG_TO_RAD = Math.PI / 180;

const SHAPE_MAP = { Box: 0, Sphere: 1, Cone: 2, Torus: 3, Capsule: 4, Cylinder: 5, SVG: 6, Laptop: 7 };
const ORIENT_MAP = { Horizontal: 0, Vertical: 1, Depth: 2, Diagonal: 3 };
const BEND_AXIS_MAP = { X: 0, Y: 1, Z: 2 };
const COMPOSITE_MAP = { None: 0, Union: 1, Subtract: 2, Intersect: 3, SmoothUnion: 4 };

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Compute a screen-space scissor rect for an object to avoid shading pixels outside its bounds.
// Returns {x, y, w, h} in WebGL bottom-left coords, or null to use full screen.
function calculateScissorRect(scene, obj, width, height) {
    const iz = 1.0 / scene.zoom;
    const camPos = [scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz];

    // Build inverse model rotation (transpose of rotZ * rotY * rotX)
    const rx = obj._rotRad[0], ry = obj._rotRad[1], rz = obj._rotRad[2];
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);

    // rotX
    const RX = [1,0,0, 0,cx,-sx, 0,sx,cx];
    // rotY
    const RY = [cy,0,sy, 0,1,0, -sy,0,cy];
    // rotZ
    const RZ = [cz,-sz,0, sz,cz,0, 0,0,1];

    // M = rotZ * rotY * rotX  (column-major 3x3 as flat array)
    function mul3(A, B) {
        const R = new Array(9);
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 3; c++)
                R[r*3+c] = A[r*3+0]*B[0*3+c] + A[r*3+1]*B[1*3+c] + A[r*3+2]*B[2*3+c];
        return R;
    }
    const M = mul3(mul3(RZ, RY), RX);
    // mI = transpose(M)
    const mI = [M[0],M[3],M[6], M[1],M[4],M[7], M[2],M[5],M[8]];

    function mv(m, v) { return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]]; }
    function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
    function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
    function norm(v) { const l = Math.sqrt(dot(v,v)); return [v[0]/l, v[1]/l, v[2]/l]; }
    function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

    const ro_l = mv(mI, sub(camPos, [obj.position.x, obj.position.y, obj.position.z]));

    const worldFwd = norm([-camPos[0], -camPos[1], -camPos[2]]);
    const upBase = [0, 1, 0];
    let worldRight = norm(cross(upBase, worldFwd));
    if (Math.abs(dot(upBase, worldFwd)) > 0.99) worldRight = norm(cross([1,0,0], worldFwd));
    const worldUp = cross(worldFwd, worldRight);

    const fwd   = norm(mv(mI, worldFwd));
    const right = norm(mv(mI, worldRight));
    const up    = norm(mv(mI, worldUp));

    // Task 7: Adaptive margin
    const margin = (Math.abs(obj.bendAmount) < 0.05 && (obj.compositeMode === 'None' || obj._compositeMode === 0)) ? 1.2 : 2.0;
    const b = [obj.dimensions.x * margin, obj.dimensions.y * margin, obj.dimensions.z * margin];
    const signs = [-1, 1];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const bx of signs) for (const by of signs) for (const bz of signs) {
        const p_obj = [bx*b[0], by*b[1], bz*b[2]];
        const v = sub(p_obj, ro_l);
        const dist = dot(v, fwd);
        if (dist < 0.1) return null;
        const uvX = dot(v, right) / dist;
        const uvY = dot(v, up) / dist;
        const px = uvX * height + 0.5 * width;
        const py = uvY * height + 0.5 * height;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    }

    const pad = 10;
    const x = Math.max(0, Math.floor(minX - pad));
    const y = Math.max(0, Math.floor(minY - pad));
    const w = Math.min(width,  Math.ceil(maxX + pad)) - x;
    const h = Math.min(height, Math.ceil(maxY + pad)) - y;
    return { x, y, w, h };
}

function initSnapshot(canvas, snapshot, vsSource, fsSource, svgSdfModule, resolutionScale) {
    resolutionScale = resolutionScale || 1.0;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) { console.error('WebGL2 not supported'); return null; }

    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
    }

    // Setup UBOs
    const sceneData = new Float32Array(24);
    const objectData = new Float32Array(112); // Task Tier 3: increased for boundingRadius
    const objectDataInt = new Int32Array(objectData.buffer);

    let sceneUbo = null;
    const sceneBlockIndex = gl.getUniformBlockIndex(program, 'SceneData');
    if (sceneBlockIndex !== 0xFFFFFFFF) {
        gl.uniformBlockBinding(program, sceneBlockIndex, 0);
        sceneUbo = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, sceneUbo);
    }

    let objectUbo = null;
    const objectBlockIndex = gl.getUniformBlockIndex(program, 'ObjectData');
    if (objectBlockIndex !== 0xFFFFFFFF) {
        gl.uniformBlockBinding(program, objectBlockIndex, 1);
        objectUbo = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, objectUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, objectData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, objectUbo);
    }

    // Cache sampler location
    const svgTexLoc = gl.getUniformLocation(program, 'u_svgSdfTex');

    // Fullscreen quad — stored in a VAO to avoid re-validating attribute state each draw
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);

    // Set program and clear color once — they never change
    gl.useProgram(program);
    const bg = snapshot.scene.bgColorRgb;
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);

    // SVG SDF texture state
    let svgSdfTexture = null;
    let svgSdfResolution = 0;
    let svgSdfReady = false;

    // Check if any object needs SVG SDF
    const svgObj = snapshot.objects.find(o => o.visible && o.shapeType === 'SVG' && o.svgData && o.svgData.svgString);
    if (svgObj && svgSdfModule) {
        const sdfRes = svgSdfModule.resolution || 512;
        svgSdfResolution = sdfRes;

        svgSdfModule.parseSvgToSdfTextureAsync(svgObj.svgData.svgString, sdfRes).then(sdfData => {
            if (!sdfData) return;
            svgSdfTexture = gl.createTexture();
            gl.getExtension('OES_texture_float_linear');
            gl.bindTexture(gl.TEXTURE_2D, svgSdfTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sdfRes, sdfRes, 0, gl.RED, gl.FLOAT, sdfData);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D, null);
            svgSdfReady = true;
        });
    }

    // Pre-normalize objects: compute rotation in radians and resolve optional fields once.
    // This avoids per-frame fallback object creation (|| {x:0,y:0,z:0}) and DEG_TO_RAD math
    // for fields that never change.
    const objects = snapshot.objects.filter(o => o.visible).map(o => {
        const sp = o.secondaryPosition   || { x: 0, y: 0, z: 0 };
        const sr = o.secondaryRotation   || { x: 0, y: 0, z: 0 };
        const sd = o.secondaryDimensions || { x: 1, y: 1, z: 1 };
        return {
            ...o,
            // Pre-converted rotation in radians
            _rotRad: [
                (o.rotation.x || 0) * DEG_TO_RAD,
                (o.rotation.y || 0) * DEG_TO_RAD,
                (o.rotation.z || 0) * DEG_TO_RAD,
            ],
            // Resolved secondary fields
            _spx: sp.x, _spy: sp.y, _spz: sp.z,
            _srx: sr.x * DEG_TO_RAD, _sry: sr.y * DEG_TO_RAD, _srz: sr.z * DEG_TO_RAD,
            _sdx: sd.x, _sdy: sd.y, _sdz: sd.z,
            // Resolved scalar defaults
            borderRadius:        o.borderRadius        || 0,
            thickness:           o.thickness           || 0.05,
            speed:               o.speed               || 1,
            longevity:           o.longevity           || 0.5,
            ease:                o.ease                || 0.1,
            numLines:            o.numLines            || 10,
            timeNoise:           o.timeNoise           || 0,
            svgExtrusionDepth:   o.svgExtrusionDepth   || 0.5,
            bendAmount:          o.bendAmount          || 0,
            bendAngle:           o.bendAngle           || 0,
            bendOffset:          o.bendOffset          || 0,
            bendLimit:           o.bendLimit           || 10,
            rimIntensity:        o.rimIntensity        || 0.4,
            rimPower:            o.rimPower            || 3.0,
            wireOpacity:         o.wireOpacity         || 0.1,
            wireIntensity:       o.wireIntensity       || 0.1,
            layerDelay:          o.layerDelay          || 0.02,
            torusThickness:      o.torusThickness      || 0.2,
            lineBrightness:      o.lineBrightness      || 2.5,
            compositeSmoothness: o.compositeSmoothness || 0.1,
            // Pre-resolved integer enum values
            _shapeType:          SHAPE_MAP[o.shapeType]          || 0,
            _orientType:         ORIENT_MAP[o.orientation]       || 0,
            _bendAxis:           BEND_AXIS_MAP[o.bendAxis]       || 1,
            _compositeMode:      COMPOSITE_MAP[o.compositeMode]  || 0,
            _secondaryShapeType: SHAPE_MAP[o.secondaryShapeType] || 1,
            enableBackface:      o.enableBackface === undefined  || o.enableBackface,
        };
    });

    const scene = snapshot.scene;
    const iz = 1.0 / scene.zoom;

    let paused = false;
    let rafId = 0;

    function render(now) {
        if (paused) return;

        gl.clear(gl.COLOR_BUFFER_BIT);

        // Update Scene UBO
        sceneData[0] = gl.canvas.width;
        sceneData[1] = gl.canvas.height;
        sceneData[2] = now * 0.001;
        sceneData[4] = scene.camera.x * iz;
        sceneData[5] = scene.camera.y * iz;
        sceneData[6] = scene.camera.z * iz;
        sceneData[8] = bg[0];
        sceneData[9] = bg[1];
        sceneData[10] = bg[2];

        if (sceneUbo) {
            gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, sceneData);
        }

        gl.bindVertexArray(vao);

        objects.forEach(obj => {
            // Fill Object UBO Data
            objectData[0] = obj.position.x;
            objectData[1] = obj.position.y;
            objectData[2] = obj.position.z;

            objectData[4] = obj.dimensions.x;
            objectData[5] = obj.dimensions.y;
            objectData[6] = obj.dimensions.z;

            // Pre-converted radians — no DEG_TO_RAD multiply per frame
            objectData[8]  = obj._rotRad[0];
            objectData[9]  = obj._rotRad[1];
            objectData[10] = obj._rotRad[2];

            // Pre-converted [r,g,b] arrays — no hexToRgb per frame
            objectData[12] = obj.color1[0];
            objectData[13] = obj.color1[1];
            objectData[14] = obj.color1[2];

            objectData[16] = obj.color2[0];
            objectData[17] = obj.color2[1];
            objectData[18] = obj.color2[2];

            objectData[20] = obj.rimColor[0];
            objectData[21] = obj.rimColor[1];
            objectData[22] = obj.rimColor[2];

            objectData[24] = obj._spx;
            objectData[25] = obj._spy;
            objectData[26] = obj._spz;

            objectData[28] = obj._srx;
            objectData[29] = obj._sry;
            objectData[30] = obj._srz;

            objectData[32] = obj._sdx;
            objectData[33] = obj._sdy;
            objectData[34] = obj._sdz;

            objectData[36] = obj.borderRadius;
            objectData[37] = obj.thickness;
            objectData[38] = obj.speed;
            objectData[39] = obj.longevity;

            objectData[40] = obj.ease;
            objectData[41] = obj.numLines;
            objectData[42] = 0; // morphFactor
            // objectData[43] = obj.timeNoise; // Removed
            objectData[43] = obj.svgExtrusionDepth;
            objectData[44] = 32; // SDF_SPREAD
            objectData[45] = svgSdfResolution;
            objectData[46] = obj.bendAmount;

            objectData[47] = obj.bendAngle;
            objectData[48] = obj.bendOffset;
            objectData[49] = obj.bendLimit;
            objectData[50] = obj.rimIntensity;

            objectData[51] = obj.rimPower;
            objectData[52] = obj.wireOpacity;
            objectData[53] = obj.wireIntensity;
            objectData[54] = obj.layerDelay;

            objectData[55] = obj.torusThickness;
            objectData[56] = obj.lineBrightness;
            objectData[57] = obj.compositeSmoothness;

            // Pre-resolved integer enums
            objectDataInt[58] = obj._shapeType; // Was 59
            objectDataInt[59] = obj._shapeType; // shapeTypeNext // Was 60
            objectDataInt[60] = obj._orientType; // Was 61

            const needsSvg = obj.shapeType === 'SVG';
            objectDataInt[61] = (needsSvg && svgSdfReady && svgSdfTexture) ? 1 : 0; // Was 62
            objectDataInt[62] = obj._bendAxis; // Was 63
            objectDataInt[63] = obj._compositeMode; // Was 64
            objectDataInt[64] = obj._secondaryShapeType; // Was 65
            objectDataInt[65] = obj.enableBackface ? 1 : 0; // Was 66

            // Adaptive Step Count (P2 Optimization)
            const camPos = [sceneData[4], sceneData[5], sceneData[6]];
            const objPos = [obj.position.x, obj.position.y, obj.position.z];
            const dist = Math.sqrt(
                (camPos[0] - objPos[0])**2 + 
                (camPos[1] - objPos[1])**2 + 
                (camPos[2] - objPos[2])**2
            );
            
            const baseSteps = 64; // match #define in standalone.html.ts
            const baseBackSteps = 32;
            const minSteps = 16;
            
            const complexity = (obj.compositeMode !== 'None' || obj.morphFactor > 0.01) ? 1.5 : 1.0;
            const maxSteps = Math.max(minSteps, Math.floor(baseSteps / (1.0 + Math.max(0, dist - 10.0) * 0.05 * complexity)));
            const maxBackSteps = Math.max(minSteps, Math.floor(baseBackSteps / (1.0 + Math.max(0, dist - 10.0) * 0.05 * complexity)));

            objectDataInt[84] = maxSteps;
            objectDataInt[85] = maxBackSteps;

            // Task 7 & 13: Adaptive margin and combined bounds
            const margin = (Math.abs(obj.bendAmount) < 0.05 && (obj.compositeMode === 'None' || obj._compositeMode === 0)) ? 1.2 : 2.0;
            objectData[66] = margin; // Was 67

            let rbX = obj.dimensions.x, rbY = obj.dimensions.y, rbZ = obj.dimensions.z;
            if (obj._compositeMode !== 0) {
                const sx = Math.sin(obj._srx), cx = Math.cos(obj._srx);
                const sy = Math.sin(obj._sry), cy = Math.cos(obj._sry);
                const sz = Math.sin(obj._srz), cz = Math.cos(obj._srz);
                const RX = [1,0,0, 0,cx,-sx, 0,sx,cx];
                const RY = [cy,0,sy, 0,1,0, -sy,0,cy];
                const RZ = [cz,-sz,0, sz,cz,0, 0,0,1];
                function mul3(A, B) {
                    const R = new Array(9);
                    for (let r = 0; r < 3; r++)
                        for (let c = 0; c < 3; c++)
                            R[r*3+c] = A[r*3+0]*B[0*3+c] + A[r*3+1]*B[1*3+c] + A[r*3+2]*B[2*3+c];
                    return R;
                }
                const rot = mul3(mul3(RZ, RY), RX);
                function mv(m, v) { return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]]; }
                function vadd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
                const sd = [obj._sdx, obj._sdy, obj._sdz];
                const sp = [obj._spx, obj._spy, obj._spz];
                const signs = [-1, 1];
                for (const bx of signs) for (const by of signs) for (const bz of signs) {
                    const p = vadd(sp, mv(rot, [bx*sd[0], by*sd[1], bz*sd[2]]));
                    rbX = Math.max(rbX, Math.abs(p[0]));
                    rbY = Math.max(rbY, Math.abs(p[1]));
                    rbZ = Math.max(rbZ, Math.abs(p[2]));
                }
            }
            objectData[68] = rbX;
            objectData[69] = rbY;
            objectData[70] = rbZ;

            // Bounding Volume Early-Out (Tier 3 Optimization)
            const bendFactor = 1.0 + Math.abs(obj.bendAmount) * 2.5;
            const diagonal = Math.sqrt(rbX * rbX + rbY * rbY + rbZ * rbZ) + obj.borderRadius;
            objectData[71] = diagonal * margin * bendFactor * 1.5;

            if (objectUbo) {
                gl.bindBuffer(gl.UNIFORM_BUFFER, objectUbo);
                gl.bufferSubData(gl.UNIFORM_BUFFER, 0, objectData);
            }

            if (needsSvg && svgSdfReady && svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, svgSdfTexture);
                if (svgTexLoc) gl.uniform1i(svgTexLoc, 0);
            }

            // Scissor test: skip pixels outside the object's screen-space bounding rect
            const scissor = calculateScissorRect(scene, obj, gl.canvas.width, gl.canvas.height);
            if (scissor && scissor.w > 0 && scissor.h > 0) {
                gl.scissor(scissor.x, scissor.y, scissor.w, scissor.h);
            } else {
                gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);
            }

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });

        gl.bindVertexArray(null);
        rafId = requestAnimationFrame(render);
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = (window.devicePixelRatio || 1) * resolutionScale;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    return {
        start() { resize(); rafId = requestAnimationFrame(render); },
        stop() { cancelAnimationFrame(rafId); paused = true; },
        resume() { paused = false; rafId = requestAnimationFrame(render); },
        resize,
        get paused() { return paused; },
        set paused(v) { if (v) this.stop(); else this.resume(); },
        dispose() {
            cancelAnimationFrame(rafId);
            gl.deleteProgram(program);
            gl.deleteBuffer(quadBuffer);
            gl.deleteVertexArray(vao);
            if (svgSdfTexture) gl.deleteTexture(svgSdfTexture);
        }
    };
}
`;
}

/**
 * Returns the JavaScript source for inline SVG SDF generation.
 * Only included in exports that contain SVG-type objects.
 */
export function getSvgSdfSource(): string {
    return `
const SDF_SPREAD = 32;

function parseSvgToSdfTextureAsync(svgString, resolution) {
    return new Promise((resolve) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) { resolve(null); return; }

        const viewBox = svgEl.getAttribute('viewBox');
        let vbW = 100, vbH = 100;
        if (viewBox) {
            const parts = viewBox.split(/[\\s,]+/).map(Number);
            if (parts.length === 4) { vbW = parts[2]; vbH = parts[3]; }
        } else {
            vbW = parseFloat(svgEl.getAttribute('width') || '100');
            vbH = parseFloat(svgEl.getAttribute('height') || '100');
        }

        const img = new Image();
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);
            const c = document.createElement('canvas');
            c.width = resolution; c.height = resolution;
            const ctx = c.getContext('2d', { willReadFrequently: true });

            const padding = resolution * 0.1;
            const availRes = resolution - padding * 2;
            const scale = Math.min(availRes / vbW, availRes / vbH);
            const drawW = vbW * scale, drawH = vbH * scale;
            const offsetX = padding + (availRes - drawW) / 2;
            const offsetY = padding + (availRes - drawH) / 2;

            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++)
                    ctx.drawImage(img, offsetX + dx, offsetY + dy, drawW, drawH);

            const imageData = ctx.getImageData(0, 0, resolution, resolution);
            const pixels = imageData.data;
            const mask = new Uint8Array(resolution * resolution);
            for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 10 ? 1 : 0;

            dilateMask(mask, resolution, resolution, 4);
            ensureConnectivity(mask, resolution, resolution);
            resolve(computeSdf(mask, resolution, resolution, SDF_SPREAD));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

function computeSdf(mask, width, height, spread) {
    const sdf = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const inside = mask[idx] === 1;
            let minDist = spread;
            const x0 = Math.max(0, x - spread), x1 = Math.min(width - 1, x + spread);
            const y0 = Math.max(0, y - spread), y1 = Math.min(height - 1, y + spread);
            for (let sy = y0; sy <= y1; sy++)
                for (let sx = x0; sx <= x1; sx++) {
                    if (mask[sy * width + sx] !== mask[idx]) {
                        const d = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2);
                        if (d < minDist) minDist = d;
                    }
                }
            sdf[idx] = (inside ? -minDist : minDist) / spread;
        }
    }
    return sdf;
}

function dilateMask(mask, width, height, iterations) {
    for (let iter = 0; iter < iterations; iter++) {
        const copy = new Uint8Array(mask);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (copy[idx] === 1) continue;
                outer: for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height && copy[ny * width + nx] === 1) {
                            mask[idx] = 1; break outer;
                        }
                    }
            }
    }
}

function ensureConnectivity(mask, width, height) {
    const labels = new Int32Array(width * height).fill(-1);
    let componentCount = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1 && labels[i] === -1) {
            componentCount++;
            const queue = [i]; labels[i] = componentCount; let head = 0;
            while (head < queue.length) {
                const idx = queue[head++], x = idx % width, y = Math.floor(idx / width);
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (mask[nIdx] === 1 && labels[nIdx] === -1) { labels[nIdx] = componentCount; queue.push(nIdx); }
                    }
                }
            }
        }
    }
    if (componentCount <= 1) return;
    const connectedToMain = new Set([1]);
    const mainMask = new Uint8Array(width * height);
    for (let i = 0; i < labels.length; i++) if (labels[i] === 1) mainMask[i] = 1;
    while (connectedToMain.size < componentCount) {
        const queue = [], dists = new Int32Array(width * height).fill(-1), parents = new Int32Array(width * height).fill(-1);
        for (let i = 0; i < mask.length; i++) if (mainMask[i] === 1) { queue.push(i); dists[i] = 0; }
        let head = 0, foundIdx = -1;
        while (head < queue.length) {
            const idx = queue[head++], x = idx % width, y = Math.floor(idx / width);
            if (mask[idx] === 1 && labels[idx] !== -1 && !connectedToMain.has(labels[idx])) { foundIdx = idx; break; }
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (dists[nIdx] === -1) { dists[nIdx] = dists[idx] + 1; parents[nIdx] = idx; queue.push(nIdx); }
                }
            }
        }
        if (foundIdx !== -1) {
            const newLabel = labels[foundIdx];
            let curr = foundIdx;
            while (curr !== -1) {
                if (mainMask[curr] === 1) break;
                const cx = curr % width, cy = Math.floor(curr / width);
                for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) { const bIdx = ny * width + nx; mask[bIdx] = 1; mainMask[bIdx] = 1; }
                }
                curr = parents[curr];
            }
            for (let i = 0; i < labels.length; i++) if (labels[i] === newLabel) mainMask[i] = 1;
            connectedToMain.add(newLabel);
        } else break;
    }
}
`;
}
