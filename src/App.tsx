// ... (imports remain same)
import { useEffect, useRef } from 'react'
import { useControls } from 'leva'

const vsSource = `#version 300 es
in vec4 position;
void main() { gl_Position = position; }
`

const fsSource = `#version 300 es
// Antialiasing Refactor v3 - Robust Edition
precision highp float;

out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_camPos;
uniform vec3 u_boxSize;
uniform vec3 u_rot; 
uniform float u_borderRadius;
uniform float u_borderThickness;
uniform float u_speed;
uniform float u_trailLength;
uniform float u_ease;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_rimColor;
uniform float u_numLines;
uniform int u_shapeType; // 0: Box, 1: Sphere, 2: Cone

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float sdCone(vec3 p, vec2 c, float h) {
    float q = length(p.xz);
    return max(dot(c.xy, vec2(q, p.y)), -h - p.y);
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdCylinder(vec3 p, vec2 h) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - h;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    float d_out = length(max(q, 0.0));
    float d_in = min(max(q.x, max(q.y, q.z)), 0.0);
    return d_out + d_in - r;
}

float map(vec3 p, vec3 boxSize, float radius) {
    if (u_shapeType == 1) {
        return sdSphere(p, boxSize.y);
    } else if (u_shapeType == 2) {
        return sdCone(p, vec2(0.5, 0.5), boxSize.y);
    } else if (u_shapeType == 3) {
        return sdTorus(p, vec2(boxSize.x, boxSize.y * 0.4));
    } else if (u_shapeType == 4) {
        return sdCapsule(p, vec3(0, -boxSize.y, 0), vec3(0, boxSize.y, 0), boxSize.x * 0.5);
    } else if (u_shapeType == 5) {
        return sdCylinder(p, vec2(boxSize.x, boxSize.y));
    }
    vec3 innerSize = max(boxSize - vec3(radius), vec3(0.001));
    return sdRoundBox(p, innerSize, radius);
}

vec3 calcNormal(vec3 p, vec3 boxSize, float radius) {
    const float h = 0.0001;
    const vec2 k = vec2(1.0, -1.0);
    vec3 n = k.xyy * map(p + k.xyy * h, boxSize, radius) + 
             k.yyx * map(p + k.yyx * h, boxSize, radius) + 
             k.yxy * map(p + k.yxy * h, boxSize, radius) + 
             k.xxx * map(p + k.xxx * h, boxSize, radius);
    return normalize(n);
}

mat3 rotX(float a) { float s=sin(a), c=cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a) { float s=sin(a), c=cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }
mat3 rotZ(float a) { float s=sin(a), c=cos(a); return mat3(c,-s,0, s,c,0, 0,0,1); }

vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * boxSize;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return vec2(-1.0, -1.0);
    return vec2(tN, tF);
}

vec3 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack) {
    float numLayers = u_numLines;
    float yRange = 2.0 * boxSize.y;
    float yNorm = clamp((p.y + boxSize.y) / yRange, 0.0, 1.0);
    float layerIdx = floor(yNorm * numLayers);
    float layerGap = yRange / (numLayers + 0.001);
    float layerCenter = (layerIdx + 0.5) * layerGap - boxSize.y;
    
    float dy = fwidth(p.y);
    float actualThick = min(thickness, layerGap * 0.48);
    float lineMask = 1.0 - smoothstep(actualThick - dy, actualThick + dy, abs(p.y - layerCenter));
    
    vec3 pUse = clamp(p, -boxSize, boxSize);
    float px = pUse.x, pz = pUse.z;
    float bx = boxSize.x, bz = boxSize.z;
    
    float perimeter = 0.0;
    if (abs(pz * bx) > abs(px * bz)) {
        perimeter = (pz > 0.0) ? (bx + px) : (3.0 * bx + 2.0 * bz - px);
    } else {
        perimeter = (px > 0.0) ? (2.0 * bx + bz - pz) : (4.0 * bx + 3.0 * bz + pz);
    }
    
    float total = 4.0 * (bx + bz);
    float progress = mod(time * u_speed - layerIdx * 0.02, 3.0);
    float dist = fract(progress - (perimeter / (total + 0.001)));
    
    float isActive = 0.0;
    if (dist < u_trailLength) {
        float t = 1.0 - (dist / u_trailLength);
        float fade = smoothstep(0.0, max(0.01, u_ease), t) * smoothstep(0.0, max(0.01, u_ease), 1.0 - t);
        isActive = pow(fade, 1.5);
    }

    vec3 fw_p = fwidth(p);
    vec3 dEdge = abs(abs(p) - boxSize);
    float edgeW = thickness * 2.5;
    vec3 proxim = 1.0 - smoothstep(edgeW - fw_p, edgeW + fw_p, dEdge);
    // Explicit component access to avoid swizzling issues
    float wX = proxim.x; float wY = proxim.y; float wZ = proxim.z;
    float wireframe = max(wX * wZ, max(wY * wZ, wX * wY));

    vec3 n = calcNormal(p, boxSize, u_borderRadius);
    float capMask = smoothstep(0.1, 0.4, 1.0 - abs(n.y));
    
    float alpha = lineMask * isActive * capMask;
    vec3 col = mix(u_color1, u_color2, isActive) * alpha;
    
    // Wireframe only for box for now, or adapted
    vec3 wire = vec3(0.0);
    if (u_shapeType == 0) {
        wire = u_color1 * 0.1 * wireframe;
    }
    
    float intensity = isBack ? 1.0 : 2.5;
    return (col + wire) * intensity;
}

float cheap_hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
    vec2 res = u_resolution;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    
    mat3 mR = rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x);
    mat3 mI = transpose(mR);
    
    vec3 ro_l = mI * u_camPos;
    vec3 fwd = normalize(mI * -u_camPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    vec3 finalCol = vec3(0.0);

    if (tBox.x > 0.0) {
        float t = tBox.x;
        bool hit = false;
        vec3 p;
        for(int i=0; i<64; i++) {
            p = ro_l + rd * t;
            float d = map(p, u_boxSize, u_borderRadius);
            if(d < 0.001) { hit = true; break; }
            t += d;
            if(t > tBox.y) break;
        }
        if(hit) {
            finalCol += getSurfaceColor(p, u_boxSize, u_time, u_borderThickness, false);
            vec3 n = calcNormal(p, u_boxSize, u_borderRadius);
            float rim = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
            finalCol += u_rimColor * rim * 0.4;
        }
        
        vec3 ro_b = ro_l + rd * tBox.y;
        vec3 rd_b = -rd;
        float tb = 0.0;
        hit = false;
        for(int i=0; i<64; i++) {
             p = ro_b + rd_b * tb;
             float d = map(p, u_boxSize, u_borderRadius);
             if(d < 0.001) { hit = true; break; }
             tb += d;
             if(tb > (tBox.y - tBox.x)) break;
        }
        if(hit) {
             finalCol += getSurfaceColor(p, u_boxSize, u_time, u_borderThickness, true) * 0.5;
        }
    }

    finalCol += (cheap_hash(uv.x + uv.y + u_time) - 0.5) * 0.02;
    fragColor = vec4(finalCol, 1.0);
}
`

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
    }
    return shader
}

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const fpsRef = useRef<HTMLDivElement>(null)

    // Leva controls
    const controls = useControls({
        'Camera Position': {
            value: { x: 5.0, y: 4.5, z: 8.0 },
            joystick: false,
        },
        camX: { value: 5.0, min: -10, max: 10, step: 0.1, label: 'Cam X' },
        camY: { value: 4.5, min: -10, max: 10, step: 0.1, label: 'Cam Y' },
        camZ: { value: 8.0, min: 0.1, max: 20, step: 0.1, label: 'Cam Z' },

        boxX: { value: 1.5, min: 0.1, max: 4, step: 0.05, label: 'Width (X)' },
        boxY: { value: 1.0, min: 0.1, max: 4, step: 0.05, label: 'Height (Y)' },
        boxZ: { value: 2.2, min: 0.1, max: 4, step: 0.05, label: 'Depth (Z)' },

        rotX: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate X (deg)' },
        rotY: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate Y (deg)' },
        rotZ: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate Z (deg)' },

        borderRadius: { value: 0.1, min: 0.0, max: 1.0, step: 0.01, label: 'Border Radius' },
        numLines: { value: 30, min: 1, max: 100, step: 1, label: 'Line Count' },
        thickness: { value: 0.01, min: 0.001, max: 0.1, step: 0.001, label: 'Line Thickness' },
        speed: { value: 0.8, min: 0.0, max: 5.0, step: 0.1, label: 'Speed' },
        longevity: { value: 0.4, min: 0.05, max: 2.0, step: 0.05, label: 'Longevity' },
        ease: { value: 0.5, min: 0.0, max: 1.0, step: 0.1, label: 'Ease In/Out' },
        color1: { value: '#0d66ff', label: 'Color 1' },
        color2: { value: '#4cccff', label: 'Color 2' },
        rimColor: { value: '#1a66cc', label: 'Rim Color' },
        shapeType: {
            value: 'Box',
            options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder'],
            label: 'Shape'
        },
    })

    // Ref to hold current control values for the render loop
    const controlsRef = useRef(controls)

    // Update ref when controls change
    useEffect(() => {
        controlsRef.current = controls
    }, [controls])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const gl = canvas.getContext('webgl2')
        if (!gl) {
            console.error('WebGL2 not supported')
            return
        }

        const program = gl.createProgram()
        if (!program) return

        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource)
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource)

        if (!vs || !fs) return

        gl.attachShader(program, vs)
        gl.attachShader(program, fs)
        gl.linkProgram(program)
        gl.useProgram(program)

        const posBuf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

        const posLoc = gl.getAttribLocation(program, 'position')
        gl.enableVertexAttribArray(posLoc)
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

        const uTime = gl.getUniformLocation(program, 'u_time')
        const uRes = gl.getUniformLocation(program, 'u_resolution')
        const uCamPos = gl.getUniformLocation(program, 'u_camPos')
        const uBoxSize = gl.getUniformLocation(program, 'u_boxSize')
        const uRot = gl.getUniformLocation(program, 'u_rot')
        const uBorderRadius = gl.getUniformLocation(program, 'u_borderRadius')
        const uBorderThickness = gl.getUniformLocation(program, 'u_borderThickness')
        const uSpeed = gl.getUniformLocation(program, 'u_speed')
        const uTrailLength = gl.getUniformLocation(program, 'u_trailLength')
        const uEase = gl.getUniformLocation(program, 'u_ease')
        const uColor1 = gl.getUniformLocation(program, 'u_color1')
        const uColor2 = gl.getUniformLocation(program, 'u_color2')
        const uRimColor = gl.getUniformLocation(program, 'u_rimColor')
        const uNumLines = gl.getUniformLocation(program, 'u_numLines')
        const uShapeType = gl.getUniformLocation(program, 'u_shapeType')

        let animationFrameId: number
        let lastFpsUpdate = 0
        let frameCount = 0

        const render = (time: number) => {
            // FPS Counter logic
            frameCount++
            if (time - lastFpsUpdate > 500) {
                const fps = Math.round((frameCount * 1000) / (time - lastFpsUpdate))
                if (fpsRef.current) {
                    fpsRef.current.innerText = `${fps} FPS`
                }
                lastFpsUpdate = time
                frameCount = 0
            }

            // Access current values from ref
            const {
                camX, camY, camZ,
                boxX, boxY, boxZ,
                rotX, rotY, rotZ,
                borderRadius, thickness,
                speed, longevity, ease,
                color1, color2, rimColor,
                numLines, shapeType
            } = controlsRef.current

            gl.uniform1f(uTime, time * 0.001)
            gl.uniform2f(uRes, canvas.width, canvas.height)
            gl.uniform3f(uCamPos, camX, camY, camZ)
            gl.uniform3f(uBoxSize, boxX, boxY, boxZ)

            // Convert degrees to radians
            const toRad = Math.PI / 180
            gl.uniform3f(uRot, rotX * toRad, rotY * toRad, rotZ * toRad)
            gl.uniform1f(uBorderRadius, borderRadius)
            gl.uniform1f(uBorderThickness, thickness)
            gl.uniform1f(uSpeed, speed)
            gl.uniform1f(uTrailLength, longevity)
            gl.uniform1f(uEase, ease)
            gl.uniform1f(uNumLines, numLines)

            const shapeModeMap: Record<string, number> = {
                'Box': 0, 'Sphere': 1, 'Cone': 2, 'Torus': 3, 'Capsule': 4, 'Cylinder': 5
            }
            gl.uniform1i(uShapeType, shapeModeMap[shapeType] ?? 0)

            // Helper to parse hex color to normalized RGB
            const hexToRgb = (hex: string) => {
                const r = parseInt(hex.slice(1, 3), 16) / 255
                const g = parseInt(hex.slice(3, 5), 16) / 255
                const b = parseInt(hex.slice(5, 7), 16) / 255
                return [r, g, b]
            }

            const c1 = hexToRgb(color1)
            const c2 = hexToRgb(color2)
            const cr = hexToRgb(rimColor)

            gl.uniform3f(uColor1, c1[0], c1[1], c1[2])
            gl.uniform3f(uColor2, c2[0], c2[1], c2[2])
            gl.uniform3f(uRimColor, cr[0], cr[1], cr[2])

            gl.drawArrays(gl.TRIANGLES, 0, 6)
            animationFrameId = requestAnimationFrame(render)
        }

        const handleResize = () => {
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
            gl.viewport(0, 0, canvas.width, canvas.height)
        }

        window.addEventListener('resize', handleResize)
        handleResize()

        animationFrameId = requestAnimationFrame(render)

        return () => {
            window.removeEventListener('resize', handleResize)
            cancelAnimationFrame(animationFrameId)
            gl.deleteProgram(program)
            gl.deleteShader(vs)
            gl.deleteShader(fs)
        }
    }, []) // Empty dependency array ensures WebGL context is created only once

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
            <canvas ref={canvasRef} />
            <div ref={fpsRef} className="fps-counter" />
        </div>
    )
}
