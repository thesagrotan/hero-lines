// ... (imports remain same)
import { useEffect, useRef } from 'react'
import { useControls } from 'leva'

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
uniform vec3 u_rot; // Rotation in radians
uniform float u_borderRadius;
uniform float u_borderThickness;
uniform float u_speed;
uniform float u_trailLength;
uniform float u_ease;

// Signed Distance Function for a Rounded Box
float sdRoundBox( vec3 p, vec3 b, float r ) {
    vec3 q = abs(p) - b;
    return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}

// Scene Mapping
float map(vec3 p, vec3 boxSize, float radius) {
    // Effective box size for SDF (subtract radius to keep total size consistent)
    // Ensure inner box size is not negative
    vec3 innerSize = max(boxSize - vec3(radius), vec3(0.0));
    return sdRoundBox(p, innerSize, radius);
}

// Calculate Normal via finite differences
vec3 calcNormal(vec3 p, vec3 boxSize, float radius) {
    const float h = 0.0001;
    const vec2 k = vec2(1,-1);
    return normalize(k.xyy*map(p + k.xyy*h, boxSize, radius) + 
                     k.yyx*map(p + k.yyx*h, boxSize, radius) + 
                     k.yxy*map(p + k.yxy*h, boxSize, radius) + 
                     k.xxx*map(p + k.xxx*h, boxSize, radius));
}

// Rotation matrices
mat3 rotateX(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c, -s,
        0.0, s, c
    );
}

mat3 rotateY(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

mat3 rotateZ(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(
        c, -s, 0.0,
        s, c, 0.0,
        0.0, 0.0, 1.0
    );
}

// Precise Box Intersection
vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * boxSize;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return vec2(-1.0);
    return vec2(tN, tF);
}

