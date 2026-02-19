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
    int u_enableBackface;
    int _pad2;
    
    // Previous Frame Object State
    vec3 u_prevPosition; float _p10;
    vec3 u_prevBoxSize;  float _p11;
    vec3 u_prevRot;      float _p12;
};

uniform sampler2D u_svgSdfTex;
uniform sampler2D u_prevPrepassTex;

// Simplified SDF logic for pre-pass
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

mat3 rotX(float a) { float s=sin(a), c=cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a) { float s=sin(a), c=cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }
mat3 rotZ(float a) { float s=sin(a), c=cos(a); return mat3(c,-s,0, s,c,0, 0,0,1); }

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
    float r = min(h_o.y, h_o.z);
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
    vec3 baseSize = vec3(b.x, b.y * 0.1, b.z);
    vec3 basePos = p - vec3(0.0, -b.y * 0.9, 0.0);
    float base = sdRoundBox(basePos, baseSize, r);
    vec3 screenSize = vec3(b.x, b.y * 0.9, b.y * 0.05);
    vec3 pScreen = p - vec3(0.0, -b.y * 0.8, -b.z + b.y * 0.05);
    float angle = -1.1; 
    float s = sin(angle), c = cos(angle);
    pScreen.yz = mat2(c, -s, s, c) * pScreen.yz;
    pScreen.y -= b.y * 0.9;
    float screen = sdRoundBox(pScreen, screenSize, r);
    return min(base, screen);
}

vec3 opBend(in vec3 p, in float k, in float angle, in int axis, in float offset, in float limit) {
    if (abs(k) < 0.001) return p;
    vec3 q = p;
    if (axis == 0) q = p.yzx; 
    else if (axis == 2) q = p.xzy; 
    float a = angle * 0.01745329;
    float sa = sin(a), ca = cos(a);
    vec2 xz = mat2(ca, -sa, sa, ca) * q.xz;
    q.xz = xz;
    float y = q.y - offset;
    float yclamped = clamp(y, -limit, limit);
    float theta = k * yclamped;
    float c = cos(theta);
    float s = sin(theta);
    mat2 m = mat2(c, -s, s, c);
    vec2 xy = q.xy;
    xy.x -= 1.0/k;
    xy = m * xy;
    xy.x += 1.0/k;
    if (y > limit) xy += vec2(-s, c) * (y - limit);
    else if (y < -limit) xy += vec2(s, c) * (y + limit);
    q.xy = xy;
    xz = mat2(ca, sa, -sa, ca) * q.xz;
    q.xz = xz;
    if (axis == 0) return q.zxy;
    else if (axis == 2) return q.yxz;
    return q;
}

float sdSvgExtrude(vec3 p, vec3 boxSize, int orient) {
    vec2 uv2d; float extAxis; vec2 planeSize;
    if (orient == 1) { uv2d = p.xz; planeSize = boxSize.xz; extAxis = p.y / max(boxSize.y, 0.001); }
    else if (orient == 2) { uv2d = p.xy; planeSize = boxSize.xy; extAxis = p.z / max(boxSize.z, 0.001); }
    else { uv2d = p.yz; planeSize = boxSize.yz; extAxis = p.x / max(boxSize.x, 0.001); }
    float scaleAxis = max(planeSize.x, planeSize.y);
    vec2 texUV = (uv2d / scaleAxis) * 0.5 + 0.5;
    float rawSdf = texture(u_svgSdfTex, texUV).r;
    float sdf2d = rawSdf * (u_svgSpread / u_svgResolution) * scaleAxis;
    float extDist = (abs(extAxis) - u_svgExtrusionDepth) * max(boxSize.x, max(boxSize.y, boxSize.z));
    return max(sdf2d, extDist);
}

