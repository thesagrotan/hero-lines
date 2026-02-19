#version 300 es
precision highp float;
out vec4 fragColor;
layout(std140) uniform SceneData {
    vec2 u_resolution;
    float u_time;
    float _pad0;
    vec3 u_camPos;
    vec3 u_bgColor;
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
    float u_timeNoise;
    
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
};

uniform sampler2D u_svgSdfTex;

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f*f*(3.0-2.0*f);
    float n = p.x + p.y*57.0 + 113.0*p.z;
    return mix(mix(mix(hash(n+0.0), hash(n+1.0),f.x),
                   mix(hash(n+57.0), hash(n+58.0),f.x),f.y),
               mix(mix(hash(n+113.0), hash(n+114.0),f.x),
                   mix(hash(n+170.0), hash(n+171.0),f.x),f.y),f.z);
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

vec3 opBend(in vec3 p, in float k, in float angle, in int axis, in float offset, in float limit) {
    if (abs(k) < 0.001) return p;
    
    // 1. Reorient so the bend spine is Y
    vec3 q = p;
    if (axis == 0) q = p.yzx; // X spine -> Y spine
    else if (axis == 2) q = p.xzy; // Z spine -> Y spine
    
    // 2. Rotate around Y by 'angle' to align bend plane with XY
    float a = angle * 0.01745329;
    float sa = sin(a), ca = cos(a);
    vec2 xz = mat2(ca, -sa, sa, ca) * q.xz;
    q.xz = xz;
    
    // 3. Apply bending in the XY plane
    // Apply offset and limit to the bend region
    float y = q.y - offset;
    float yclamped = clamp(y, -limit, limit);
    
    float theta = k * yclamped;
    float c = cos(theta);
    float s = sin(theta);
    mat2 m = mat2(c, -s, s, c);
    
    // Transform the point. Points outside the clamped region follow the tangent
    vec2 xy = q.xy;
    xy.x -= 1.0/k;
    xy = m * xy;
    xy.x += 1.0/k;
    
    // Straight parts (outside limit)
    if (y > limit) {
        xy += vec2(-s, c) * (y - limit);
    } else if (y < -limit) {
        xy += vec2(s, c) * (y + limit);
    }
    
    q.xy = xy;
    
    // 4. Inverse rotate around Y
    xz = mat2(ca, sa, -sa, ca) * q.xz;
    q.xz = xz;
    
    // 5. Inverse reorient
    if (axis == 0) return q.zxy;
    else if (axis == 2) return q.yxz;
    return q;
}

float sdSvgExtrude(vec3 p, vec3 boxSize, int orient) {
    // Select which 2D plane to project onto and which axis to extrude along
    vec2 uv2d;
    float extAxis;
    vec2 planeSize;
    if (orient == 1) {          // Vertical: extrude along Y
        uv2d = p.xz;
        planeSize = boxSize.xz;
        extAxis = p.y / max(boxSize.y, 0.001);
    } else if (orient == 2) {   // Depth: extrude along Z
        uv2d = p.xy;
        planeSize = boxSize.xy;
        extAxis = p.z / max(boxSize.z, 0.001);
    } else {                    // Horizontal (default): extrude along X
        uv2d = p.yz;
        planeSize = boxSize.yz;
        extAxis = p.x / max(boxSize.x, 0.001);
    }
    // Map from object space to [0,1] UV space
    float scaleAxis = max(planeSize.x, planeSize.y);
    vec2 texUV = (uv2d / scaleAxis) * 0.5 + 0.5;
    // Sample the 2D SDF texture (negative = inside)
    // The raw texture values are normalized to the 'spread', not the object side.
    // We must scale it back to world space:
    // raw_value * spread_pixels / resolution_pixels * object_scale
    float rawSdf = texture(u_svgSdfTex, texUV).r;
    float sdf2d = rawSdf * (u_svgSpread / u_svgResolution) * scaleAxis;
    // Extrusion: combine 2D distance with depth cap
    float extDist = (abs(extAxis) - u_svgExtrusionDepth) * max(boxSize.x, max(boxSize.y, boxSize.z));
    return max(sdf2d, extDist);
}

float getShapeDist(vec3 p, vec3 boxSize, float radius, int shapeType) {
    // To keep the shape within boxSize even with borderRadius (radius),
    // we shrink the inner shape by that radius.
    vec3 innerSize = max(boxSize - vec3(radius), vec3(0.0001));
    
    if (shapeType == 1) return sdEllipsoid(p, innerSize) - radius;
    if (shapeType == 2) return sdCone(p, innerSize, u_orientation) - radius;
    if (shapeType == 3) return sdTorus(p, innerSize, u_orientation) - radius;
    if (shapeType == 4) return sdCapsule(p, innerSize, u_orientation) - radius;
    if (shapeType == 5) return sdCylinder(p, innerSize, u_orientation) - radius;
    if (shapeType == 6 && u_hasSvgSdf == 1) return sdSvgExtrude(p, boxSize, u_orientation);
    if (shapeType == 7) return sdLaptop(p, innerSize, radius);
    
    return sdRoundBox(p, innerSize, radius);
}



