#version 300 es
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
uniform int u_shapeTypeNext;
uniform float u_morphFactor;
uniform int u_orientation;
uniform vec3 u_bgColor;
uniform vec3 u_position;
uniform float u_timeNoise;
uniform sampler2D u_svgSdfTex;
uniform float u_svgExtrusionDepth;
uniform int u_hasSvgSdf;
uniform float u_svgSpread;
uniform float u_svgResolution;
uniform float u_bendAmount;
uniform float u_bendAngle;
uniform float u_bendOffset;
uniform float u_bendLimit;
uniform int u_bendAxis;
uniform float u_rimIntensity;
uniform float u_rimPower;
uniform float u_wireOpacity;
uniform float u_wireIntensity;
uniform float u_layerDelay;
uniform float u_torusThickness;
uniform float u_lineBrightness;
uniform float u_wobbleAmount;
uniform float u_wobbleSpeed;
uniform float u_wobbleScale;
uniform float u_chromaticAberration;
uniform float u_pulseIntensity;
uniform float u_pulseSpeed;
uniform float u_scanlineIntensity;

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
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
    
    return sdRoundBox(p, innerSize, radius);
}



float map(vec3 p, vec3 boxSize, float radius) {
    vec3 pBent = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
    
    // Apply Pulse
    float pulse = 1.0 + sin(u_time * u_pulseSpeed) * u_pulseIntensity;
    vec3 pScaled = pBent / pulse;
    
    float d1 = getShapeDist(pScaled, boxSize, radius, u_shapeType);
    float d;
    if (u_morphFactor <= 0.0) {
        d = d1;
    } else {
        float d2 = getShapeDist(pScaled, boxSize, radius, u_shapeTypeNext);
        d = mix(d1, d2, u_morphFactor);
    }
    
    // Apply scale compensation for distance field
    d *= pulse;
    
    // Apply Wobble
    if (u_wobbleAmount > 0.0) {
        float w = noise(pBent * u_wobbleScale + u_time * u_wobbleSpeed) * u_wobbleAmount;
        d += w;
    }
    
    return d;
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
    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * (boxSize * 1.5); // Wider box to account for effects
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);
}

vec4 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack) {
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
    vec3 n = calcNormal(p, boxSize, u_borderRadius);
    float dotV = (u_orientation == 1) ? abs(n.y) : (u_orientation == 2) ? abs(n.z) : (u_orientation == 3) ? abs(dot(n, vec3(0.577))) : abs(n.x);
    float lineAlpha = lineMask * isActive * smoothstep(0.1, 0.4, 1.0 - dotV);
    
    vec3 wireColor = (u_shapeType == 0) ? u_color1 * u_wireIntensity * max(max((1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z)))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z)))) : vec3(0);
    float wireAlpha = (length(wireColor) > 0.001) ? u_wireOpacity : 0.0;

    vec3 baseColor = mix(u_color1, u_color2, isActive);
    float totalAlpha = clamp(lineAlpha + wireAlpha, 0.0, 1.0);
    vec3 finalRGB = baseColor * lineAlpha + wireColor;
    
    float boost = isBack ? 1.0 : u_lineBrightness;
    return vec4(finalRGB * boost, totalAlpha * (isBack ? 0.5 : 1.0));
}

vec3 render(vec3 ro, vec3 rd, vec3 ro_l, float tFar) {
    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    
    if (tBox.x > 0.0) {
        float t = tBox.x; bool hit = false; vec3 p;
        for(int i=0; i<64; i++) { 
            p = ro_l + rd * t; 
            float d = map(p, u_boxSize, u_borderRadius); 
            if(d < 0.001) { hit = true; break; } 
            t += d; 
            if(t > tBox.y) break; 
        }
        if(hit) { 
            vec3 pBent = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
            vec4 surface = getSurfaceColor(pBent, u_boxSize, u_time, u_borderThickness, false);
            vec3 n = calcNormal(pBent, u_boxSize, u_borderRadius);
            float rim = pow(1.0 - max(dot(-rd, n), 0.0), u_rimPower) * u_rimIntensity;
            vec3 rimRGB = u_rimColor * rim;
            
            col += surface.rgb + rimRGB;
            alpha += surface.a + rim;
        }
        
        vec3 ro_b = ro_l + rd * tBox.y, rd_b = -rd; float tb = 0.0; hit = false;
        for(int i=0; i<64; i++) { 
            p = ro_b + rd_b * tb; 
            float d = map(p, u_boxSize, u_borderRadius); 
            if(d < 0.001) { hit = true; break; } 
            tb += d; 
            if(tb > (tBox.y - tBox.x)) break; 
        }
        if(hit) {
            vec3 pBentB = opBend(p, u_bendAmount, u_bendAngle, u_bendAxis, u_bendOffset, u_bendLimit);
            vec4 surfaceBack = getSurfaceColor(pBentB, u_boxSize, u_time, u_borderThickness, true);
            col += surfaceBack.rgb * (1.0 - alpha); 
            alpha += surfaceBack.a * (1.0 - alpha);
        }
    }
    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    mat3 mI = transpose(rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x));
    
    vec3 ro_l = mI * (u_camPos - u_position);
    vec3 fwd = normalize(mI * -u_camPos); 
    vec3 right = normalize(cross(vec3(0, 1, 0), fwd)), up = cross(fwd, right);
    
    vec3 finalCol;
    if (u_chromaticAberration > 0.0) {
        vec3 rdR = normalize(fwd + (uv.x + u_chromaticAberration) * right + uv.y * up);
        vec3 rdG = normalize(fwd + uv.x * right + uv.y * up);
        vec3 rdB = normalize(fwd + (uv.x - u_chromaticAberration) * right + uv.y * up);
        
        finalCol.r = render(vec3(0), rdR, ro_l, 20.0).r;
        finalCol.g = render(vec3(0), rdG, ro_l, 20.0).g;
        finalCol.b = render(vec3(0), rdB, ro_l, 20.0).b;
    } else {
        vec3 rd = normalize(fwd + uv.x * right + uv.y * up);
        finalCol = render(vec3(0), rd, ro_l, 20.0);
    }
    
    // Apply Scanlines
    if (u_scanlineIntensity > 0.0) {
        float s = sin(gl_FragCoord.y * 1.5) * 0.5 + 0.5;
        finalCol *= mix(1.0, s, u_scanlineIntensity * 0.5);
    }
    
    fragColor = vec4(finalCol, 1.0);
}