// Helper to calculate color at a specific 3D point on the surface
vec3 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack) {
    // 1. LAYER MASK (Horizontal slices - Scanlines)
    float numLayers = 30.0;
    float yNorm = (p.y + boxSize.y) / (2.0 * boxSize.y);
    float layerIdx = floor(yNorm * numLayers);
    float layerCenter = (layerIdx / numLayers) * (2.0 * boxSize.y) - boxSize.y + (0.5 / numLayers) * (2.0 * boxSize.y);
    
    // Scanlines logic
    float lineMask = 1.0 - smoothstep(thickness * 0.2, thickness, abs(p.y - layerCenter));
    
    // 2. TIMING
    // Project P to Box Surface for animation
    vec3 pUse = clamp(p, -boxSize, boxSize); 
    float perimeter = 0.0;
    float totalPerim = 4.0 * (boxSize.x + boxSize.z);
    
    if (pUse.z > boxSize.z - 0.1 && abs(pUse.x) < boxSize.x) { // Front
        perimeter = (pUse.x + boxSize.x);
    } else if (pUse.x > boxSize.x - 0.1 && abs(pUse.z) < boxSize.z) { // Right
        perimeter = (2.0 * boxSize.x) + (boxSize.z - pUse.z);
    } else if (pUse.z < -boxSize.z + 0.1 && abs(pUse.x) < boxSize.x) { // Back
        perimeter = (2.0 * boxSize.x + 2.0 * boxSize.z) + (boxSize.x - pUse.x);
    } else if (pUse.x < -boxSize.x + 0.1 && abs(pUse.z) < boxSize.z) { // Left
        perimeter = (4.0 * boxSize.x + 2.0 * boxSize.z) + (pUse.z + boxSize.z);
    }
    
    float normPerim = perimeter / totalPerim;

    float speed = u_speed;
    float timeVal = time * speed;
    float layerDelay = layerIdx * 0.015; 
    
    float progress = mod(timeVal - layerDelay, 3.0);
    float segmentLen = u_trailLength;
    
    // Calculate distance from the "head" of the trail
    float dist = fract(progress - normPerim);
    
    float isActive = 0.0;
    if (dist < segmentLen) {
        float t = 1.0 - (dist / segmentLen);
        float tailFade = smoothstep(0.0, max(0.001, u_ease), t);
        float headFade = smoothstep(0.0, max(0.001, u_ease), 1.0 - t);
        isActive = tailFade * headFade;
    }

    // 3. WIREFRAME EDGE MASK (The "Cage")
    // Detect if we are near ANY edge (12 edges)
    // Edge proximity means at least 2 components of |p| are near boxSize
    // Threshold is thickness.
    // Normalized distance from center (0 to 1 relative to boxSize)
    vec3 distFromCenter = abs(p);
    vec3 edgeDist = boxSize - distFromCenter;
    // We want to detect if edgeDist < thickness * 4.0
    vec3 isNearEdge = step(edgeDist, vec3(thickness * 4.0));
    // If sum is >= 2, we are near an edge (or corner)
    float nearEdgeCount = isNearEdge.x + isNearEdge.y + isNearEdge.z;
    float wireframeMask = step(2.0, nearEdgeCount);
    
    // Smooth the wireframe
    // Let's use smoothstep for soft edges
    // Find separation from edge
    // For Top-Right edge (Y near boxY, X near boxX): min(edgeDist.x, edgeDist.y)
    // We need minimum of the two smallest distances? No, max of proximity?
    // Let's stick to the simpler max-logic from before but generalize
    // max(proximityX, proximityY) for Z-aligned edge.
    // General solution: 2nd largest component of proximity?
    // Let's use a simpler union of 3 specific edge types:
    // Vertical Edges (Corner pillars): max(proximityX, proximityZ)
    // Horizontal X Edges: max(proximityY, proximityZ)
    // Horizontal Z Edges: max(proximityX, proximityY)
    
    // Proximity = 1.0 if dist=0, 0.0 if dist=thick checks...
    // Let's invert: Distance from edge.
    // Vert dist = max(distToCorner.x, distToCorner.z) ... wait, this was my previous logic!
    // distToCorner was abs(|p.xz| - boxSize.xz).
    // Let's reuse that robust logic.
    vec3 d = abs(abs(p) - boxSize); // Distance to face planes
    // If d.x < small and d.z < small -> Vertical Edge
    // We want mask = 1 when d is small.
    // So measure proximity = 1.0 - smoothstep(small, large, d).
    vec3 proxim = vec3(
        1.0 - smoothstep(thickness, thickness * 4.0, d.x),
        1.0 - smoothstep(thickness, thickness * 4.0, d.y),
        1.0 - smoothstep(thickness, thickness * 4.0, d.z)
    );
    
    // Combine proximities:
    float edgeVert = proxim.x * proxim.z; // Near X-face AND Z-face
    float edgeHorzX = proxim.y * proxim.z; // Near Y-face AND Z-face
    float edgeHorzZ = proxim.x * proxim.y; // Near X-face AND Y-face
    
    float wireframe = max(edgeVert, max(edgeHorzX, edgeHorzZ));

    vec3 colorBlue = vec3(0.05, 0.4, 1.0);
    vec3 colorCyan = vec3(0.3, 0.8, 1.0);
    
    // Combine masks
    // Mask out top/bottom caps for SCANLINES only
    // Use raw coordinate for face mask to keep it sharp
    // We want 1.0 on side faces, 0.0 on top/bottom
    float verticalFaceMask = smoothstep(thickness * 0.5, thickness * 2.0, abs(abs(p.y) - boxSize.y));
    
    float finalAlpha = lineMask * isActive * verticalFaceMask;
    
    vec3 lineCol = mix(colorBlue, colorCyan, isActive) * finalAlpha;
    vec3 wireframeCol = colorBlue * 0.15 * wireframe;
    
    float intensity = isBack ? 1.5 : 3.0; 
    return (lineCol + wireframeCol) * intensity;
}

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    vec3 ro = u_camPos;
    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    vec3 finalCol = vec3(0.0);

    // Apply rotation to the ray (Inverse rotation of the object)
    mat3 rotMat = rotateZ(u_rot.z) * rotateY(u_rot.y) * rotateX(u_rot.x);
    mat3 invRot = transpose(rotMat);

    vec3 ro_local = invRot * ro;
    vec3 rd_local = invRot * rd;
    
    // 1. Analytic Bounding Box Intersection
    // Gives us a robust start/end point for raymarching
    // and significantly improves performance (empty space skipping)
    vec2 tBox = intersectBox(ro_local, rd_local, u_boxSize);

    if(tBox.x > 0.0) {
        // We hit the bounding box. Now march to find the rounded surface.
        
        // --- PASS 1: FRONT FACE ---
        float t = tBox.x; // Start at bounding box entry
        float tMax = tBox.y; // Don't go past exit
        
        vec3 p = vec3(0.0);
        bool hitFront = false;
        
        // Dithering to prevent banding
        t += hash(uv.x + uv.y * 57.0 + u_time) * 0.05;

        for(int i=0; i<64; i++) {
            p = ro_local + rd_local * t;
            float d = map(p, u_boxSize, u_borderRadius);
            if(d < 0.001) { hitFront = true; break; }
            if(t > tMax) break;
            t += d;
        }

        if(hitFront) {
            vec3 colFront = getSurfaceColor(p, u_boxSize, u_time, u_borderThickness, false);
            finalCol += colFront;
            
            // Add rim lighting
            vec3 n = calcNormal(p, u_boxSize, u_borderRadius);
            float rim = 1.0 - max(dot(-rd_local, n), 0.0);
            finalCol += vec3(0.1, 0.4, 0.8) * pow(rim, 3.0) * 0.5;
        }
        
        // --- PASS 2: BACK FACE ---
        // To find back face, we can Raymarch BACKWARDS from the exit point (tBox.y)
        // toward the camera. Distance field is absolute, so we just move towards surface.
        
        t = tBox.y; // Start at bounding box exit
        // We march backwards along the ray: p -= rd * d ?
        // Or rather, we are at param t, decreasing t.
        // We want to find smallest t (closest to tBox.y) where d=0.
        // But standard raymarch moves forward.
        // Let's define a new ray starting at exit point, pointing towards entry.
        // ro_back = ro + rd * tBox.y;
        // rd_back = -rd;
        
        vec3 ro_back = ro_local + rd_local * tBox.y;
        vec3 rd_back = -rd_local;
        
        float t_back = 0.0;
        // Max distance to check is length of box diagonal ~ ish
        float tMax_back = tBox.y - tBox.x; // Distance inside box
        
        bool hitBack = false;
        vec3 pBack = vec3(0.0);
        
        for(int i=0; i<64; i++) {
             pBack = ro_back + rd_back * t_back;
             float d = map(pBack, u_boxSize, u_borderRadius);
             if(d < 0.001) { hitBack = true; break; }
             if(t_back > tMax_back) break;
             t_back += d;
        }
        
        if(hitBack) {
            // pBack is the surface point on the back side
            vec3 colBack = getSurfaceColor(pBack, u_boxSize, u_time, u_borderThickness, true);
            finalCol += colBack * 0.6; // Scale down brightness for back face
        }
    }

    // Post-processing: Add subtle bloom and grain
    finalCol += (hash(uv.x + uv.y + u_time) - 0.5) * 0.03;
    
    // Clamp and output
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

    // Leva controls
    const controls = useControls({
        'Camera Position': {
            value: { x: 5.0, y: 4.5, z: 8.0 },
            joystick: false,
        },
        camX: { value: 5.0, min: -10, max: 10, step: 0.1, label: 'Cam X' },
        camY: { value: 4.5, min: -10, max: 10, step: 0.1, label: 'Cam Y' },
        camZ: { value: 8.0, min: 2, max: 20, step: 0.1, label: 'Cam Z' },

        boxX: { value: 1.5, min: 0.1, max: 4, step: 0.05, label: 'Width (X)' },
        boxY: { value: 1.0, min: 0.1, max: 4, step: 0.05, label: 'Height (Y)' },
        boxZ: { value: 2.2, min: 0.1, max: 4, step: 0.05, label: 'Depth (Z)' },

        rotX: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate X (deg)' },
        rotY: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate Y (deg)' },
        rotZ: { value: 0, min: -180, max: 180, step: 1, label: 'Rotate Z (deg)' },

        borderRadius: { value: 0.1, min: 0.0, max: 1.0, step: 0.01, label: 'Border Radius' },
        thickness: { value: 0.01, min: 0.001, max: 0.1, step: 0.001, label: 'Line Thickness' },
        speed: { value: 0.8, min: 0.0, max: 5.0, step: 0.1, label: 'Speed' },
        longevity: { value: 0.4, min: 0.05, max: 2.0, step: 0.05, label: 'Longevity' },
        ease: { value: 0.5, min: 0.0, max: 1.0, step: 0.1, label: 'Ease In/Out' },
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

        let animationFrameId: number

        const render = (time: number) => {
            // Access current values from ref
            const {
                camX, camY, camZ,
                boxX, boxY, boxZ,
                rotX, rotY, rotZ,
                borderRadius, thickness,
                speed, longevity, ease
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

    return <canvas ref={canvasRef} />
}