float mapBody(vec3 pBent, vec3 boxSize, float radius) {
    vec3 pScaled = pBent;
    
    float d1;
    if (u_morphFactor <= 0.0) {
        d1 = getShapeDist(pScaled, boxSize, radius, u_shapeType);
    } else {
        float da = getShapeDist(pScaled, boxSize, radius, u_shapeType);
        float db = getShapeDist(pScaled, boxSize, radius, u_shapeTypeNext);
        d1 = mix(da, db, u_morphFactor);
    }
    
    float d;
    if (u_compositeMode == 0) {
        d = d1;
    } else {
        // Evaluate secondary shape
        vec3 pSecondary = pScaled - u_secondaryPosition;
        pSecondary *= rotZ(u_secondaryRotation.z) * rotY(u_secondaryRotation.y) * rotX(u_secondaryRotation.x);
        float d2 = getShapeDist(pSecondary, u_secondaryDimensions, radius, u_secondaryShapeType);
        
        if (u_compositeMode == 1) d = min(d1, d2);
        else if (u_compositeMode == 2) d = max(d1, -d2);
        else if (u_compositeMode == 3) d = max(d1, d2);
        else if (u_compositeMode == 4) d = smin(d1, d2, u_compositeSmoothness);
        else d = d1;
    }
    
    return d;
}

float map(vec3 p, vec3 boxSize, float radius) {
    vec3 pBent = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
    return mapBody(pBent, boxSize, radius);
}

vec3 calcNormalBent(vec3 pBent, vec3 boxSize, float radius) {
    const float h = 0.0001;
    const vec2 k = vec2(1.0, -1.0);
    return normalize(
        k.xyy * mapBody(pBent + k.xyy * h, boxSize, radius) + 
        k.yyx * mapBody(pBent + k.yyx * h, boxSize, radius) + 
        k.yxy * mapBody(pBent + k.yxy * h, boxSize, radius) + 
        k.xxx * mapBody(pBent + k.xxx * h, boxSize, radius)
    );
}


vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * (boxSize * 2.0); // Wider box for bending/wobble/laptop (P1)
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);
}

vec4 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack, vec3 n) {
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
    
    float noiseVal = hash(layerIdx) * u_timeNoise;
    float progress = mod(time * u_speed - layerIdx * u_layerDelay + noiseVal, 3.0);
    float dist = fract(progress - (perimeter / (4.0 * (b1 + b2) + 0.001)));
    float isActive = (dist < u_trailLength) ? pow(smoothstep(0.0, max(0.01, u_ease), 1.0 - abs(1.0 - (dist / u_trailLength) * 2.0)), 1.5) : 0.0;
    
    float dotV = (u_orientation == 1) ? abs(n.y) : (u_orientation == 2) ? abs(n.z) : (u_orientation == 3) ? abs(dot(n, vec3(0.577))) : abs(n.x);
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

#ifndef MAX_BACK_STEPS
#define MAX_BACK_STEPS 32
#endif

#ifndef HIT_EPS
#define HIT_EPS 0.001
#endif

vec4 render(vec3 ro_l, vec3 rd) {
    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    
    if (tBox.y > 0.0) {
        float t = max(0.0, tBox.x); bool hit = false; vec3 p;
        for(int i=0; i<MAX_STEPS; i++) { 
            // Simple shapes converge faster, reduce front-pass steps (P1 Optimization)
            if (u_compositeMode == 0 && u_morphFactor <= 0.0 && i >= 16) break;

            p = ro_l + rd * t; 
            float d = map(p, u_boxSize, u_borderRadius); 
            if(d < HIT_EPS) { hit = true; break; } 
            t += d; 
            if(t > tBox.y) break; 
        }
        if(hit) { 
            vec3 pBent = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
            vec3 n = calcNormalBent(pBent, u_boxSize, u_borderRadius);
            
            float rim = pow(1.0 - max(dot(-rd, n), 0.0), u_rimPower) * u_rimIntensity;
            vec3 rimRGB = u_rimColor * rim;
            
            vec4 surface = getSurfaceColor(pBent, u_boxSize, u_time, u_borderThickness, false, n);
            col = surface.rgb + rimRGB;
            alpha = surface.a + rim;
        }
        
        if (alpha < 0.95) {
            vec3 ro_b = ro_l + rd * tBox.y, rd_b = -rd; float tb = 0.0; hit = false;
            for(int i=0; i<MAX_BACK_STEPS; i++) { 
                // Simple shapes converge faster, reduce back-pass steps (P1 Optimization)
                if (u_compositeMode == 0 && i >= 16) break;
                
                p = ro_b + rd_b * tb; 
                float d = map(p, u_boxSize, u_borderRadius); 
                if(d < HIT_EPS) { hit = true; break; } 
                tb += d; 
                if(tb > (tBox.y - tBox.x + 0.1)) break; 
            }
            if(hit) {
                vec3 pBentB = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
                vec3 nB = calcNormalBent(pBentB, u_boxSize, u_borderRadius);
                
                vec4 surfaceBack = getSurfaceColor(pBentB, u_boxSize, u_time, u_borderThickness, true, nB);
                col += surfaceBack.rgb * (1.0 - alpha); 
                alpha += surfaceBack.a * (1.0 - alpha);
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
    
    vec4 res = render(ro_l, rd);
    
    fragColor = vec4(res.rgb, res.a);
}
