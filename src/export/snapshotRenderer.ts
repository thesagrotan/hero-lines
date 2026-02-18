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

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
    ];
}

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

function initSnapshot(canvas, snapshot, vsSource, fsSource, svgSdfModule) {
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
    const sceneData = new Float32Array(12);
    const objectData = new Float32Array(76);
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

    // Fullscreen quad
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // SVG SDF texture state
    let svgSdfTexture = null;
    let svgSdfResolution = 0;
    let svgSdfReady = false;

    // Check if any object needs SVG SDF
    const svgObj = snapshot.objects.find(o => o.visible && o.shapeType === 'SVG' && o.svgData && o.svgData.svgString);
    if (svgObj && svgSdfModule) {
        const SDF_SPREAD = svgSdfModule.SDF_SPREAD;
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

    const scene = snapshot.scene;
    const bg = hexToRgb(scene.bgColor);
    const iz = 1.0 / scene.zoom;

    let paused = false;
    let rafId = 0;

    function render(now) {
        if (paused) return;

        gl.useProgram(program);
        gl.clearColor(bg[0], bg[1], bg[2], 1.0);
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

        snapshot.objects.forEach(obj => {
            if (!obj.visible) return;

            // Fill Object UBO Data
            objectData[0] = obj.position.x;
            objectData[1] = obj.position.y;
            objectData[2] = obj.position.z;

            objectData[4] = obj.dimensions.x;
            objectData[5] = obj.dimensions.y;
            objectData[6] = obj.dimensions.z;

            objectData[8] = obj.rotation.x * DEG_TO_RAD;
            objectData[9] = obj.rotation.y * DEG_TO_RAD;
            objectData[10] = obj.rotation.z * DEG_TO_RAD;

            const c1 = hexToRgb(obj.color1);
            objectData[12] = c1[0];
            objectData[13] = c1[1];
            objectData[14] = c1[2];

            const c2 = hexToRgb(obj.color2);
            objectData[16] = c2[0];
            objectData[17] = c2[1];
            objectData[18] = c2[2];

            const rc = hexToRgb(obj.rimColor);
            objectData[20] = rc[0];
            objectData[21] = rc[1];
            objectData[22] = rc[2];

            objectData[24] = (obj.secondaryPosition || {x:0,y:0,z:0}).x;
            objectData[25] = (obj.secondaryPosition || {x:0,y:0,z:0}).y;
            objectData[26] = (obj.secondaryPosition || {x:0,y:0,z:0}).z;

            objectData[28] = (obj.secondaryRotation || {x:0,y:0,z:0}).x * DEG_TO_RAD;
            objectData[29] = (obj.secondaryRotation || {x:0,y:0,z:0}).y * DEG_TO_RAD;
            objectData[30] = (obj.secondaryRotation || {x:0,y:0,z:0}).z * DEG_TO_RAD;

            objectData[32] = (obj.secondaryDimensions || {x:1,y:1,z:1}).x;
            objectData[33] = (obj.secondaryDimensions || {x:1,y:1,z:1}).y;
            objectData[34] = (obj.secondaryDimensions || {x:1,y:1,z:1}).z;

            objectData[36] = obj.borderRadius || 0;
            objectData[37] = obj.thickness || 0.05;
            objectData[38] = obj.speed || 1;
            objectData[39] = obj.longevity || 0.5;

            objectData[40] = obj.ease || 0.1;
            objectData[41] = obj.numLines || 10;
            objectData[42] = 0; // morphFactor
            objectData[43] = obj.timeNoise || 0;

            objectData[44] = obj.svgExtrusionDepth || 0.5;
            objectData[45] = 32; // SDF_SPREAD
            objectData[46] = svgSdfResolution;
            objectData[47] = obj.bendAmount || 0;

            objectData[48] = obj.bendAngle || 0;
            objectData[49] = obj.bendOffset || 0;
            objectData[50] = obj.bendLimit || 10;
            objectData[51] = obj.rimIntensity || 0.4;

            objectData[52] = obj.rimPower || 3.0;
            objectData[53] = obj.wireOpacity || 0.1;
            objectData[54] = obj.wireIntensity || 0.1;
            objectData[55] = obj.layerDelay || 0.02;

            objectData[56] = obj.torusThickness || 0.2;
            objectData[57] = obj.lineBrightness || 2.5;
            objectData[58] = obj.wobbleAmount || 0;
            objectData[59] = obj.wobbleSpeed || 1;

            objectData[60] = obj.wobbleScale || 2;
            objectData[61] = obj.chromaticAberration || 0;
            objectData[62] = obj.pulseIntensity || 0;
            objectData[63] = obj.pulseSpeed || 1;

            objectData[64] = obj.scanlineIntensity || 0;
            objectData[65] = obj.compositeSmoothness || 0.1;

            objectDataInt[66] = SHAPE_MAP[obj.shapeType] || 0;
            objectDataInt[67] = SHAPE_MAP[obj.shapeType] || 0; // shapeTypeNext
            objectDataInt[68] = ORIENT_MAP[obj.orientation] || 0;
            
            const needsSvg = obj.shapeType === 'SVG';
            objectDataInt[69] = (needsSvg && svgSdfReady && svgSdfTexture) ? 1 : 0;
            objectDataInt[70] = BEND_AXIS_MAP[obj.bendAxis] || 1;
            objectDataInt[71] = COMPOSITE_MAP[obj.compositeMode] || 0;
            objectDataInt[72] = SHAPE_MAP[obj.secondaryShapeType] || 1;

            if (objectUbo) {
                gl.bindBuffer(gl.UNIFORM_BUFFER, objectUbo);
                gl.bufferSubData(gl.UNIFORM_BUFFER, 0, objectData);
            }

            if (needsSvg && svgSdfReady && svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, svgSdfTexture);
                if (svgTexLoc) gl.uniform1i(svgTexLoc, 0);
            }



            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });

        rafId = requestAnimationFrame(render);
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
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
