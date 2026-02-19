#version 300 es
precision highp float;
out vec4 fragColor;
layout(std140) uniform SceneData {
    vec2 u_resolution;
    float u_time;
    float _pad0;
    vec3 u_camPos;
    vec3 u_bgColor;
    
    // Previous Frame Scene State
    vec2 u_prevResolution;
    float u_prevTime;
    float _pad1;
    vec3 u_prevCamPos;
    vec3 u_prevBgColor;
};

layout(std140) uniform ObjectData {
    vec3 u_position; float _p1;
    vec3 u_boxSize;  float _p2;
    vec3 u_rot;      float _p3;
    vec3 u_color1;   float _p4;
    vec3 u_color2;   float _p5;
    vec3 u_rimColor; float _p6;
    vec3 u_secondaryPosition; float _p7;
    vec3 u_secondaryRotation; float _p8;
    vec3 u_secondaryDimensions; float _p9;
    
    float u_borderRadius;
    float u_borderThickness;
    float u_speed;
    float u_trailLength;
    
    float u_ease;
    float u_numLines;
    float u_morphFactor;
    
    float u_svgExtrusionDepth;
    float u_svgSpread;
    float u_svgResolution;
    float u_bendAmount;
    
    float u_bendAngle;
    float u_bendOffset;
    float u_bendLimit;
    float u_rimIntensity;
    
    float u_rimPower;
    float u_wireOpacity;
    float u_wireIntensity;
    float u_layerDelay;
    
    float u_torusThickness;
    float u_lineBrightness;
    float u_compositeSmoothness;
    int u_shapeType;
    
    int u_shapeTypeNext;
    int u_orientation;
    int u_hasSvgSdf;
    int u_bendAxis;
    
    int u_compositeMode;
    int u_secondaryShapeType;
    int u_enableBackface;
    float u_renderBoxMargin; // Added for Task 13
    
    vec3 u_renderBoxSize; 
    float u_boundingRadius; // Tier 3 Optimization
    
    // Previous Frame Object State
    vec3 u_prevPosition; float _p10;
    vec3 u_prevBoxSize;  float _p11;
    vec3 u_prevRot;      float _p12;
    
    int u_maxSteps;
    int u_maxBackSteps;
};

uniform sampler2D u_svgSdfTex;
uniform sampler2D u_prepassTex;
uniform sampler2D u_prevPrepassTex;

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}


mat3 rotX(float a) { float s=sin(a), c=cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a) { float s=sin(a), c=cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }
mat3 rotZ(float a) { float s=sin(a), c=cos(a); return mat3(c,-s,0, s,c,0, 0,0,1); }

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

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
    return (length(q) - u_torusThickness) * min(h_o.x, min(h_o.y, h_o.z));
}

float sdCapsule(vec3 p, vec3 h, int orient) {
    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;
    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;
    // Radius is the smaller of the two perpendicular axes
    float r = min(h_o.y, h_o.z);
    // Half-height of the cylindrical part
    float hh = max(0.0, h_o.x - r);
    vec3 pa = p_o - vec3(-hh, 0, 0);
    vec3 ba = vec3(2.0 * hh, 0, 0);
    float h_c = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h_c) - r;
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

float sdLaptop(vec3 p, vec3 b, float r) {
    // Base part
    vec3 baseSize = vec3(b.x, b.y * 0.1, b.z);
    vec3 basePos = p - vec3(0.0, -b.y * 0.9, 0.0);
    float base = sdRoundBox(basePos, baseSize, r);
    
    // Screen part
    vec3 screenSize = vec3(b.x, b.y * 0.9, b.y * 0.05);
    // Move screen origin to hinge
    vec3 pScreen = p - vec3(0.0, -b.y * 0.8, -b.z + b.y * 0.05);
    // Rotate screen around X axis (hinge)
    float angle = -1.1; // ~63 degrees
    float s = sin(angle), c = cos(angle);
    pScreen.yz = mat2(c, -s, s, c) * pScreen.yz;
    // Move screen up from hinge
    pScreen.y -= b.y * 0.9;
    
    float screen = sdRoundBox(pScreen, screenSize, r);
    
    return min(base, screen);
}