float getShapeDist(vec3 p, vec3 boxSize, float radius, int shapeType) {
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
    if (u_morphFactor <= 0.0 && u_compositeMode == 0) {
        return getShapeDist(pBent, boxSize, radius, u_shapeType);
    }
    float d1;
    if (u_morphFactor <= 0.0) {
        d1 = getShapeDist(pBent, boxSize, radius, u_shapeType);
    } else {
        float da = getShapeDist(pBent, boxSize, radius, u_shapeType);
        float db = getShapeDist(pBent, boxSize, radius, u_shapeTypeNext);
        d1 = mix(da, db, u_morphFactor);
    }
    if (u_compositeMode == 0) return d1;
    vec3 pSecondary = pBent - u_secondaryPosition;
    pSecondary *= rotZ(u_secondaryRotation.z) * rotY(u_secondaryRotation.y) * rotX(u_secondaryRotation.x);
    float d2 = getShapeDist(pSecondary, u_secondaryDimensions, radius, u_secondaryShapeType);
    if (u_compositeMode == 1) return min(d1, d2);
    if (u_compositeMode == 2) return max(d1, -d2);
    if (u_compositeMode == 3) return max(d1, d2);
    if (u_compositeMode == 4) return smin(d1, d2, u_compositeSmoothness);
    return d1;
}

float map(vec3 p, vec3 boxSize, float radius) {
    vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
    return mapBody(pBent, boxSize, radius);
}

vec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {
    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * (boxSize * 2.1); 
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);
}

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - 0.5 * u_resolution) / u_resolution.y;
    mat3 mI = transpose(rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x));
    vec3 ro_l = mI * (u_camPos - u_position);
    vec3 worldFwd = normalize(-u_camPos);
    vec3 worldRight = normalize(cross(vec3(0, 1, 0), worldFwd));
    vec3 worldUp = cross(worldFwd, worldRight);
    vec3 fwd = mI * worldFwd;
    vec3 right = mI * worldRight;
    vec3 up = mI * worldUp;
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    float resT = -1.0;
    
    if (tBox.y > 0.0) {
        float t = max(0.0, tBox.x);
        
        // --- TEMPORAL REPROJECTION HINT ---
        // 1. Current hit point candidate P_l
        // Since we don't have a hit yet, we project the previous hit point if possible.
        // But simpler: try to project the current fragment UV into the previous frame's screen.
        
        // This is only effective if camera/object motion is small.
        // Project current ray origin/direction into world, then into previous local space.
        mat3 rot = rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x);
        vec3 ro_w = u_position + rot * ro_l;
        vec3 rd_w = rot * rd;
        
        // Previous local space
        mat3 mI_prev = transpose(rotZ(u_prevRot.z) * rotY(u_prevRot.y) * rotX(u_prevRot.x));
        vec3 ro_prev_l = mI_prev * (ro_w - u_prevPosition);
        vec3 rd_prev_l = mI_prev * rd_w;
        
        // Project onto previous camera screen
        vec3 prevCamPos_l = mI_prev * (u_prevCamPos - u_prevPosition);
        vec3 prevFwd_w = normalize(-u_prevCamPos);
        vec3 prevRight_w = normalize(cross(vec3(0, 1, 0), prevFwd_w));
        vec3 prevUp_w = cross(prevFwd_w, prevRight_w);
        
        vec3 fwd_p = mI_prev * prevFwd_w;
        vec3 right_p = mI_prev * prevRight_w;
        vec3 up_p = mI_prev * prevUp_w;
        
        // We want to find where the current ray ro_prev_l + rd_prev_l * t intersects the previous screen plane.
        // Actually, simpler: Sample the previous pre-pass texture at the current FragCoord.
        // If movement is small, the hit distance will be similar.
        vec2 prevUV = gl_FragCoord.xy / (u_resolution * 0.5); // Pre-pass is half-res
        float hintT = texture(u_prevPrepassTex, prevUV).r;
        
        if (hintT > 0.0) {
            // Start raymarch slightly before hint for safety
            t = max(t, hintT - 0.1);
        }

        // Pre-pass uses lower steps and higher epsilon
        const int PRE_STEPS = 20; 
        const float PRE_EPS = 0.02;
        for(int i=0; i<PRE_STEPS; i++) {
            vec3 p = ro_l + rd * t;
            float d = map(p, u_boxSize, u_borderRadius);
            if(d < PRE_EPS) { resT = t; break; }
            t += d * 1.5; // Aggressive stepping for pre-pass
            if(t > tBox.y) break;
        }
    }
    
    // Output hit distance t. -1.0 if miss.
    fragColor = vec4(resT, 0.0, 0.0, 1.0);
}
