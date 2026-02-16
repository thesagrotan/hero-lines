import { useEffect, useRef, useState } from 'react'
import { useControls, folder } from 'leva'
import { Timeline } from '@xzdarcy/react-timeline-editor'
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css'

interface TimelineAction {
    id: string;
    start: number;
    end: number;
    effectId: string;
    data?: any;
}

interface TimelineRow {
    id: string;
    actions: TimelineAction[];
}

interface PropertyAction extends TimelineAction {
    data: {
        value: number | string;
    }
}

interface PropertyRow extends TimelineRow {
    actions: PropertyAction[];
}

const vsSource = `#version 300 es
in vec4 position;
void main() { gl_Position = position; }
`

const fsSource = `#version 300 es
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
uniform int u_shapeType; 
uniform int u_orientation;

float sdEllipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

float sdCone(vec3 p, vec3 h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;
    float q = length(p_o.yz / h_o.yz);
    float taper = 1.0 - clamp(p_o.x / h_o.x, -1.0, 1.0);
    return max(q - taper, abs(p_o.x) - h_o.x);
}

float sdTorus(vec3 p, vec3 h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;
    vec2 q = vec2(length(p_o.yz / h_o.yz) - 1.0, p_o.x / h_o.x);
    return (length(q) - 0.2) * min(h_o.x, min(h_o.y, h_o.z));
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdCylinder(vec3 p, vec3 h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;
    vec2 d = abs(vec2(length(p_o.yz / h_o.yz), p_o.x / h_o.x)) - 1.0;
    return (min(max(d.x, d.y), 0.0) + length(max(d, 0.0))) * min(h_o.x, min(h_o.y, h_o.z));
}

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float map(vec3 p, vec3 boxSize, float radius) {
    float d = 0.0;
    if (u_shapeType == 1) d = sdEllipsoid(p, boxSize);
    else if (u_shapeType == 2) d = sdCone(p, boxSize, u_orientation);
    else if (u_shapeType == 3) d = sdTorus(p, boxSize, u_orientation);
    else if (u_shapeType == 4) {
        vec3 a = (u_orientation == 1) ? vec3(0, -boxSize.y, 0) : (u_orientation == 2) ? vec3(0, 0, -boxSize.z) : vec3(-boxSize.x, 0, 0);
        vec3 b = (u_orientation == 1) ? vec3(0, boxSize.y, 0) : (u_orientation == 2) ? vec3(0, 0, boxSize.z) : vec3(boxSize.x, 0, 0);
        float r_cap = (u_orientation == 1 || u_orientation == 2) ? boxSize.x : boxSize.y;
        d = sdCapsule(p, a, b, r_cap * 0.5);
    } else if (u_shapeType == 5) d = sdCylinder(p, boxSize, u_orientation);
    else {
        vec3 innerSize = max(boxSize - vec3(radius), vec3(0.001));
        return sdRoundBox(p, innerSize, radius);
    }
    return d - radius;
}

vec3 calcNormal(vec3 p, vec3 boxSize, float radius) {
    const float h = 0.0001;
    const vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * map(p + k.xyy * h, boxSize, radius) + k.yyx * map(p + k.yyx * h, boxSize, radius) + k.yxy * map(p + k.yxy * h, boxSize, radius) + k.xxx * map(p + k.xxx * h, boxSize, radius));
}

mat3 rotX(float a) { float s=sin(a), c=cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a) { float s=sin(a), c=cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }
mat3 rotZ(float a) { float s=sin(a), c=cos(a); return mat3(c,-s,0, s,c,0, 0,0,1); }

vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * boxSize;
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);
}

vec3 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack) {
    float sliceCoord = (u_orientation == 1) ? p.y : (u_orientation == 2) ? p.z : (u_orientation == 3) ? (p.x + p.y + p.z) * 0.57735 : p.x;
    float sliceRange = (u_orientation == 1) ? 2.0 * boxSize.y : (u_orientation == 2) ? 2.0 * boxSize.z : (u_orientation == 3) ? length(2.0 * boxSize) : 2.0 * boxSize.x;
    float norm = clamp((sliceCoord + sliceRange * 0.5) / sliceRange, 0.0, 1.0);
    float layerIdx = floor(norm * u_numLines), layerGap = sliceRange / (u_numLines + 0.001);
    float layerCenter = (layerIdx + 0.5) * layerGap - sliceRange * 0.5;
    float ds = fwidth(sliceCoord), actualThick = min(thickness, layerGap * 0.48);
    float lineMask = 1.0 - smoothstep(actualThick - ds, actualThick + ds, abs(sliceCoord - layerCenter));
    vec3 pUse = clamp(p, -boxSize, boxSize);
    float p1 = pUse.y, p2 = pUse.z, b1 = boxSize.y, b2 = boxSize.z;
    if (u_orientation == 1) { p1 = pUse.x; p2 = pUse.z; b1 = boxSize.x; b2 = boxSize.z; }
    else if (u_orientation == 2) { p1 = pUse.x; p2 = pUse.y; b1 = boxSize.x; b2 = boxSize.y; }
    float perimeter = (abs(p2 * b1) > abs(p1 * b2)) ? ((p2 > 0.0) ? (b1 + p1) : (3.0 * b1 + 2.0 * b2 - p1)) : ((p1 > 0.0) ? (2.0 * b1 + b2 - p2) : (4.0 * b1 + 3.0 * b2 + p2));
    float progress = mod(time * u_speed - layerIdx * 0.02, 3.0), dist = fract(progress - (perimeter / (4.0 * (b1 + b2) + 0.001)));
    float isActive = (dist < u_trailLength) ? pow(smoothstep(0.0, max(0.01, u_ease), 1.0 - abs(1.0 - (dist / u_trailLength) * 2.0)), 1.5) : 0.0;
    vec3 n = calcNormal(p, boxSize, u_borderRadius);
    float dotV = (u_orientation == 1) ? abs(n.y) : (u_orientation == 2) ? abs(n.z) : (u_orientation == 3) ? abs(dot(n, vec3(0.577))) : abs(n.x);
    float alpha = lineMask * isActive * smoothstep(0.1, 0.4, 1.0 - dotV);
    vec3 wire = (u_shapeType == 0) ? u_color1 * 0.1 * max(max((1.0 - smoothstep(thickness * 2.5 - fwidth(p.x), thickness * 2.5 + fwidth(p.x), abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - fwidth(p.y), thickness * 2.5 + fwidth(p.y), abs(abs(p.y) - boxSize.y))), (1.0 - smoothstep(thickness * 2.5 - fwidth(p.y), thickness * 2.5 + fwidth(p.y), abs(abs(p.y) - boxSize.y))) * (1.0 - smoothstep(thickness * 2.5 - fwidth(p.z), thickness * 2.5 + fwidth(p.z), abs(abs(p.z) - boxSize.z)))), (1.0 - smoothstep(thickness * 2.5 - fwidth(p.x), thickness * 2.5 + fwidth(p.x), abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - fwidth(p.z), thickness * 2.5 + fwidth(p.z), abs(abs(p.z) - boxSize.z)))) : vec3(0);
    return (mix(u_color1, u_color2, isActive) * alpha + wire) * (isBack ? 1.0 : 2.5);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    mat3 mI = transpose(rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x));
    vec3 ro_l = mI * u_camPos, fwd = normalize(mI * -u_camPos), right = normalize(cross(vec3(0, 1, 0), fwd)), up = cross(fwd, right), rd = normalize(fwd + uv.x * right + uv.y * up);
    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    vec3 col = vec3(0);
    if (tBox.x > 0.0) {
        float t = tBox.x; bool hit = false; vec3 p;
        for(int i=0; i<64; i++) { p = ro_l + rd * t; float d = map(p, u_boxSize, u_borderRadius); if(d < 0.001) { hit = true; break; } t += d; if(t > tBox.y) break; }
        if(hit) { col += getSurfaceColor(p, u_boxSize, u_time, u_borderThickness, false) + u_rimColor * pow(1.0 - max(dot(-rd, calcNormal(p, u_boxSize, u_borderRadius)), 0.0), 3.0) * 0.4; }
        vec3 ro_b = ro_l + rd * tBox.y, rd_b = -rd; float tb = 0.0; hit = false;
        for(int i=0; i<64; i++) { p = ro_b + rd_b * tb; float d = map(p, u_boxSize, u_borderRadius); if(d < 0.001) { hit = true; break; } tb += d; if(tb > (tBox.y - tBox.x)) break; }
        if(hit) col += getSurfaceColor(p, u_boxSize, u_time, u_borderThickness, true) * 0.5;
    }
    fragColor = vec4(col + (fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02, 1.0);
}
`

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(shader)); return null; }
    return shader
}