vec3 opBend(in vec3 p, in float k, in vec2 bendSC, in int axis, in float offset, in float limit, in float invK) {
    // Reorient: swizzle p into q where q.y is the bend spine
    vec3 q = (axis == 0) ? p.yzx : (axis == 2) ? p.xzy : p.xyz;
    
    // Rotate around Y to align bend plane
    float sa = bendSC.x, ca = bendSC.y;
    q.xz = mat2(ca, -sa, sa, ca) * q.xz;
    
    // Apply bending in the XY plane
    float y = q.y - offset;
    float theta = k * clamp(y, -limit, limit);
    float s = sin(theta), c = cos(theta);
    // Linear property of rotation handles tangents automatically
    q.xy = mat2(c, -s, s, c) * vec2(q.x - invK, y) + vec2(invK, 0);
    
    // Inverse rotate around Y and inverse reorient
    q.xz = mat2(ca, sa, -sa, ca) * q.xz;
    return (axis == 0) ? q.zxy : (axis == 2) ? q.yxz : q;
}

float sdSvgExtrude(vec3 p, vec3 boxSize, int orient) {
    vec2 uv2d; float extAxis; vec2 planeSize;
    if (orient == 1) { uv2d = p.xz; planeSize = boxSize.xz; extAxis = p.y / max(boxSize.y, 0.001); }
    else if (orient == 2) { uv2d = p.xy; planeSize = boxSize.xy; extAxis = p.z / max(boxSize.z, 0.001); }
    else { uv2d = p.yz; planeSize = boxSize.yz; extAxis = p.x / max(boxSize.x, 0.001); }
    
    float scaleAxis = max(planeSize.x, planeSize.y);
    float rawSdf = texture(u_svgSdfTex, (uv2d / scaleAxis) * 0.5 + 0.5).r;
    float sdf2d = max(rawSdf * (u_svgSpread / u_svgResolution) * scaleAxis, sdRoundBox(vec3(uv2d, 0.0), vec3(planeSize, 1.0), 0.0));
    return max(sdf2d, (abs(extAxis) - u_svgExtrusionDepth) * max(boxSize.x, max(boxSize.y, boxSize.z)));
}

float getShapeDist(vec3 p, vec3 innerSize, float radius, int shapeType) {
    switch(shapeType) {
        case 1: return sdEllipsoid(p, innerSize) - radius;
        case 2: return sdCone(p, innerSize, u_orientation) - radius;
        case 3: return sdTorus(p, innerSize, u_orientation) - radius;
        case 4: return sdCapsule(p, innerSize, u_orientation) - radius;
        case 5: return sdCylinder(p, innerSize, u_orientation) - radius;
        case 6: if (u_hasSvgSdf == 1) return sdSvgExtrude(p, innerSize + radius, u_orientation);
                return sdRoundBox(p, innerSize, radius);
        case 7: return sdLaptop(p, innerSize, radius);
        default: return sdRoundBox(p, innerSize, radius);
    }
}





float mapBody(vec3 pBent, vec3 boxSize, float radius, mat3 secRotMat) {
    vec3 innerSize = max(boxSize - vec3(radius), vec3(0.0001));
    
    // Fast path: simple shape
    if (u_morphFactor <= 0.0 && u_compositeMode == 0) {
        return getShapeDist(pBent, innerSize, radius, u_shapeType);
    }
    
    // Morphing
    float d1 = getShapeDist(pBent, innerSize, radius, u_shapeType);
    if (u_morphFactor > 0.001) {
        d1 = mix(d1, getShapeDist(pBent, innerSize, radius, u_shapeTypeNext), u_morphFactor);
    }
    
    if (u_compositeMode == 0) return d1;

    // CSG with secondary shape
    vec3 pSec = (pBent - u_secondaryPosition) * secRotMat;
    
    vec3 secInnerSize = max(u_secondaryDimensions - vec3(radius), vec3(0.0001));
    float d2_box = sdRoundBox(pSec, secInnerSize, radius);
    
    // Bounding-volume early exit
    if (u_compositeMode == 1 && d1 < d2_box) return d1;
    if (u_compositeMode == 4 && d1 < d2_box - u_compositeSmoothness) return d1;
    if (u_compositeMode == 2 && d1 > -d2_box && d2_box > 0.01) return d1;
    if (u_compositeMode == 3 && d1 > d2_box && d2_box > 0.01) return max(d1, d2_box);

    float d2 = getShapeDist(pSec, secInnerSize, radius, u_secondaryShapeType);
    
    if (u_compositeMode == 1) return min(d1, d2);
    if (u_compositeMode == 2) return max(d1, -d2);
    if (u_compositeMode == 3) return max(d1, d2);
    if (u_compositeMode == 4) return smin(d1, d2, u_compositeSmoothness);
    
    return d1;
}

