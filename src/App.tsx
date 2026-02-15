import { useEffect, useRef, useState } from 'react'
import { useControls, folder } from 'leva'
import { Timeline, TimelineModel, TimelineRow, TimelineKeyframe } from 'animation-timeline-js'
import './timeline.css'

// Custom interface for keyframes with values
interface PropertyKeyframe extends TimelineKeyframe {
    value: number | string;
}

interface PropertyRow extends TimelineRow {
    keyframes?: PropertyKeyframe[];
    name: string;
}

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
uniform int u_orientation; // 0: Horizontal (X), 1: Vertical (Y), 2: Depth (Z), 3: Diagonal

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float sdCone(vec3 p, vec2 c, float h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    float q = length(p_o.yz);
    return max(dot(c.xy, vec2(q, p_o.x)), -h - p_o.x);
}

float sdTorus(vec3 p, vec2 t, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec2 q = vec2(length(p_o.yz) - t.x, p_o.x);
    return length(q) - t.y;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdCylinder(vec3 p, vec2 h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec2 d = abs(vec2(length(p_o.yz), p_o.x)) - h;
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
        return sdSphere(p, boxSize.x);
    } else if (u_shapeType == 2) {
        return sdCone(p, vec2(0.5, 0.5), boxSize.x, u_orientation);
    } else if (u_shapeType == 3) {
        float major = (u_orientation == 1) ? boxSize.x : boxSize.y;
        float minor = (u_orientation == 1) ? boxSize.y : boxSize.x;
        return sdTorus(p, vec2(major, minor * 0.4), u_orientation);
    } else if (u_shapeType == 4) {
        vec3 a = vec3(0), b = vec3(0);
        if (u_orientation == 1) { a = vec3(0, -boxSize.y, 0); b = vec3(0, boxSize.y, 0); }
        else if (u_orientation == 2) { a = vec3(0, 0, -boxSize.z); b = vec3(0, 0, boxSize.z); }
        else { a = vec3(-boxSize.x, 0, 0); b = vec3(boxSize.x, 0, 0); }
        float r = (u_orientation == 1) ? boxSize.x : (u_orientation == 2) ? boxSize.x : boxSize.y;
        return sdCapsule(p, a, b, r * 0.5);
    } else if (u_shapeType == 5) {
        float h = (u_orientation == 1) ? boxSize.y : (u_orientation == 2) ? boxSize.z : boxSize.x;
        float r = (u_orientation == 1) ? boxSize.x : (u_orientation == 2) ? boxSize.x : boxSize.y;
        return sdCylinder(p, vec2(r, h), u_orientation);
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
    float sliceCoord = p.x;
    float sliceRange = 2.0 * boxSize.x;
    if (u_orientation == 1) { sliceCoord = p.y; sliceRange = 2.0 * boxSize.y; }
    else if (u_orientation == 2) { sliceCoord = p.z; sliceRange = 2.0 * boxSize.z; }
    else if (u_orientation == 3) { sliceCoord = (p.x + p.y + p.z) * 0.57735; sliceRange = length(2.0 * boxSize); }
    
    float norm = clamp((sliceCoord + sliceRange * 0.5) / sliceRange, 0.0, 1.0);
    float layerIdx = floor(norm * numLayers);
    float layerGap = sliceRange / (numLayers + 0.001);
    float layerCenter = (layerIdx + 0.5) * layerGap - sliceRange * 0.5;
    
    float ds = fwidth(sliceCoord);
    float actualThick = min(thickness, layerGap * 0.48);
    float lineMask = 1.0 - smoothstep(actualThick - ds, actualThick + ds, abs(sliceCoord - layerCenter));
    
    vec3 pUse = clamp(p, -boxSize, boxSize);
    float p1 = pUse.y, p2 = pUse.z, b1 = boxSize.y, b2 = boxSize.z;
    if (u_orientation == 1) { p1 = pUse.x; p2 = pUse.z; b1 = boxSize.x; b2 = boxSize.z; }
    else if (u_orientation == 2) { p1 = pUse.x; p2 = pUse.y; b1 = boxSize.x; b2 = boxSize.y; }
    
    float perimeter = 0.0;
    if (abs(p2 * b1) > abs(p1 * b2)) {
        perimeter = (p2 > 0.0) ? (b1 + p1) : (3.0 * b1 + 2.0 * b2 - p1);
    } else {
        perimeter = (p1 > 0.0) ? (2.0 * b1 + b2 - p2) : (4.0 * b1 + 3.0 * b2 + p2);
    }
    
    float total = 4.0 * (b1 + b2);
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
    float wX = proxim.x; float wY = proxim.y; float wZ = proxim.z;
    float wireframe = max(wX * wZ, max(wY * wZ, wX * wY));

    vec3 n = calcNormal(p, boxSize, u_borderRadius);
    float dotV = abs(n.x);
    if (u_orientation == 1) dotV = abs(n.y);
    else if (u_orientation == 2) dotV = abs(n.z);
    else if (u_orientation == 3) dotV = abs(dot(n, vec3(0.577)));
    float capMask = smoothstep(0.1, 0.4, 1.0 - dotV);
    
    float alpha = lineMask * isActive * capMask;
    vec3 col = mix(u_color1, u_color2, isActive) * alpha;
    
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
    const timelineElRef = useRef<HTMLDivElement>(null)
    const sidebarRowsRef = useRef<HTMLDivElement>(null)
    const [timeline, setTimeline] = useState<Timeline | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [showTimeline, setShowTimeline] = useState(true)

    const showTimelineRef = useRef(true)
    useEffect(() => { showTimelineRef.current = showTimeline }, [showTimeline])

    // Leva controls
    const controls = useControls({
        Transformations: folder({
            camera: { value: { x: 5.0, y: 4.5, z: 8.0 }, label: 'Camera', step: 0.1 },
            dimensions: { value: { x: 2.5, y: 0.8, z: 1.2 }, label: 'Dimensions', step: 0.05 },
            rotation: { value: { x: 0, y: 0, z: 0 }, label: 'Rotation', step: 1 },
        }),
        'Lines & Animation': folder({
            shapeType: {
                value: 'Box',
                options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder'],
                label: 'Shape'
            },
            borderRadius: { value: 0.1, min: 0.0, max: 1.0, step: 0.01, label: 'Radius' },
            numLines: { value: 30, min: 1, max: 100, step: 1, label: 'Count' },
            thickness: { value: 0.01, min: 0.001, max: 0.1, step: 0.001, label: 'Thickness' },
            orientation: {
                value: 'Horizontal',
                options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'],
                label: 'Orientation'
            },
            speed: { value: 0.8, min: 0.0, max: 5.0, step: 0.1, label: 'Speed' },
            longevity: { value: 0.4, min: 0.05, max: 2.0, step: 0.05, label: 'Longevity' },
            ease: { value: 0.5, min: 0.0, max: 1.0, step: 0.1, label: 'Ease In/Out' },
        }),
        Appearance: folder({
            color1: { value: '#0d66ff', label: 'Color A' },
            color2: { value: '#4cccff', label: 'Color B' },
            rimColor: { value: '#1a66cc', label: 'Rim' },
        }),
    })

    const modelRef = useRef<TimelineModel>({
        rows: [
            { name: 'boxX', keyframes: [{ val: 0, value: 2.5 }, { val: 2000, value: 4.0 }, { val: 4000, value: 2.5 }] },
            { name: 'boxY', keyframes: [{ val: 0, value: 0.8 }, { val: 2000, value: 1.5 }, { val: 4000, value: 0.8 }] },
            { name: 'boxZ', keyframes: [{ val: 0, value: 1.2 }, { val: 3000, value: 0.4 }, { val: 5000, value: 1.2 }] },
            { name: 'rotX', keyframes: [{ val: 0, value: 0 }, { val: 5000, value: 360 }] },
            { name: 'rotY', keyframes: [{ val: 0, value: 0 }, { val: 5000, value: 360 }] },
            { name: 'rotZ', keyframes: [{ val: 0, value: 0 }, { val: 5000, value: 360 }] },
        ] as PropertyRow[]
    })

    // Fixed interpolation logic
    const safeInterpolate = (rowName: string, time: number, defaultValue: any) => {
        const row = (modelRef.current.rows as PropertyRow[]).find(r => r.name === rowName)
        if (!row || !row.keyframes || row.keyframes.length === 0) return defaultValue

        const kfs = [...row.keyframes].sort((a, b) => a.val - b.val)

        if (time <= kfs[0].val) return kfs[0].value
        if (time >= kfs[kfs.length - 1].val) return kfs[kfs.length - 1].value

        for (let i = 0; i < kfs.length - 1; i++) {
            const k1 = kfs[i]
            const k2 = kfs[i + 1]
            if (time >= k1.val && time <= k2.val) {
                const t = (time - k1.val) / (k2.val - k1.val)
                if (typeof k1.value === 'number' && typeof k2.value === 'number') {
                    return k1.value + (k2.value - k1.value) * t
                }
                return k1.value
            }
        }
        return defaultValue
    }

    const controlsRef = useRef(controls)
    useEffect(() => { controlsRef.current = controls }, [controls])

    const isPlayingRef = useRef(isPlaying)
    useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

    const timelineTimeRef = useRef(0)

    // Initialize Timeline
    useEffect(() => {
        if (timelineElRef.current && !timeline) {
            const newTimeline = new Timeline({
                id: timelineElRef.current,
                rowsStyle: { height: 30 }
            })
            newTimeline.setModel(modelRef.current)

            newTimeline.onScroll((args) => {
                if (sidebarRowsRef.current) {
                    sidebarRowsRef.current.scrollTop = args.scrollTop
                }
            })

            newTimeline.onTimeChanged((args) => {
                setCurrentTime(args.val)
                timelineTimeRef.current = args.val
            })

            newTimeline.onKeyframeChanged(() => {
                const updatedModel = newTimeline.getModel()
                if (updatedModel) {
                    modelRef.current = updatedModel
                }
            })

            setTimeline(newTimeline)
            return () => newTimeline.dispose()
        }
    }, [timelineElRef])

    const handleSidebarWheel = (e: React.WheelEvent) => {
        if (timeline) {
            timeline.scrollTop += e.deltaY;
        }
    }

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const gl = canvas.getContext('webgl2')
        if (!gl) return

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

        const uniforms = {
            uTime: gl.getUniformLocation(program, 'u_time'),
            uRes: gl.getUniformLocation(program, 'u_resolution'),
            uCamPos: gl.getUniformLocation(program, 'u_camPos'),
            uBoxSize: gl.getUniformLocation(program, 'u_boxSize'),
            uRot: gl.getUniformLocation(program, 'u_rot'),
            uBorderRadius: gl.getUniformLocation(program, 'u_borderRadius'),
            uBorderThickness: gl.getUniformLocation(program, 'u_borderThickness'),
            uSpeed: gl.getUniformLocation(program, 'u_speed'),
            uTrailLength: gl.getUniformLocation(program, 'u_trailLength'),
            uEase: gl.getUniformLocation(program, 'u_ease'),
            uColor1: gl.getUniformLocation(program, 'u_color1'),
            uColor2: gl.getUniformLocation(program, 'u_color2'),
            uRimColor: gl.getUniformLocation(program, 'u_rimColor'),
            uNumLines: gl.getUniformLocation(program, 'u_numLines'),
            uShapeType: gl.getUniformLocation(program, 'u_shapeType'),
            uOrientation: gl.getUniformLocation(program, 'u_orientation'),
        }

        let animationFrameId: number
        let lastFrameTime = performance.now()

        const render = (now: number) => {
            const dt = now - lastFrameTime
            lastFrameTime = now

            if (isPlayingRef.current && timeline) {
                timelineTimeRef.current += dt
                timeline.setTime(timelineTimeRef.current)
                setCurrentTime(timelineTimeRef.current)
            } else if (timeline) {
                timelineTimeRef.current = timeline.getTime()
                setCurrentTime(timelineTimeRef.current)
            }

            const c = controlsRef.current

            // Interpolate only if timeline is active
            const isTimelineActive = showTimelineRef.current
            const boxX = isTimelineActive ? safeInterpolate('boxX', timelineTimeRef.current, c.dimensions.x) : c.dimensions.x
            const boxY = isTimelineActive ? safeInterpolate('boxY', timelineTimeRef.current, c.dimensions.y) : c.dimensions.y
            const boxZ = isTimelineActive ? safeInterpolate('boxZ', timelineTimeRef.current, c.dimensions.z) : c.dimensions.z
            const rotX = isTimelineActive ? safeInterpolate('rotX', timelineTimeRef.current, c.rotation.x) : c.rotation.x
            const rotY = isTimelineActive ? safeInterpolate('rotY', timelineTimeRef.current, c.rotation.y) : c.rotation.y
            const rotZ = isTimelineActive ? safeInterpolate('rotZ', timelineTimeRef.current, c.rotation.z) : c.rotation.z

            gl.uniform1f(uniforms.uTime, now * 0.001)
            gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)
            gl.uniform3f(uniforms.uCamPos, c.camera.x, c.camera.y, c.camera.z)
            gl.uniform3f(uniforms.uBoxSize, boxX, boxY, boxZ)

            const toRad = Math.PI / 180
            gl.uniform3f(uniforms.uRot, rotX * toRad, rotY * toRad, rotZ * toRad)
            gl.uniform1f(uniforms.uBorderRadius, c.borderRadius)
            gl.uniform1f(uniforms.uBorderThickness, c.thickness)
            gl.uniform1f(uniforms.uSpeed, c.speed)
            gl.uniform1f(uniforms.uTrailLength, c.longevity)
            gl.uniform1f(uniforms.uEase, c.ease)
            gl.uniform1f(uniforms.uNumLines, c.numLines)

            const shapeModeMap: Record<string, number> = {
                'Box': 0, 'Sphere': 1, 'Cone': 2, 'Torus': 3, 'Capsule': 4, 'Cylinder': 5
            }
            gl.uniform1i(uniforms.uShapeType, shapeModeMap[c.shapeType] ?? 0)

            const orientationMap: Record<string, number> = {
                'Horizontal': 0, 'Vertical': 1, 'Depth': 2, 'Diagonal': 3
            }
            gl.uniform1i(uniforms.uOrientation, orientationMap[c.orientation] ?? 0)

            const hexToRgb = (hex: string) => {
                const r = parseInt(hex.slice(1, 3), 16) / 255
                const g = parseInt(hex.slice(3, 5), 16) / 255
                const b = parseInt(hex.slice(5, 7), 16) / 255
                return [r, g, b]
            }

            const c1 = hexToRgb(c.color1)
            const c2 = hexToRgb(c.color2)
            const cr = hexToRgb(c.rimColor)

            gl.uniform3f(uniforms.uColor1, c1[0], c1[1], c1[2])
            gl.uniform3f(uniforms.uColor2, c2[0], c2[1], c2[2])
            gl.uniform3f(uniforms.uRimColor, cr[0], cr[1], cr[2])

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
    }, [timeline])

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
            <div ref={fpsRef} className="fps-counter" />

            {!showTimeline && (
                <button
                    className="timeline-toggle-show"
                    onClick={() => setShowTimeline(true)}
                >
                    <span>Show Timeline</span>
                </button>
            )}

            {showTimeline && (
                <div className="timeline-container">
                    <div style={{ padding: '8px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid #333', background: '#222' }}>
                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            style={{ padding: '6px 16px', cursor: 'pointer', background: isPlaying ? '#ff4444' : '#44ff44', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
                        >
                            {isPlaying ? 'Pause' : 'Play'}
                        </button>
                        <span style={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace', minWidth: '80px' }}>
                            {(currentTime / 1000).toFixed(2)}s
                        </span>
                        <button
                            onClick={() => { if (timeline) { timeline.setTime(0); timelineTimeRef.current = 0; setCurrentTime(0); } }}
                            style={{ padding: '6px 12px', cursor: 'pointer', background: '#444', color: '#fff', border: 'none', borderRadius: '4px' }}
                        >
                            Reset
                        </button>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '15px', paddingRight: '10px' }}>
                            {(modelRef.current.rows as PropertyRow[]).map(row => (
                                <div key={row.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <span style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase' }}>{row.name}</span>
                                    <span style={{ color: '#00ff00', fontSize: '12px', fontFamily: 'monospace' }}>
                                        {Number(safeInterpolate(row.name, currentTime, 0)).toFixed(2)}
                                    </span>
                                </div>
                            ))}
                            <button
                                className="timeline-hide-btn"
                                onClick={() => setShowTimeline(false)}
                                style={{ marginLeft: '10px' }}
                            >
                                Hide
                            </button>
                        </div>
                    </div>
                    <div className="timeline-body">
                        <div className="timeline-sidebar">
                            <div className="timeline-sidebar-header"></div>
                            <div ref={sidebarRowsRef} className="timeline-sidebar-content" onWheel={handleSidebarWheel}>
                                {(modelRef.current.rows as PropertyRow[]).map(row => {
                                    const labels: Record<string, string> = {
                                        boxX: 'Width (X)',
                                        boxY: 'Height (Y)',
                                        boxZ: 'Depth (Z)',
                                        rotX: 'Rotate X',
                                        rotY: 'Rotate Y',
                                        rotZ: 'Rotate Z'
                                    };
                                    return (
                                        <div key={row.name} className="timeline-sidebar-row">
                                            {labels[row.name] || row.name}
                                        </div>
                                    );
                                })}
                                {/* Extra space if needed for scrolling bottom */}
                                <div style={{ height: '100px', flexShrink: 0 }}></div>
                            </div>
                        </div>
                        <div ref={timelineElRef} className="timeline-el" />
                    </div>
                </div>
            )}
        </div>
    )
}