const DEVICE_TEMPLATES: Record<string, any> = {
    Smartwatch: { dimensions: { x: 0.8, y: 1.0, z: 0.3 }, borderRadius: 0.35, shapeType: 'Box', camera: { x: 3.0, y: 2.5, z: 5.0 }, zoom: 0.7 },
    Mobile: { dimensions: { x: 1.0, y: 2.0, z: 0.2 }, borderRadius: 0.15, shapeType: 'Box', camera: { x: 4.0, y: 3.5, z: 6.5 }, zoom: 0.85 },
    Tablet: { dimensions: { x: 2.0, y: 2.8, z: 0.15 }, borderRadius: 0.12, shapeType: 'Box', camera: { x: 5.0, y: 4.5, z: 8.0 }, zoom: 1.0 },
    Laptop: { dimensions: { x: 3.5, y: 2.2, z: 0.12 }, borderRadius: 0.08, shapeType: 'Box', camera: { x: 6.0, y: 5.0, z: 10.0 }, zoom: 1.1 },
}

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null), fpsRef = useRef<HTMLDivElement>(null), sidebarRowsRef = useRef<HTMLDivElement>(null), timelineRef = useRef<any>(null), fileInputRef = useRef<HTMLInputElement>(null)
    const transitionRef = useRef<{ startTime: number; duration: number; fromRotY: number; extraSpin: number; easeType: string; fromDims: { x: number; y: number; z: number }; fromBR: number; fromCam: { x: number; y: number; z: number }; fromZoom: number; active: boolean }>({ startTime: 0, duration: 600, fromRotY: 0, extraSpin: 360, easeType: 'Ease In-Out', fromDims: { x: 0, y: 0, z: 0 }, fromBR: 0, fromCam: { x: 0, y: 0, z: 0 }, fromZoom: 1, active: false })
    const [showTimeline, setShowTimeline] = useState(true), [isPlaying, setIsPlaying] = useState(false), [currentTime, setCurrentTime] = useState(0), [cycling, setCycling] = useState(false)
    const [timelineData, setTimelineData] = useState<TimelineRow[]>([
        { id: 'camX', actions: [{ id: 'cx1', start: 0, end: 0.1, effectId: 'value', data: { value: 5.0 } }] },
        { id: 'camY', actions: [{ id: 'cy1', start: 0, end: 0.1, effectId: 'value', data: { value: 4.5 } }] },
        { id: 'camZ', actions: [{ id: 'cz1', start: 0, end: 0.1, effectId: 'value', data: { value: 8.0 } }] },
        { id: 'zoom', actions: [{ id: 'z1', start: 0, end: 0.1, effectId: 'value', data: { value: 1.0 } }] },
        { id: 'boxX', actions: [{ id: 'bx1', start: 0, end: 0.1, effectId: 'value', data: { value: 2.5 } }, { id: 'bx2', start: 2, end: 2.1, effectId: 'value', data: { value: 4.0 } }, { id: 'bx3', start: 4, end: 4.1, effectId: 'value', data: { value: 2.5 } }] },
        { id: 'boxY', actions: [{ id: 'by1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.8 } }, { id: 'by2', start: 2, end: 2.1, effectId: 'value', data: { value: 1.5 } }, { id: 'by3', start: 4, end: 4.1, effectId: 'value', data: { value: 0.8 } }] },
        { id: 'boxZ', actions: [{ id: 'bz1', start: 0, end: 0.1, effectId: 'value', data: { value: 1.2 } }, { id: 'bz2', start: 3, end: 3.1, effectId: 'value', data: { value: 0.4 } }, { id: 'bz3', start: 5, end: 5.1, effectId: 'value', data: { value: 1.2 } }] },
        { id: 'rotX', actions: [{ id: 'rx1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'rx2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
        { id: 'rotY', actions: [{ id: 'ry1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'ry2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
        { id: 'rotZ', actions: [{ id: 'rz1', start: 0, end: 0.1, effectId: 'value', data: { value: 0 } }, { id: 'rz2', start: 5, end: 5.1, effectId: 'value', data: { value: 360 } }] },
        { id: 'shapeType', actions: [{ id: 'st1', start: 0, end: 0.1, effectId: 'value', data: { value: 'Box' } }] },
        { id: 'borderRadius', actions: [{ id: 'br1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.1 } }] },
        { id: 'numLines', actions: [{ id: 'nl1', start: 0, end: 0.1, effectId: 'value', data: { value: 30 } }] },
        { id: 'thickness', actions: [{ id: 'th1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.01 } }] },
        { id: 'orientation', actions: [{ id: 'or1', start: 0, end: 0.1, effectId: 'value', data: { value: 'Horizontal' } }] },
        { id: 'speed', actions: [{ id: 'sp1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.8 } }] },
        { id: 'longevity', actions: [{ id: 'lg1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.4 } }] },
        { id: 'ease', actions: [{ id: 'ea1', start: 0, end: 0.1, effectId: 'value', data: { value: 0.5 } }] },
        { id: 'color1', actions: [{ id: 'c1-1', start: 0, end: 0.1, effectId: 'value', data: { value: '#0d66ff' } }] },
        { id: 'color2', actions: [{ id: 'c2-1', start: 0, end: 0.1, effectId: 'value', data: { value: '#4cccff' } }] },
        { id: 'rimColor', actions: [{ id: 'rc1', start: 0, end: 0.1, effectId: 'value', data: { value: '#1a66cc' } }] },
    ] as PropertyRow[])

    const [controls, set] = useControls(() => ({
        Transformations: folder({
            camera: { value: { x: 5.0, y: 4.5, z: 8.0 }, step: 0.1 },
            zoom: { value: 1.0, min: 0.1, max: 2.0, step: 0.05 },
            dimensions: { value: { x: 2.5, y: 0.8, z: 1.2 }, step: 0.05 },
            rotation: { value: { x: 0, y: 0, z: 0 }, step: 1 },
        }),
        'Lines & Animation': folder({
            shapeType: { value: 'Box', options: ['Box', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Cylinder'] },
            borderRadius: { value: 0.1, min: 0, max: 1, step: 0.01 },
            numLines: { value: 30, min: 1, max: 100, step: 1 },
            thickness: { value: 0.01, min: 0.001, max: 0.1, step: 0.001 },
            orientation: { value: 'Horizontal', options: ['Horizontal', 'Vertical', 'Depth', 'Diagonal'] },
            speed: { value: 0.8, min: 0, max: 5, step: 0.1 },
            longevity: { value: 0.4, min: 0.05, max: 2, step: 0.05 },
            ease: { value: 0.5, min: 0, max: 1, step: 0.1 },
        }),
        Appearance: folder({ color1: '#0d66ff', color2: '#4cccff', rimColor: '#1a66cc' }),
        Transition: folder({
            transitionSpeed: { value: 600, min: 100, max: 2000, step: 50, label: 'Duration (ms)' },
            transitionEase: { value: 'Ease In-Out', options: ['Ease In-Out', 'Ease In', 'Ease Out', 'Linear'], label: 'Easing' },
        }),
    }))

    const showTimelineRef = useRef(showTimeline), timelineDataRef = useRef(timelineData), isPlayingRef = useRef(isPlaying), timelineTimeRef = useRef(0), controlsRef = useRef(controls)
    useEffect(() => { showTimelineRef.current = showTimeline }, [showTimeline])
    useEffect(() => { timelineDataRef.current = timelineData }, [timelineData])
    useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
    useEffect(() => { controlsRef.current = controls }, [controls])

    const safeInterpolate = (rowId: string, time: number, defaultValue: any) => {
        const row = timelineDataRef.current.find(r => r.id === rowId); if (!row || !row.actions.length) return defaultValue
        const actions = [...row.actions].sort((a, b) => a.start - b.start)
        if (time <= actions[0].start) return actions[0].data.value
        if (time >= actions[actions.length - 1].start) return actions[actions.length - 1].data.value
        for (let i = 0; i < actions.length - 1; i++) {
            const a1 = actions[i], a2 = actions[i + 1]
            if (time >= a1.start && time <= a2.start) {
                const t = (time - a1.start) / (a2.start - a1.start), v1 = a1.data.value, v2 = a2.data.value
                if (typeof v1 === 'number' && typeof v2 === 'number') return v1 + (v2 - v1) * t
                if (typeof v1 === 'string' && v1.startsWith('#') && typeof v2 === 'string' && v2.startsWith('#')) {
                    const h2r = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
                    const r1 = h2r(v1), r2 = h2r(v2), res = r1.map((c, idx) => Math.round(c + (r2[idx] - c) * t))
                    return `#${res.map(c => c.toString(16).padStart(2, '0')).join('')}`
                }
                return v1
            }
        }
        return defaultValue
    }

    const handleDoubleClickAction = (_e: any, { action, row }: any) => {
        const v = prompt('Value:', String(action.data.value)); if (v !== null) setTimelineData(prev => prev.map(r => r.id === row.id ? { ...r, actions: r.actions.map(a => a.id === action.id ? { ...a, data: { value: isNaN(Number(v)) ? v : Number(v) } } : a) } : r))
    }
    const handleContextMenuAction = (_e: any, { action, row }: any) => {
        if (confirm('Delete?')) setTimelineData(prev => prev.map(r => r.id === row.id ? { ...r, actions: r.actions.filter(a => a.id !== action.id) } : r))
    }
    const handleCaptureKeyframe = () => {
        const c = controlsRef.current, t = currentTime, map: any = { camX: c.camera.x, camY: c.camera.y, camZ: c.camera.z, zoom: c.zoom, boxX: c.dimensions.x, boxY: c.dimensions.y, boxZ: c.dimensions.z, rotX: c.rotation.x, rotY: c.rotation.y, rotZ: c.rotation.z, shapeType: c.shapeType, borderRadius: c.borderRadius, numLines: c.numLines, thickness: c.thickness, orientation: c.orientation, speed: c.speed, longevity: c.longevity, ease: c.ease, color1: c.color1, color2: c.color2, rimColor: c.rimColor }
        setTimelineData(prev => prev.map(row => {
            const val = map[row.id]; if (val === undefined) return row
            const idx = row.actions.findIndex(a => Math.abs(a.start - t) < 0.1)
            let acts = [...row.actions]; if (idx >= 0) acts[idx] = { ...acts[idx], data: { value: val } }; else acts.push({ id: `${row.id}-${Date.now()}`, start: t, end: t + 0.1, effectId: 'value', data: { value: val } })
            return { ...row, actions: acts }
        }))
    }
    const handlePlayPause = () => { if (isPlaying) { timelineRef.current?.pause(); setIsPlaying(false) } else { timelineRef.current?.play({ autoEnd: true }); setIsPlaying(true) } }
    const applyTemplate = (name: string) => {
        const t = DEVICE_TEMPLATES[name]; if (!t) return
        const c = controlsRef.current
        transitionRef.current = { startTime: performance.now(), duration: c.transitionSpeed, fromRotY: c.rotation.y, extraSpin: 360, easeType: c.transitionEase, fromDims: { ...c.dimensions }, fromBR: c.borderRadius, fromCam: { ...c.camera }, fromZoom: c.zoom, active: true }
        set(t)
    }
    const handleCycleAll = () => {
        const names = Object.keys(DEVICE_TEMPLATES)
        const duration = controlsRef.current.transitionSpeed
        const pause = 400
        setCycling(true)
        names.forEach((name, i) => {
            setTimeout(() => {
                applyTemplate(name)
                if (i === names.length - 1) setTimeout(() => setCycling(false), duration + pause)
            }, i * (duration + pause))
        })
    }

    const handleExport = () => {
        const data = {
            settings: controlsRef.current,
            timeline: timelineDataRef.current
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `hero-lines-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return
        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string)
                if (!data.settings || !data.timeline) throw new Error('Invalid format')
                if (confirm('Import settings and animation? This will overwrite current data.')) {
                    set(data.settings)
                    setTimelineData(data.timeline)
                    if (timelineRef.current) timelineRef.current.setTime(0)
                    setCurrentTime(0)
                }
            } catch (err) {
                alert('Error importing file: ' + (err as Error).message)
            }
        }
        reader.readAsText(file)
        e.target.value = ''
    }

    useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return
        const gl = canvas.getContext('webgl2')!; const program = gl.createProgram()!
        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource)!, fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource)!
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.useProgram(program);
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
        const loc = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
        const u = { uTime: gl.getUniformLocation(program, 'u_time'), uRes: gl.getUniformLocation(program, 'u_resolution'), uCamPos: gl.getUniformLocation(program, 'u_camPos'), uBoxSize: gl.getUniformLocation(program, 'u_boxSize'), uRot: gl.getUniformLocation(program, 'u_rot'), uBorderRadius: gl.getUniformLocation(program, 'u_borderRadius'), uBorderThickness: gl.getUniformLocation(program, 'u_borderThickness'), uSpeed: gl.getUniformLocation(program, 'u_speed'), uTrailLength: gl.getUniformLocation(program, 'u_trailLength'), uEase: gl.getUniformLocation(program, 'u_ease'), uColor1: gl.getUniformLocation(program, 'u_color1'), uColor2: gl.getUniformLocation(program, 'u_color2'), uRimColor: gl.getUniformLocation(program, 'u_rimColor'), uNumLines: gl.getUniformLocation(program, 'u_numLines'), uShapeType: gl.getUniformLocation(program, 'u_shapeType'), uOrientation: gl.getUniformLocation(program, 'u_orientation') }
        let id: number, last = 0
        const render = (now: number) => {
            if (timelineRef.current) { const t = timelineRef.current.getTime(); timelineTimeRef.current = t; setCurrentTime(t) }
            const c = controlsRef.current, active = showTimelineRef.current, p = isPlayingRef.current
            let bX = (active && p) ? safeInterpolate('boxX', timelineTimeRef.current, c.dimensions.x) : c.dimensions.x
            let bY = (active && p) ? safeInterpolate('boxY', timelineTimeRef.current, c.dimensions.y) : c.dimensions.y
            let bZ = (active && p) ? safeInterpolate('boxZ', timelineTimeRef.current, c.dimensions.z) : c.dimensions.z
            const rX = (active && p) ? safeInterpolate('rotX', timelineTimeRef.current, c.rotation.x) : c.rotation.x
            let rY = (active && p) ? safeInterpolate('rotY', timelineTimeRef.current, c.rotation.y) : c.rotation.y
            const tr_ = transitionRef.current
            if (tr_.active) {
                const elapsed = now - tr_.startTime, progress = Math.min(elapsed / tr_.duration, 1)
                let ease = progress
                if (tr_.easeType === 'Ease In-Out') ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2
                else if (tr_.easeType === 'Ease In') ease = progress * progress * progress
                else if (tr_.easeType === 'Ease Out') ease = 1 - Math.pow(1 - progress, 3)
                rY += tr_.extraSpin * ease
                bX = tr_.fromDims.x + (bX - tr_.fromDims.x) * ease
                bY = tr_.fromDims.y + (bY - tr_.fromDims.y) * ease
                bZ = tr_.fromDims.z + (bZ - tr_.fromDims.z) * ease
                if (progress >= 1) tr_.active = false
            }
            const rZ = (active && p) ? safeInterpolate('rotZ', timelineTimeRef.current, c.rotation.z) : c.rotation.z
            const cX = (active && p) ? safeInterpolate('camX', timelineTimeRef.current, c.camera.x) : c.camera.x
            const cY = (active && p) ? safeInterpolate('camY', timelineTimeRef.current, c.camera.y) : c.camera.y
            const cZ = (active && p) ? safeInterpolate('camZ', timelineTimeRef.current, c.camera.z) : c.camera.z
            const zm = (active && p) ? safeInterpolate('zoom', timelineTimeRef.current, c.zoom) : c.zoom
            const st = (active && p) ? safeInterpolate('shapeType', timelineTimeRef.current, c.shapeType) : c.shapeType
            const br = (active && p) ? safeInterpolate('borderRadius', timelineTimeRef.current, c.borderRadius) : c.borderRadius
            const nl = (active && p) ? safeInterpolate('numLines', timelineTimeRef.current, c.numLines) : c.numLines
            const th = (active && p) ? safeInterpolate('thickness', timelineTimeRef.current, c.thickness) : c.thickness
            const or = (active && p) ? safeInterpolate('orientation', timelineTimeRef.current, c.orientation) : c.orientation
            const sp = (active && p) ? safeInterpolate('speed', timelineTimeRef.current, c.speed) : c.speed
            const lg = (active && p) ? safeInterpolate('longevity', timelineTimeRef.current, c.longevity) : c.longevity
            const es = (active && p) ? safeInterpolate('ease', timelineTimeRef.current, c.ease) : c.ease
            const cl1 = (active && p) ? safeInterpolate('color1', timelineTimeRef.current, c.color1) : c.color1
            const cl2 = (active && p) ? safeInterpolate('color2', timelineTimeRef.current, c.color2) : c.color2
            const rc = (active && p) ? safeInterpolate('rimColor', timelineTimeRef.current, c.rimColor) : c.rimColor
            gl.uniform1f(u.uTime, now * 0.001); gl.uniform2f(u.uRes, canvas.width, canvas.height);
            const iz = 1.0 / zm; gl.uniform3f(u.uCamPos, cX * iz, cY * iz, cZ * iz); gl.uniform3f(u.uBoxSize, bX, bY, bZ);
            const tr = Math.PI / 180; gl.uniform3f(u.uRot, rX * tr, rY * tr, rZ * tr); gl.uniform1f(u.uBorderRadius, br); gl.uniform1f(u.uBorderThickness, th); gl.uniform1f(u.uSpeed, sp); gl.uniform1f(u.uTrailLength, lg); gl.uniform1f(u.uEase, es); gl.uniform1f(u.uNumLines, nl)
            const sm = { Box: 0, Sphere: 1, Cone: 2, Torus: 3, Capsule: 4, Cylinder: 5 } as any; gl.uniform1i(u.uShapeType, sm[st] ?? 0)
            const om = { Horizontal: 0, Vertical: 1, Depth: 2, Diagonal: 3 } as any; gl.uniform1i(u.uOrientation, om[or] ?? 0)
            const h2r = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; return [r, g, b] }
            const v1 = h2r(cl1), v2 = h2r(cl2), vr = h2r(rc); gl.uniform3f(u.uColor1, v1[0], v1[1], v1[2]); gl.uniform3f(u.uColor2, v2[0], v2[1], v2[2]); gl.uniform3f(u.uRimColor, vr[0], vr[1], vr[2])
            gl.drawArrays(gl.TRIANGLES, 0, 6); id = requestAnimationFrame(render)
        }
        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; gl.viewport(0, 0, canvas.width, canvas.height) }
        const wheel = (e: WheelEvent) => set({ zoom: Math.max(0.1, Math.min(2.0, controlsRef.current.zoom - e.deltaY * 0.001)) })
        window.addEventListener('resize', resize); canvas.addEventListener('wheel', wheel, { passive: false }); resize(); id = requestAnimationFrame(render)
        return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('wheel', wheel); cancelAnimationFrame(id); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs) }
    }, [set])

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
            {!showTimeline && <button className="timeline-toggle-show" onClick={() => setShowTimeline(true)}><span>Show Timeline</span></button>}
            <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <button onClick={() => set({ zoom: Math.min(2.0, controlsRef.current.zoom + 0.1) })} style={{ width: '30px', height: '30px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}>+</button>
                <button onClick={() => set({ zoom: Math.max(0.1, controlsRef.current.zoom - 0.1) })} style={{ width: '30px', height: '30px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}>-</button>
            </div>
            <div className="template-bar">
                {Object.keys(DEVICE_TEMPLATES).map(name => (
                    <button key={name} className="template-btn" onClick={() => applyTemplate(name)} disabled={cycling}>
                        <span className="template-icon">{name === 'Smartwatch' ? '⌚' : name === 'Mobile' ? '📱' : name === 'Tablet' ? '📲' : '💻'}</span>
                        <span className="template-label">{name}</span>
                    </button>
                ))}
                <button className="template-btn" onClick={handleCycleAll} disabled={cycling} style={{ borderLeft: '1px solid #555' }}>
                    <span className="template-icon">{cycling ? '⏳' : '🔄'}</span>
                    <span className="template-label">{cycling ? 'Playing...' : 'Demo All'}</span>
                </button>
            </div>
            {showTimeline && (
                <div className="timeline-container" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '300px', background: '#111', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid #333', background: '#222' }}>
                        <button onClick={handlePlayPause} style={{ padding: '6px 16px', cursor: 'pointer', background: isPlaying ? '#ff4444' : '#44ff44', borderRadius: '4px', fontWeight: 'bold' }}>{isPlaying ? 'Pause' : 'Play'}</button>
                        <span style={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace', minWidth: '80px' }}>{currentTime.toFixed(2)}s</span>
                        <button onClick={handleCaptureKeyframe} style={{ padding: '6px 12px', background: '#0d66ff', color: '#fff', borderRadius: '4px', fontWeight: 'bold' }}>Capture</button>
                        <button onClick={() => { timelineRef.current?.setTime(0); setCurrentTime(0); }} style={{ padding: '6px 12px', background: '#444', color: '#fff', borderRadius: '4px' }}>Reset</button>
                        <button onClick={handleExport} style={{ padding: '6px 12px', background: '#ec4899', color: '#fff', borderRadius: '4px' }}>Export</button>
                        <button onClick={() => fileInputRef.current?.click()} style={{ padding: '6px 12px', background: '#8b5cf6', color: '#fff', borderRadius: '4px' }}>Import</button>
                        <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" style={{ display: 'none' }} />
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '15px', paddingRight: '10px' }}>
                            {timelineData.map(row => (
                                <div key={row.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <span style={{ color: '#888', fontSize: '10px' }}>{row.id}</span>
                                    <span style={{ color: '#00ff00', fontSize: '12px', fontFamily: 'monospace' }}>{(() => { const v = safeInterpolate(row.id, currentTime, 0); return typeof v === 'number' ? v.toFixed(2) : String(v) })()}</span>
                                </div>
                            ))}
                            <button onClick={() => setShowTimeline(false)} style={{ background: 'transparent', color: '#888', border: '1px solid #444', borderRadius: '4px', padding: '2px 8px' }}>Hide</button>
                        </div>
                    </div>
                    <div className="timeline-body" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: '150px', background: '#1a1a1a', borderRight: '1px solid #333', overflowY: 'hidden' }}>
                            <div style={{ height: '32px', borderBottom: '1px solid #333' }} />
                            <div ref={sidebarRowsRef} style={{ flex: 1, overflowY: 'hidden' }}>
                                {timelineData.map((row, idx) => <div key={row.id} style={{ height: '32px', display: 'flex', alignItems: 'center', padding: '0 10px', color: '#ccc', fontSize: '11px', borderBottom: '1px solid #222', background: idx % 2 === 0 ? '#1a1a1a' : '#222' }}>{row.id}</div>)}
                            </div>
                        </div>
                        <div style={{ flex: 1, position: 'relative', background: '#000' }}>
                            <Timeline ref={timelineRef} editorData={timelineData} effects={{ value: { id: 'value', name: 'Value' } }} onChange={setTimelineData as any} onDoubleClickAction={handleDoubleClickAction} onContextMenuAction={handleContextMenuAction} rowHeight={32} onScroll={({ scrollTop }) => { if (sidebarRowsRef.current) sidebarRowsRef.current.scrollTop = scrollTop }} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
