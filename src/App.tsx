import { useEffect, useRef, useState } from 'react'
import { useControls, folder } from 'leva'
import { Timeline, TimelineRow, TimelineAction } from '@xzdarcy/react-timeline-editor'
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css'

// Custom interface for actions with values
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
    const sidebarRowsRef = useRef<HTMLDivElement>(null)
    const [showTimeline, setShowTimeline] = useState(true)
    const showTimelineRef = useRef(true)
    useEffect(() => { showTimelineRef.current = showTimeline }, [showTimeline])

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

    const timelineDataRef = useRef(timelineData)
    useEffect(() => { timelineDataRef.current = timelineData }, [timelineData])

    const [zoom, setZoom] = useState(1.0)
    const zoomRef = useRef(1.0)
    useEffect(() => { zoomRef.current = zoom }, [zoom])

    // Leva controls
    const [controls, set] = useControls(() => ({
        Transformations: folder({
            camera: { value: { x: 5.0, y: 4.5, z: 8.0 }, label: 'Camera', step: 0.1 },
            zoom: { value: 1.0, min: 0.1, max: 2.0, step: 0.05, label: 'Zoom' },
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
    }))

    const [isPlaying, setIsPlaying] = useState(false)
    const isPlayingRef = useRef(false)
    useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

    const [currentTime, setCurrentTime] = useState(0)
    const timelineTimeRef = useRef(0)

    // Interpolation logic for actions
    const safeInterpolate = (rowId: string, time: number, defaultValue: any) => {
        const row = (timelineDataRef.current as PropertyRow[]).find(r => r.id === rowId)
        if (!row || !row.actions || row.actions.length === 0) return defaultValue

        const actions = [...row.actions].sort((a, b) => a.start - b.start)

        if (time <= actions[0].start) return actions[0].data.value
        if (time >= actions[actions.length - 1].start) return actions[actions.length - 1].data.value

        for (let i = 0; i < actions.length - 1; i++) {
            const a1 = actions[i]
            const a2 = actions[i + 1]
            if (time >= a1.start && time <= a2.start) {
                const t = (time - a1.start) / (a2.start - a1.start)
                const v1 = a1.data.value
                const v2 = a2.data.value

                // Handle numbers
                if (typeof v1 === 'number' && typeof v2 === 'number') {
                    return v1 + (v2 - v1) * (t || 0)
                }

                // Handle colors (simple hex support)
                if (typeof v1 === 'string' && v1.startsWith('#') && typeof v2 === 'string' && v2.startsWith('#')) {
                    const hexToRgb = (hex: string) => {
                        const h = hex.replace('#', '')
                        return [
                            parseInt(h.substring(0, 2), 16),
                            parseInt(h.substring(2, 4), 16),
                            parseInt(h.substring(4, 6), 16)
                        ]
                    }
                    const rgb1 = hexToRgb(v1)
                    const rgb2 = hexToRgb(v2)
                    const res = rgb1.map((c, idx) => Math.round(c + (rgb2[idx] - c) * t))
                    return `#${res.map(c => c.toString(16).padStart(2, '0')).join('')}`
                }

                // Discrete or unknown (Step)
                return v1
            }
        }
        return defaultValue
    }

    const controlsRef = useRef(controls)
    useEffect(() => { controlsRef.current = controls }, [controls])

    const timelineRef = useRef<any>(null)

    const handleDoubleClickAction = (action: TimelineAction, row: TimelineRow) => {
        const newValue = prompt('Enter new value:', String(action.data.value));
        if (newValue !== null) {
            const val = isNaN(Number(newValue)) ? newValue : Number(newValue);
            setTimelineData(prev => prev.map(r => {
                if (r.id === row.id) {
                    return {
                        ...r,
                        actions: r.actions.map(a => a.id === action.id ? { ...a, data: { ...a.data, value: val } } : a)
                    }
                }
                return r;
            }));
        }
    }

    const handleContextMenuAction = (action: TimelineAction, row: TimelineRow) => {
        if (confirm('Delete this keyframe?')) {
            setTimelineData(prev => prev.map(r => {
                if (r.id === row.id) {
                    return {
                        ...r,
                        actions: r.actions.filter(a => a.id !== action.id)
                    }
                }
                return r;
            }));
        }
    }

    const handleCaptureKeyframe = () => {
        const c = controlsRef.current;
        const time = currentTime;
        const newActionsMap: Record<string, any> = {
            camX: c.camera.x,
            camY: c.camera.y,
            camZ: c.camera.z,
            zoom: c.zoom,
            boxX: c.dimensions.x,
            boxY: c.dimensions.y,
            boxZ: c.dimensions.z,
            rotX: c.rotation.x,
            rotY: c.rotation.y,
            rotZ: c.rotation.z,
            shapeType: c.shapeType,
            borderRadius: c.borderRadius,
            numLines: c.numLines,
            thickness: c.thickness,
            orientation: c.orientation,
            speed: c.speed,
            longevity: c.longevity,
            ease: c.ease,
            color1: c.color1,
            color2: c.color2,
            rimColor: c.rimColor,
        };

        setTimelineData(prev => prev.map(row => {
            const value = newActionsMap[row.id];
            if (value === undefined) return row;

            const existingActionIndex = row.actions.findIndex(a => Math.abs(a.start - time) < 0.1);

            let newActions = [...row.actions];
            if (existingActionIndex >= 0) {
                newActions[existingActionIndex] = {
                    ...newActions[existingActionIndex],
                    data: { value }
                };
            } else {
                newActions.push({
                    id: `${row.id}-${Date.now()}`,
                    start: time,
                    end: time + 0.1,
                    effectId: 'value',
                    data: { value }
                });
            }
            return { ...row, actions: newActions };
        }));
    }

    const effects = {
        value: {
            id: 'value',
            name: 'Value',
        },
    }

    const handlePlayPause = () => {
        if (!timelineRef.current) return
        if (isPlaying) {
            timelineRef.current.pause()
            setIsPlaying(false)
        } else {
            timelineRef.current.play({ autoEnd: true })
            setIsPlaying(true)
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

            if (timelineRef.current) {
                const time = timelineRef.current.getTime()
                // Convert to seconds if engine uses seconds (default)
                // If it uses ms, we stay in ms. react-timeline-editor defaults to units.
                // We'll treat units as seconds.
                timelineTimeRef.current = time
                setCurrentTime(time)
            }

            const c = controlsRef.current
            const isTimelineActive = showTimelineRef.current

            // Interpolate
            const boxX = isTimelineActive ? safeInterpolate('boxX', timelineTimeRef.current, c.dimensions.x) : c.dimensions.x
            const boxY = isTimelineActive ? safeInterpolate('boxY', timelineTimeRef.current, c.dimensions.y) : c.dimensions.y
            const boxZ = isTimelineActive ? safeInterpolate('boxZ', timelineTimeRef.current, c.dimensions.z) : c.dimensions.z
            const rotX = isTimelineActive ? safeInterpolate('rotX', timelineTimeRef.current, c.rotation.x) : c.rotation.x
            const rotY = isTimelineActive ? safeInterpolate('rotY', timelineTimeRef.current, c.rotation.y) : c.rotation.y
            const rotZ = isTimelineActive ? safeInterpolate('rotZ', timelineTimeRef.current, c.rotation.z) : c.rotation.z

            const camX = isTimelineActive ? safeInterpolate('camX', timelineTimeRef.current, c.camera.x) : c.camera.x
            const camY = isTimelineActive ? safeInterpolate('camY', timelineTimeRef.current, c.camera.y) : c.camera.y
            const camZ = isTimelineActive ? safeInterpolate('camZ', timelineTimeRef.current, c.camera.z) : c.camera.z
            const currentZoom = isTimelineActive ? safeInterpolate('zoom', timelineTimeRef.current, c.zoom) : c.zoom

            const shapeType = isTimelineActive ? safeInterpolate('shapeType', timelineTimeRef.current, c.shapeType) : c.shapeType
            const borderRadius = isTimelineActive ? safeInterpolate('borderRadius', timelineTimeRef.current, c.borderRadius) : c.borderRadius
            const numLines = isTimelineActive ? safeInterpolate('numLines', timelineTimeRef.current, c.numLines) : c.numLines
            const thickness = isTimelineActive ? safeInterpolate('thickness', timelineTimeRef.current, c.thickness) : c.thickness
            const orientation = isTimelineActive ? safeInterpolate('orientation', timelineTimeRef.current, c.orientation) : c.orientation
            const speed = isTimelineActive ? safeInterpolate('speed', timelineTimeRef.current, c.speed) : c.speed
            const longevity = isTimelineActive ? safeInterpolate('longevity', timelineTimeRef.current, c.longevity) : c.longevity
            const ease = isTimelineActive ? safeInterpolate('ease', timelineTimeRef.current, c.ease) : c.ease
            const color1 = isTimelineActive ? safeInterpolate('color1', timelineTimeRef.current, c.color1) : c.color1
            const color2 = isTimelineActive ? safeInterpolate('color2', timelineTimeRef.current, c.color2) : c.color2
            const rimColor = isTimelineActive ? safeInterpolate('rimColor', timelineTimeRef.current, c.rimColor) : c.rimColor

            gl.uniform1f(uniforms.uTime, now * 0.001)
            gl.uniform2f(uniforms.uRes, canvas.width, canvas.height)

            gl.uniform3f(uniforms.uCamPos, camX * currentZoom, camY * currentZoom, camZ * currentZoom)
            gl.uniform3f(uniforms.uBoxSize, boxX, boxY, boxZ)

            const toRad = Math.PI / 180
            gl.uniform3f(uniforms.uRot, rotX * toRad, rotY * toRad, rotZ * toRad)
            gl.uniform1f(uniforms.uBorderRadius, borderRadius)
            gl.uniform1f(uniforms.uBorderThickness, thickness)
            gl.uniform1f(uniforms.uSpeed, speed)
            gl.uniform1f(uniforms.uTrailLength, longevity)
            gl.uniform1f(uniforms.uEase, ease)
            gl.uniform1f(uniforms.uNumLines, numLines)

            const shapeModeMap: Record<string, number> = {
                'Box': 0, 'Sphere': 1, 'Cone': 2, 'Torus': 3, 'Capsule': 4, 'Cylinder': 5
            }
            gl.uniform1i(uniforms.uShapeType, shapeModeMap[shapeType] ?? 0)

            const orientationMap: Record<string, number> = {
                'Horizontal': 0, 'Vertical': 1, 'Depth': 2, 'Diagonal': 3
            }
            gl.uniform1i(uniforms.uOrientation, orientationMap[orientation] ?? 0)

            const hexToRgb = (hex: string) => {
                const r = parseInt(hex.slice(1, 3), 16) / 255
                const g = parseInt(hex.slice(3, 5), 16) / 255
                const b = parseInt(hex.slice(5, 7), 16) / 255
                return [r, g, b]
            }

            const c1 = hexToRgb(color1)
            const c2 = hexToRgb(color2)
            const cr = hexToRgb(rimColor)

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

        const handleWheel = (e: WheelEvent) => {
            const delta = e.deltaY * 0.001
            set((prev: any) => ({
                zoom: Math.max(0.1, Math.min(2.0, prev.zoom + delta))
            }))
        }

        window.addEventListener('resize', handleResize)
        canvas.addEventListener('wheel', handleWheel, { passive: false })
        handleResize()
        animationFrameId = requestAnimationFrame(render)

        return () => {
            window.removeEventListener('resize', handleResize)
            canvas.removeEventListener('wheel', handleWheel)
            cancelAnimationFrame(animationFrameId)
            gl.deleteProgram(program)
            gl.deleteShader(vs)
            gl.deleteShader(fs)
        }
    }, [])

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

            <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <button
                    onClick={() => set((p: any) => ({ zoom: Math.min(2.0, p.zoom + 0.1) }))}
                    style={{ width: '30px', height: '30px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    +
                </button>
                <button
                    onClick={() => set((p: any) => ({ zoom: Math.max(0.1, p.zoom - 0.1) }))}
                    style={{ width: '30px', height: '30px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    -
                </button>
            </div>

            {showTimeline && (
                <div className="timeline-container" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '300px', background: '#111', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid #333', background: '#222' }}>
                        <button
                            onClick={handlePlayPause}
                            style={{ padding: '6px 16px', cursor: 'pointer', background: isPlaying ? '#ff4444' : '#44ff44', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
                        >
                            {isPlaying ? 'Pause' : 'Play'}
                        </button>
                        <span style={{ color: '#fff', fontSize: '14px', fontFamily: 'monospace', minWidth: '80px' }}>
                            {currentTime.toFixed(2)}s
                        </span>
                        <button
                            onClick={handleCaptureKeyframe}
                            style={{ padding: '6px 12px', cursor: 'pointer', background: '#0d66ff', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
                            title="Capture current Leva settings as a keyframe"
                        >
                            Capture
                        </button>
                        <button
                            onClick={() => { if (timelineRef.current) { timelineRef.current.setTime(0); setCurrentTime(0); } }}
                            style={{ padding: '6px 12px', cursor: 'pointer', background: '#444', color: '#fff', border: 'none', borderRadius: '4px' }}
                        >
                            Reset
                        </button>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '15px', paddingRight: '10px' }}>
                            {timelineData.map(row => (
                                <div key={row.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <span style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase' }}>{row.id}</span>
                                    <span style={{ color: '#00ff00', fontSize: '12px', fontFamily: 'monospace' }}>
                                        {(() => {
                                            const val = safeInterpolate(row.id, currentTime, 0);
                                            return typeof val === 'number' ? val.toFixed(2) : String(val);
                                        })()}
                                    </span>
                                </div>
                            ))}
                            <button
                                className="timeline-hide-btn"
                                onClick={() => setShowTimeline(false)}
                                style={{
                                    marginLeft: '10px',
                                    background: 'transparent',
                                    color: '#888',
                                    border: '1px solid #444',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    cursor: 'pointer'
                                }}
                            >
                                Hide
                            </button>
                        </div>
                    </div>
                    <div className="timeline-body" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                        <div className="timeline-sidebar" style={{ width: '150px', background: '#1a1a1a', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                            <div className="timeline-sidebar-header" style={{ height: '32px', borderBottom: '1px solid #333' }}></div>
                            <div ref={sidebarRowsRef} className="timeline-sidebar-content" style={{ flex: 1, overflowY: 'hidden' }}>
                                {timelineData.map((row, index) => {
                                    const labels: Record<string, string> = {
                                        camX: 'Camera X',
                                        camY: 'Camera Y',
                                        camZ: 'Camera Z',
                                        zoom: 'Zoom',
                                        boxX: 'Width (X)',
                                        boxY: 'Height (Y)',
                                        boxZ: 'Depth (Z)',
                                        rotX: 'Rotate X',
                                        rotY: 'Rotate Y',
                                        rotZ: 'Rotate Z',
                                        shapeType: 'Shape',
                                        borderRadius: 'Radius',
                                        numLines: 'Line Count',
                                        thickness: 'Thickness',
                                        orientation: 'Orientation',
                                        speed: 'Speed',
                                        longevity: 'Longevity',
                                        ease: 'Ease',
                                        color1: 'Color A',
                                        color2: 'Color B',
                                        rimColor: 'Rim Color'
                                    };
                                    return (
                                        <div key={row.id} style={{
                                            height: '32px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '0 10px',
                                            color: '#ccc',
                                            fontSize: '11px',
                                            borderBottom: '1px solid #222',
                                            background: index % 2 === 0 ? '#1a1a1a' : '#222'
                                        }}>
                                            {labels[row.id] || row.id}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ flex: 1, position: 'relative', background: '#000' }}>
                            <Timeline
                                ref={timelineRef}
                                editorData={timelineData}
                                effects={effects}
                                onChange={setTimelineData}
                                onDoubleClickAction={handleDoubleClickAction}
                                onContextMenuAction={handleContextMenuAction}
                                rowHeight={32}
                                scale={1}
                                startLeft={20}
                                onScroll={({ scrollTop }) => {
                                    if (sidebarRowsRef.current) {
                                        sidebarRowsRef.current.scrollTop = scrollTop;
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