float map(vec3 p, vec3 boxSize, float radius, vec2 bendSC, float invK, mat3 secRotMat) {
    // Task 10: Skip opBend function call if bend is negligible
    vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);
    return mapBody(pBent, boxSize, radius, secRotMat);
}

vec3 calcNormalBent(vec3 pBent, vec3 boxSize, float radius, float hitD, mat3 secRotMat) {
    const float h = 0.0001;
    // 3-tap forward difference (reuses current distance 'hitD')
    return normalize(vec3(
        mapBody(pBent + vec3(h, 0, 0), boxSize, radius, secRotMat) - hitD,
        mapBody(pBent + vec3(0, h, 0), boxSize, radius, secRotMat) - hitD,
        mapBody(pBent + vec3(0, 0, h), boxSize, radius, secRotMat) - hitD
    ));
}

// P1-5: Analytical normals — eliminates 3 SDF calls per hit for simple shapes
vec3 analyticalNormalSphere(vec3 p) {
    return normalize(p);
}

vec3 analyticalNormalRoundBox(vec3 p, vec3 b) {
    // Gradient of sdRoundBox: dominant axis from distance to each face
    vec3 q = abs(p) - b;
    vec3 s = sign(p);
    // Outside region: gradient of length(max(q,0))
    if (max(q.x, max(q.y, q.z)) > 0.0) {
        return normalize(s * max(q, vec3(0.0)));
    }
    // Inside region: closest face normal
    if (q.x > q.y && q.x > q.z) return vec3(s.x, 0, 0);
    if (q.y > q.z) return vec3(0, s.y, 0);
    return vec3(0, 0, s.z);
}



vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * (boxSize * 2.0); // Wider box for bending/laptop (P1)
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);
}

float intersectSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
}

// P2-2: Precomputed orientation info — eliminates per-pixel uniform branches in shading
struct OrientInfo {
    int sliceAxis;      // 0=x, 1=y, 2=z, 3=diagonal
    float sliceRange;
    int p1Axis;         // perimeter axis 1
    int p2Axis;         // perimeter axis 2
    vec3 dotDir;        // direction for dotV calculation
};

OrientInfo buildOrientInfo(vec3 boxSize) {
    OrientInfo o;
    if (u_orientation == 1) {
        o.sliceAxis = 1; o.sliceRange = 2.0 * boxSize.y;
        o.p1Axis = 0; o.p2Axis = 2;
        o.dotDir = vec3(0, 1, 0);
    } else if (u_orientation == 2) {
        o.sliceAxis = 2; o.sliceRange = 2.0 * boxSize.z;
        o.p1Axis = 0; o.p2Axis = 1;
        o.dotDir = vec3(0, 0, 1);
    } else if (u_orientation == 3) {
        o.sliceAxis = 3; o.sliceRange = length(2.0 * boxSize);
        o.p1Axis = 1; o.p2Axis = 2; // default for diagonal
        o.dotDir = vec3(0.577);
    } else {
        o.sliceAxis = 0; o.sliceRange = 2.0 * boxSize.x;
        o.p1Axis = 1; o.p2Axis = 2;
        o.dotDir = vec3(1, 0, 0);
    }
    return o;
}

float getSliceCoord(vec3 p, OrientInfo oi) {
    if (oi.sliceAxis == 1) return p.y;
    if (oi.sliceAxis == 2) return p.z;
    if (oi.sliceAxis == 3) return (p.x + p.y + p.z) * 0.57735;
    return p.x;
}

