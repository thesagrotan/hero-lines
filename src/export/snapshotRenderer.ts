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

    const uniforms = {};
    uniformNames.forEach(name => {
        const loc = gl.getUniformLocation(program, name);
        if (loc) uniforms[name] = loc;
    });

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

        gl.uniform2f(uniforms['u_resolution'], gl.canvas.width, gl.canvas.height);
        gl.uniform1f(uniforms['u_time'], now * 0.001);
        gl.uniform3f(uniforms['u_camPos'], scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz);
        gl.uniform3f(uniforms['u_bgColor'], bg[0], bg[1], bg[2]);

        snapshot.objects.forEach(obj => {
            if (!obj.visible) return;

            gl.uniform3f(uniforms['u_position'], obj.position.x, obj.position.y, obj.position.z);
            gl.uniform3f(uniforms['u_boxSize'], obj.dimensions.x, obj.dimensions.y, obj.dimensions.z);
            gl.uniform3f(uniforms['u_rot'],
                obj.rotation.x * DEG_TO_RAD,
                obj.rotation.y * DEG_TO_RAD,
                obj.rotation.z * DEG_TO_RAD
            );

            gl.uniform1f(uniforms['u_borderRadius'], obj.borderRadius);
            gl.uniform1f(uniforms['u_borderThickness'], obj.thickness);
            gl.uniform1f(uniforms['u_speed'], obj.speed);
            gl.uniform1f(uniforms['u_trailLength'], obj.longevity);
            gl.uniform1f(uniforms['u_ease'], obj.ease);
            gl.uniform1f(uniforms['u_numLines'], obj.numLines);
            gl.uniform1f(uniforms['u_timeNoise'], obj.timeNoise);
            gl.uniform1f(uniforms['u_bendAmount'], obj.bendAmount);
            gl.uniform1f(uniforms['u_bendAngle'], obj.bendAngle);
            gl.uniform1f(uniforms['u_bendOffset'], obj.bendOffset);
            gl.uniform1f(uniforms['u_bendLimit'], obj.bendLimit);
            gl.uniform1i(uniforms['u_bendAxis'], BEND_AXIS_MAP[obj.bendAxis] || 1);
            gl.uniform1f(uniforms['u_rimIntensity'], obj.rimIntensity || 0.4);
            gl.uniform1f(uniforms['u_wireOpacity'], obj.wireOpacity || 0.1);
            gl.uniform1f(uniforms['u_rimPower'], obj.rimPower || 3.0);
            gl.uniform1f(uniforms['u_layerDelay'], obj.layerDelay || 0.02);
            gl.uniform1f(uniforms['u_wireIntensity'], obj.wireIntensity || 0.1);
            gl.uniform1f(uniforms['u_torusThickness'], obj.torusThickness || 0.2);
            gl.uniform1f(uniforms['u_lineBrightness'], obj.lineBrightness || 2.5);
            gl.uniform1f(uniforms['u_wobbleAmount'], obj.wobbleAmount || 0);
            gl.uniform1f(uniforms['u_wobbleSpeed'], obj.wobbleSpeed || 1);
            gl.uniform1f(uniforms['u_wobbleScale'], obj.wobbleScale || 2);
            gl.uniform1f(uniforms['u_chromaticAberration'], obj.chromaticAberration || 0);
            gl.uniform1f(uniforms['u_pulseIntensity'], obj.pulseIntensity || 0);
            gl.uniform1f(uniforms['u_pulseSpeed'], obj.pulseSpeed || 1);
            gl.uniform1f(uniforms['u_scanlineIntensity'], obj.scanlineIntensity || 0);

            gl.uniform1i(uniforms['u_shapeType'], SHAPE_MAP[obj.shapeType] || 0);
            gl.uniform1i(uniforms['u_shapeTypeNext'], SHAPE_MAP[obj.shapeType] || 0);
            gl.uniform1f(uniforms['u_morphFactor'], 0.0);
            gl.uniform1i(uniforms['u_orientation'], ORIENT_MAP[obj.orientation] || 0);
            gl.uniform1i(uniforms['u_compositeMode'], COMPOSITE_MAP[obj.compositeMode] || 0);
            gl.uniform1i(uniforms['u_secondaryShapeType'], SHAPE_MAP[obj.secondaryShapeType] || 1);
            gl.uniform3f(uniforms['u_secondaryPosition'], obj.secondaryPosition.x, obj.secondaryPosition.y, obj.secondaryPosition.z);
            gl.uniform3f(uniforms['u_secondaryRotation'],
                obj.secondaryRotation.x * DEG_TO_RAD,
                obj.secondaryRotation.y * DEG_TO_RAD,
                obj.secondaryRotation.z * DEG_TO_RAD
            );
            gl.uniform3f(uniforms['u_secondaryDimensions'], obj.secondaryDimensions.x, obj.secondaryDimensions.y, obj.secondaryDimensions.z);
            gl.uniform1f(uniforms['u_compositeSmoothness'], obj.compositeSmoothness || 0.1);

            // SVG SDF
            const needsSvg = obj.shapeType === 'SVG';
            if (needsSvg && svgSdfReady && svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, svgSdfTexture);
                gl.uniform1i(uniforms['u_svgSdfTex'], 0);
                gl.uniform1i(uniforms['u_hasSvgSdf'], 1);
                gl.uniform1f(uniforms['u_svgExtrusionDepth'], obj.svgExtrusionDepth || 0.5);
                gl.uniform1f(uniforms['u_svgSpread'], svgSdfModule ? svgSdfModule.SDF_SPREAD : 32);
                gl.uniform1f(uniforms['u_svgResolution'], svgSdfResolution);
            } else {
                gl.uniform1i(uniforms['u_hasSvgSdf'], 0);
            }

            const c1 = hexToRgb(obj.color1);
            const c2 = hexToRgb(obj.color2);
            const rc = hexToRgb(obj.rimColor);
            gl.uniform3f(uniforms['u_color1'], c1[0], c1[1], c1[2]);
            gl.uniform3f(uniforms['u_color2'], c2[0], c2[1], c2[2]);
            gl.uniform3f(uniforms['u_rimColor'], rc[0], rc[1], rc[2]);

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