vec4 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack, vec3 n, float ds, OrientInfo oi) {
    float sliceCoord = getSliceCoord(p, oi);
    float sliceRange = oi.sliceRange;
    float norm = clamp((sliceCoord + sliceRange * 0.5) / sliceRange, 0.0, 1.0);
    float layerIdx = floor(norm * u_numLines), layerGap = sliceRange / (u_numLines + 0.001);
    float layerCenter = (layerIdx + 0.5) * layerGap - sliceRange * 0.5;
    float actualThick = min(thickness, layerGap * 0.48);
    float lineMask = 1.0 - smoothstep(actualThick - ds, actualThick + ds, abs(sliceCoord - layerCenter));
    vec3 pUse = clamp(p, -boxSize, boxSize);
    // Index-driven perimeter axis selection (replaces orientation branches)
    float p1 = (oi.p1Axis == 0) ? pUse.x : (oi.p1Axis == 1) ? pUse.y : pUse.z;
    float p2 = (oi.p2Axis == 0) ? pUse.x : (oi.p2Axis == 1) ? pUse.y : pUse.z;
    float b1 = (oi.p1Axis == 0) ? boxSize.x : (oi.p1Axis == 1) ? boxSize.y : boxSize.z;
    float b2 = (oi.p2Axis == 0) ? boxSize.x : (oi.p2Axis == 1) ? boxSize.y : boxSize.z;
    float perimeter = (abs(p2 * b1) > abs(p1 * b2)) ? ((p2 > 0.0) ? (b1 + p1) : (3.0 * b1 + 2.0 * b2 - p1)) : ((p1 > 0.0) ? (2.0 * b1 + b2 - p2) : (4.0 * b1 + 3.0 * b2 + p2));
    
    float progress = mod(time * u_speed - layerIdx * u_layerDelay, 3.0);
    float dist = fract(progress - (perimeter / (4.0 * (b1 + b2) + 0.001)));
    float isActive = (dist < u_trailLength) ? pow(smoothstep(0.0, max(0.01, u_ease), 1.0 - abs(1.0 - (dist / u_trailLength) * 2.0)), 1.5) : 0.0;
    
    float dotV = abs(dot(n, oi.dotDir));
    float lineAlpha = lineMask * isActive * smoothstep(0.1, 0.4, 1.0 - dotV);
    
    vec3 wireColor = vec3(0);
    if (u_shapeType == 0 && u_wireIntensity > 0.0) {
        wireColor = u_color1 * u_wireIntensity * max(max((1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z)))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z))));
    }
    float wireAlpha = (length(wireColor) > 0.001) ? u_wireOpacity : 0.0;

    vec3 baseColor = mix(u_color1, u_color2, isActive);
    float totalAlpha = clamp(lineAlpha + wireAlpha, 0.0, 1.0);
    vec3 finalRGB = baseColor * lineAlpha + wireColor;
    
    float boost = isBack ? 1.0 : u_lineBrightness;
    return vec4(finalRGB * boost, totalAlpha * (isBack ? 0.5 : 1.0));
}

#ifndef MAX_STEPS
#define MAX_STEPS 64
#endif

#ifndef MIN_STEPS
#define MIN_STEPS 16
#endif

#ifndef MAX_BACK_STEPS
#define MAX_BACK_STEPS 32
#endif

#ifndef HIT_EPS
#define HIT_EPS 0.003
#endif

vec4 render(vec3 ro_l, vec3 rd, vec2 bendSC, float invK, mat3 secRotMat, OrientInfo oi) {
    // Tier 3 Optimization: Ray-Sphere Early-Out
    float tSphere = intersectSphere(ro_l, rd, u_boundingRadius);
    if (tSphere < 0.0 && length(ro_l) > u_boundingRadius) return vec4(0.0);

    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    
    if (tBox.y > 0.0) {
        float t = max(0.0, tBox.x); bool hit = false; vec3 p;
        
        // Task 11: Half-resolution pre-pass early exit
        #ifndef EXPORT_MODE
        vec2 screenUV = gl_FragCoord.xy / u_resolution;
        float prepassT = texture(u_prepassTex, screenUV).r;
        if (prepassT < 0.0) return vec4(0.0); // Pre-pass missed, absolute skip
        
        // Start raymarching slightly before the pre-pass hit point for safety
        t = max(t, prepassT - 0.05);
        #endif

        float lastD = 1e10;
        float finalD = 0.0;
        for(int i=0; i<MAX_STEPS; i++) { 
            if (i >= u_maxSteps) break;
            // Simple shapes converge faster, reduce front-pass steps (P1 Optimization)
            if (u_compositeMode == 0 && u_morphFactor <= 0.0 && i >= MIN_STEPS) break;

            p = ro_l + rd * t; 
            float d = map(p, u_boxSize, u_borderRadius, bendSC, invK, secRotMat); 
            
            float adaptiveEps = HIT_EPS * (1.0 + t * 0.05);
            if(d < adaptiveEps) { hit = true; finalD = d; break; } 
            
            // Task 8: Distance-based step acceleration
            float stepScale = (d > 0.1 && d >= lastD) ? 1.5 : 1.0;
            t += d * stepScale; 
            lastD = d;
            
            if(t > tBox.y) break; 
        }
        if(hit) { 
            vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);
            
            // P1-5: Use analytical normals for simple unbent shapes (saves 3 SDF calls)
            vec3 n;
            if (u_compositeMode == 0 && u_morphFactor <= 0.0 && abs(u_bendAmount) < 0.001) {
                vec3 innerSize = max(u_boxSize - vec3(u_borderRadius), vec3(0.0001));
                if (u_shapeType == 1) n = analyticalNormalSphere(pBent);
                else if (u_shapeType == 0) n = analyticalNormalRoundBox(pBent, innerSize);
                else n = calcNormalBent(pBent, u_boxSize, u_borderRadius, finalD, secRotMat);
            } else {
                n = calcNormalBent(pBent, u_boxSize, u_borderRadius, finalD, secRotMat);
            }

            
            float rim = pow(1.0 - max(dot(-rd, n), 0.0), u_rimPower) * u_rimIntensity;
            vec3 rimRGB = u_rimColor * rim;
            
            float ds = fwidth(getSliceCoord(pBent, oi));
            vec4 surface = getSurfaceColor(pBent, u_boxSize, u_time, u_borderThickness, false, n, ds, oi);
            col = surface.rgb + rimRGB;
            alpha = surface.a + rim;
            
            if (u_enableBackface == 1 && alpha < 0.99) {
                vec3 ro_b = ro_l + rd * tBox.y, rd_b = -rd; float tb = 0.0; hit = false;
                float lastDb = 1e10;
                float finalDb = 0.0;
                for(int i=0; i<MAX_BACK_STEPS; i++) { 
                    if (i >= u_maxBackSteps) break;
                    // Simple shapes converge faster, reduce back-pass steps (P1 Optimization)
                    if (u_compositeMode == 0 && i >= MIN_STEPS) break;
                    
                    p = ro_b + rd_b * tb; 
                    float d = map(p, u_boxSize, u_borderRadius, bendSC, invK, secRotMat); 
                    
                    float adaptiveEps = HIT_EPS * (1.0 + tb * 0.05);
                    if(d < adaptiveEps) { hit = true; finalDb = d; break; } 
                    
                    // Task 8: Distance-based step acceleration
                    float stepScale = (d > 0.1 && d >= lastDb) ? 1.5 : 1.0;
                    tb += d * stepScale; 
                    lastDb = d;
                    
                    if(tb > (tBox.y - tBox.x + 0.1)) break; 
                }
                if(hit) {
                    vec3 pBentB = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);
                    
                    #ifdef SIMPLE_BACKFACE_NORMALS
                    vec3 nB = -rd;
                    #else
                    vec3 nB = calcNormalBent(pBentB, u_boxSize, u_borderRadius, finalDb, secRotMat);
                    #endif

                    
                    vec4 surfaceBack = getSurfaceColor(pBentB, u_boxSize, u_time, u_borderThickness, true, nB, ds, oi);
                    col += surfaceBack.rgb * (1.0 - alpha); 
                    alpha += surfaceBack.a * (1.0 - alpha);
                }
            }
        }
    }
    return vec4(col, alpha);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    mat3 mI = transpose(rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x));
    
    vec3 ro_l = mI * (u_camPos - u_position);
    
    vec3 worldFwd = normalize(-u_camPos);
    vec3 worldRight = normalize(cross(vec3(0, 1, 0), worldFwd));
    vec3 worldUp = cross(worldFwd, worldRight);

    vec3 fwd = mI * worldFwd;
    vec3 right = mI * worldRight;
    vec3 up = mI * worldUp;
    
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Precompute invariants
    float a = u_bendAngle * 0.01745329;
    vec2 bendSC = vec2(sin(a), cos(a));
    float invK = 1.0 / max(u_bendAmount, 0.0001);
    mat3 secRotMat = rotZ(u_secondaryRotation.z) * rotY(u_secondaryRotation.y) * rotX(u_secondaryRotation.x);
    OrientInfo oi = buildOrientInfo(u_boxSize);
    
    vec4 res = render(ro_l, rd, bendSC, invK, secRotMat, oi);
    
    fragColor = vec4(res.rgb, res.a);
}
