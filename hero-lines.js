(function() {
"use strict";

// ── Snapshot Data ──
const SNAPSHOT = {"scene":{"camera":{"x":5,"y":4.5,"z":8},"zoom":1,"bgColor":"#1d1d1d","bgColorRgb":[0.11372549019607843,0.11372549019607843,0.11372549019607843],"resolutionScale":0.75},"objects":[{"visible":true,"position":{"x":0,"y":0,"z":0},"dimensions":{"x":2.5,"y":0.8,"z":1.2},"rotation":{"x":0,"y":0,"z":0},"shapeType":"Box","borderRadius":0.1,"orientation":"Horizontal","numLines":30,"thickness":0.01,"speed":0.1,"longevity":0.4,"ease":0.5,"color1":[0.8588235294117647,0.35294117647058826,0],"color2":[0.27058823529411763,0.27058823529411763,0.27058823529411763],"rimColor":[0.06274509803921569,0.06274509803921569,0.06274509803921569],"svgExtrusionDepth":0.5,"rimIntensity":0.4,"rimPower":3,"wireOpacity":0.1,"wireIntensity":0.1,"layerDelay":0.02,"torusThickness":0.2,"lineBrightness":2.5,"bendAmount":0,"bendAngle":0,"bendAxis":"X","bendOffset":0,"bendLimit":1,"compositeMode":"None","secondaryShapeType":"Sphere","secondaryPosition":{"x":0,"y":0,"z":0},"secondaryRotation":{"x":0,"y":0,"z":0},"secondaryDimensions":{"x":0.5,"y":0.5,"z":0.5},"compositeSmoothness":0.1,"enableBackface":true}]};

// ── Vertex Shader ──
const VS_SOURCE = "#version 300 es\nin vec4 position;\nvoid main() { gl_Position = position; }\n";

// ── Fragment Shader ──
const FS_SOURCE = "#version 300 es\n#define EXPORT_MODE\n#define MAX_STEPS 48\n#define MIN_STEPS 16\n#define MAX_BACK_STEPS 24\n#define HIT_EPS 0.003\n#define SIMPLE_BACKFACE_NORMALS\nprecision highp float;\nout vec4 fragColor;\nlayout(std140) uniform SceneData {\n    vec2 u_resolution;\n    float u_time;\n    float _pad0;\n    vec3 u_camPos;\n    vec3 u_bgColor;\n    \n    // Previous Frame Scene State\n    vec2 u_prevResolution;\n    float u_prevTime;\n    float _pad1;\n    vec3 u_prevCamPos;\n    vec3 u_prevBgColor;\n};\n\nlayout(std140) uniform ObjectData {\n    vec3 u_position; float _p1;\n    vec3 u_boxSize;  float _p2;\n    vec3 u_rot;      float _p3;\n    vec3 u_color1;   float _p4;\n    vec3 u_color2;   float _p5;\n    vec3 u_rimColor; float _p6;\n    vec3 u_secondaryPosition; float _p7;\n    mat4 u_secondaryRotMat;\n    vec3 u_secondaryDimensions; float _p9;\n    \n    float u_borderRadius;\n    float u_borderThickness;\n    float u_speed;\n    float u_trailLength;\n    \n    float u_ease;\n    float u_numLines;\n    float u_morphFactor;\n    \n    float u_svgExtrusionDepth;\n    float u_svgSpread;\n    float u_svgResolution;\n    float u_bendAmount;\n    \n    float u_bendAngle;\n    float u_bendOffset;\n    float u_bendLimit;\n    float u_rimIntensity;\n    \n    float u_rimPower;\n    float u_wireOpacity;\n    float u_wireIntensity;\n    float u_layerDelay;\n    \n    float u_torusThickness;\n    float u_lineBrightness;\n    float u_compositeSmoothness;\n    int u_shapeType;\n    \n    int u_shapeTypeNext;\n    int u_orientation;\n    int u_hasSvgSdf;\n    int u_bendAxis;\n    \n    int u_compositeMode;\n    int u_secondaryShapeType;\n    int u_enableBackface;\n    float u_renderBoxMargin; // Added for Task 13\n    \n    vec3 u_renderBoxSize; \n    float u_boundingRadius; // Tier 3 Optimization\n    \n    // Previous Frame Object State\n    vec3 u_prevPosition; float _p10;\n    vec3 u_prevBoxSize;  float _p11;\n    vec3 u_prevRot;      float _p12;\n    \n    int u_maxSteps;\n    int u_maxBackSteps;\n};\n\nuniform sampler2D u_svgSdfTex;\nuniform sampler2D u_prepassTex;\nuniform sampler2D u_prevPrepassTex;\n\nfloat smin(float a, float b, float k) {\n    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);\n    return mix(b, a, h) - k * h * (1.0 - h);\n}\n\n\nmat3 rotX(float a) { float s=sin(a), c=cos(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }\nmat3 rotY(float a) { float s=sin(a), c=cos(a); return mat3(c,0,s, 0,1,0, -s,0,c); }\nmat3 rotZ(float a) { float s=sin(a), c=cos(a); return mat3(c,-s,0, s,c,0, 0,0,1); }\n\nfloat sdSphere(vec3 p, float r) {\n    return length(p) - r;\n}\n\nfloat sdEllipsoid(vec3 p, vec3 r) {\n    float k0 = length(p / r);\n    float k1 = length(p / (r * r));\n    return k0 * (k0 - 1.0) / k1;\n}\n\nfloat sdCone(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    float q = length(p_o.yz / h_o.yz);\n    float taper = 1.0 - clamp(p_o.x / h_o.x, -1.0, 1.0);\n    return max(q - taper, abs(p_o.x) - h_o.x);\n}\n\nfloat sdTorus(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    vec2 q = vec2(length(p_o.yz / h_o.yz) - 1.0, p_o.x / h_o.x);\n    return (length(q) - u_torusThickness) * min(h_o.x, min(h_o.y, h_o.z));\n}\n\nfloat sdCapsule(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    // Radius is the smaller of the two perpendicular axes\n    float r = min(h_o.y, h_o.z);\n    // Half-height of the cylindrical part\n    float hh = max(0.0, h_o.x - r);\n    vec3 pa = p_o - vec3(-hh, 0, 0);\n    vec3 ba = vec3(2.0 * hh, 0, 0);\n    float h_c = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);\n    return length(pa - ba * h_c) - r;\n}\n\nfloat sdCylinder(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    vec2 d = abs(vec2(length(p_o.yz / h_o.yz), p_o.x / h_o.x)) - 1.0;\n    return (min(max(d.x, d.y), 0.0) + length(max(d, 0.0))) * min(h_o.x, min(h_o.y, h_o.z));\n}\n\nfloat sdRoundBox(vec3 p, vec3 b, float r) {\n    vec3 q = abs(p) - b;\n    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;\n}\n\nfloat sdLaptop(vec3 p, vec3 b, float r) {\n    // Base part\n    vec3 baseSize = vec3(b.x, b.y * 0.1, b.z);\n    vec3 basePos = p - vec3(0.0, -b.y * 0.9, 0.0);\n    float base = sdRoundBox(basePos, baseSize, r);\n    \n    // Screen part\n    vec3 screenSize = vec3(b.x, b.y * 0.9, b.y * 0.05);\n    // Move screen origin to hinge\n    vec3 pScreen = p - vec3(0.0, -b.y * 0.8, -b.z + b.y * 0.05);\n    // Rotate screen around X axis (hinge)\n    float angle = -1.1; // ~63 degrees\n    float s = sin(angle), c = cos(angle);\n    pScreen.yz = mat2(c, -s, s, c) * pScreen.yz;\n    // Move screen up from hinge\n    pScreen.y -= b.y * 0.9;\n    \n    float screen = sdRoundBox(pScreen, screenSize, r);\n    \n    return min(base, screen);\n}\n\nvec3 opBend(in vec3 p, in float k, in vec2 bendSC, in int axis, in float offset, in float limit, in float invK) {\n    // Reorient: swizzle p into q where q.y is the bend spine\n    vec3 q = (axis == 0) ? p.yzx : (axis == 2) ? p.xzy : p.xyz;\n    \n    // Rotate around Y to align bend plane\n    float sa = bendSC.x, ca = bendSC.y;\n    q.xz = mat2(ca, -sa, sa, ca) * q.xz;\n    \n    // Apply bending in the XY plane\n    float y = q.y - offset;\n    float theta = k * clamp(y, -limit, limit);\n    float s = sin(theta), c = cos(theta);\n    // Linear property of rotation handles tangents automatically\n    q.xy = mat2(c, -s, s, c) * vec2(q.x - invK, y) + vec2(invK, 0);\n    \n    // Inverse rotate around Y and inverse reorient\n    q.xz = mat2(ca, sa, -sa, ca) * q.xz;\n    return (axis == 0) ? q.zxy : (axis == 2) ? q.yxz : q;\n}\n\nfloat sdSvgExtrude(vec3 p, vec3 boxSize, int orient) {\n    vec2 uv2d; float extAxis; vec2 planeSize;\n    if (orient == 1) { uv2d = p.xz; planeSize = boxSize.xz; extAxis = p.y / max(boxSize.y, 0.001); }\n    else if (orient == 2) { uv2d = p.xy; planeSize = boxSize.xy; extAxis = p.z / max(boxSize.z, 0.001); }\n    else { uv2d = p.yz; planeSize = boxSize.yz; extAxis = p.x / max(boxSize.x, 0.001); }\n    \n    float scaleAxis = max(planeSize.x, planeSize.y);\n    float rawSdf = texture(u_svgSdfTex, (uv2d / scaleAxis) * 0.5 + 0.5).r;\n    float sdf2d = max(rawSdf * (u_svgSpread / u_svgResolution) * scaleAxis, sdRoundBox(vec3(uv2d, 0.0), vec3(planeSize, 1.0), 0.0));\n    return max(sdf2d, (abs(extAxis) - u_svgExtrusionDepth) * max(boxSize.x, max(boxSize.y, boxSize.z)));\n}\n\nfloat getShapeDist(vec3 p, vec3 innerSize, float radius, int shapeType) {\n    switch(shapeType) {\n        case 1: return sdEllipsoid(p, innerSize) - radius;\n        case 2: return sdCone(p, innerSize, u_orientation) - radius;\n        case 3: return sdTorus(p, innerSize, u_orientation) - radius;\n        case 4: return sdCapsule(p, innerSize, u_orientation) - radius;\n        case 5: return sdCylinder(p, innerSize, u_orientation) - radius;\n        case 6: if (u_hasSvgSdf == 1) return sdSvgExtrude(p, innerSize + radius, u_orientation);\n                return sdRoundBox(p, innerSize, radius);\n        case 7: return sdLaptop(p, innerSize, radius);\n        default: return sdRoundBox(p, innerSize, radius);\n    }\n}\n\n\n\n\n\nfloat mapBody(vec3 pBent, vec3 boxSize, float radius, mat3 secRotMat) {\n    vec3 innerSize = max(boxSize - vec3(radius), vec3(0.0001));\n    \n    // Fast path: simple shape\n    if (u_morphFactor <= 0.0 && u_compositeMode == 0) {\n        return getShapeDist(pBent, innerSize, radius, u_shapeType);\n    }\n    \n    // Morphing\n    float d1 = getShapeDist(pBent, innerSize, radius, u_shapeType);\n    if (u_morphFactor > 0.001) {\n        d1 = mix(d1, getShapeDist(pBent, innerSize, radius, u_shapeTypeNext), u_morphFactor);\n    }\n    \n    if (u_compositeMode == 0) return d1;\n\n    // CSG with secondary shape\n    vec3 pSec = (pBent - u_secondaryPosition) * mat3(u_secondaryRotMat);\n    \n    vec3 secInnerSize = max(u_secondaryDimensions - vec3(radius), vec3(0.0001));\n    float d2_box = sdRoundBox(pSec, secInnerSize, radius);\n    \n    // Bounding-volume early exit\n    if (u_compositeMode == 1 && d1 < d2_box) return d1;\n    if (u_compositeMode == 4 && d1 < d2_box - u_compositeSmoothness) return d1;\n    if (u_compositeMode == 2 && d1 > -d2_box && d2_box > 0.01) return d1;\n    if (u_compositeMode == 3 && d1 > d2_box && d2_box > 0.01) return max(d1, d2_box);\n\n    float d2 = getShapeDist(pSec, secInnerSize, radius, u_secondaryShapeType);\n    \n    if (u_compositeMode == 1) return min(d1, d2);\n    if (u_compositeMode == 2) return max(d1, -d2);\n    if (u_compositeMode == 3) return max(d1, d2);\n    if (u_compositeMode == 4) return smin(d1, d2, u_compositeSmoothness);\n    \n    return d1;\n}\n\nfloat map(vec3 p, vec3 boxSize, float radius, vec2 bendSC, float invK) {\n    // Task 10: Skip opBend function call if bend is negligible\n    vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);\n    return mapBody(pBent, boxSize, radius, mat3(0.0)); // Note: mapBody doesn't actually need secRotMat anymore for map if it uses u_secondaryRotMat\n}\n\nvec3 calcNormalBent(vec3 pBent, vec3 boxSize, float radius, float hitD) {\n    const float h = 0.0001;\n    // 3-tap forward difference (reuses current distance 'hitD')\n    return normalize(vec3(\n        mapBody(pBent + vec3(h, 0, 0), boxSize, radius, mat3(0.0)) - hitD,\n        mapBody(pBent + vec3(0, h, 0), boxSize, radius, mat3(0.0)) - hitD,\n        mapBody(pBent + vec3(0, 0, h), boxSize, radius, mat3(0.0)) - hitD\n    ));\n}\n\n// P1-5: Analytical normals — eliminates 3 SDF calls per hit for simple shapes\nvec3 analyticalNormalSphere(vec3 p) {\n    return normalize(p);\n}\n\nvec3 analyticalNormalRoundBox(vec3 p, vec3 b) {\n    // Gradient of sdRoundBox: dominant axis from distance to each face\n    vec3 q = abs(p) - b;\n    vec3 s = sign(p);\n    // Outside region: gradient of length(max(q,0))\n    if (max(q.x, max(q.y, q.z)) > 0.0) {\n        return normalize(s * max(q, vec3(0.0)));\n    }\n    // Inside region: closest face normal\n    if (q.x > q.y && q.x > q.z) return vec3(s.x, 0, 0);\n    if (q.y > q.z) return vec3(0, s.y, 0);\n    return vec3(0, 0, s.z);\n}\n\nvec3 analyticalNormalCylinder(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    \n    vec2 d = abs(vec2(length(p_o.yz / h_o.yz), p_o.x / h_o.x)) - 1.0;\n    \n    vec3 n;\n    if (d.x > d.y) {\n        n = vec3(0.0, normalize(p_o.yz));\n    } else {\n        n = vec3(sign(p_o.x), 0.0, 0.0);\n    }\n    \n    // Reorient normal back\n    return (orient == 1) ? n.yxz : (orient == 2) ? n.zyx : n.xyz;\n}\n\nvec3 analyticalNormalCapsule(vec3 p, vec3 h, int orient) {\n    vec3 p_o = (orient == 1) ? p.yxz : (orient == 2) ? p.zyx : p.xyz;\n    vec3 h_o = (orient == 1) ? h.yxz : (orient == 2) ? h.zyx : h.xyz;\n    float r = min(h_o.y, h_o.z);\n    float hh = max(0.0, h_o.x - r);\n    vec3 pa = p_o - vec3(-hh, 0, 0);\n    vec3 ba = vec3(2.0 * hh, 0, 0);\n    float h_c = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);\n    vec3 n = normalize(pa - ba * h_c);\n    return (orient == 1) ? n.yxz : (orient == 2) ? n.zyx : n.xyz;\n}\n\n\n\nvec2 intersectBox(vec3 ro, vec3 rd, vec3 boxSize) {\n    vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * (boxSize * 2.0); // Wider box for bending/laptop (P1)\n    vec3 t1 = -n - k, t2 = -n + k;\n    float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);\n    return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF);\n}\n\nfloat intersectSphere(vec3 ro, vec3 rd, float r) {\n    float b = dot(ro, rd);\n    float c = dot(ro, ro) - r * r;\n    float h = b * b - c;\n    if (h < 0.0) return -1.0;\n    return -b - sqrt(h);\n}\n\n// P2-2: Precomputed orientation info — eliminates per-pixel uniform branches in shading\nstruct OrientInfo {\n    int sliceAxis;      // 0=x, 1=y, 2=z, 3=diagonal\n    float sliceRange;\n    int p1Axis;         // perimeter axis 1\n    int p2Axis;         // perimeter axis 2\n    vec3 dotDir;        // direction for dotV calculation\n};\n\nOrientInfo buildOrientInfo(vec3 boxSize) {\n    OrientInfo o;\n    if (u_orientation == 1) {\n        o.sliceAxis = 1; o.sliceRange = 2.0 * boxSize.y;\n        o.p1Axis = 0; o.p2Axis = 2;\n        o.dotDir = vec3(0, 1, 0);\n    } else if (u_orientation == 2) {\n        o.sliceAxis = 2; o.sliceRange = 2.0 * boxSize.z;\n        o.p1Axis = 0; o.p2Axis = 1;\n        o.dotDir = vec3(0, 0, 1);\n    } else if (u_orientation == 3) {\n        o.sliceAxis = 3; o.sliceRange = length(2.0 * boxSize);\n        o.p1Axis = 1; o.p2Axis = 2; // default for diagonal\n        o.dotDir = vec3(0.577);\n    } else {\n        o.sliceAxis = 0; o.sliceRange = 2.0 * boxSize.x;\n        o.p1Axis = 1; o.p2Axis = 2;\n        o.dotDir = vec3(1, 0, 0);\n    }\n    return o;\n}\n\nfloat getSliceCoord(vec3 p, OrientInfo oi) {\n    if (oi.sliceAxis == 1) return p.y;\n    if (oi.sliceAxis == 2) return p.z;\n    if (oi.sliceAxis == 3) return (p.x + p.y + p.z) * 0.57735;\n    return p.x;\n}\n\nvec4 getSurfaceColor(vec3 p, vec3 boxSize, float time, float thickness, bool isBack, vec3 n, float ds, OrientInfo oi) {\n    float sliceCoord = getSliceCoord(p, oi);\n    float sliceRange = oi.sliceRange;\n    float norm = clamp((sliceCoord + sliceRange * 0.5) / sliceRange, 0.0, 1.0);\n    float layerIdx = floor(norm * u_numLines), layerGap = sliceRange / (u_numLines + 0.001);\n    float layerCenter = (layerIdx + 0.5) * layerGap - sliceRange * 0.5;\n    float actualThick = min(thickness, layerGap * 0.48);\n    float lineMask = 1.0 - smoothstep(actualThick - ds, actualThick + ds, abs(sliceCoord - layerCenter));\n    vec3 pUse = clamp(p, -boxSize, boxSize);\n    // Index-driven perimeter axis selection (replaces orientation branches)\n    float p1 = (oi.p1Axis == 0) ? pUse.x : (oi.p1Axis == 1) ? pUse.y : pUse.z;\n    float p2 = (oi.p2Axis == 0) ? pUse.x : (oi.p2Axis == 1) ? pUse.y : pUse.z;\n    float b1 = (oi.p1Axis == 0) ? boxSize.x : (oi.p1Axis == 1) ? boxSize.y : boxSize.z;\n    float b2 = (oi.p2Axis == 0) ? boxSize.x : (oi.p2Axis == 1) ? boxSize.y : boxSize.z;\n    float perimeter = (abs(p2 * b1) > abs(p1 * b2)) ? ((p2 > 0.0) ? (b1 + p1) : (3.0 * b1 + 2.0 * b2 - p1)) : ((p1 > 0.0) ? (2.0 * b1 + b2 - p2) : (4.0 * b1 + 3.0 * b2 + p2));\n    \n    float progress = mod(time * u_speed - layerIdx * u_layerDelay, 3.0);\n    float dist = fract(progress - (perimeter / (4.0 * (b1 + b2) + 0.001)));\n    float isActive = (dist < u_trailLength) ? pow(smoothstep(0.0, max(0.01, u_ease), 1.0 - abs(1.0 - (dist / u_trailLength) * 2.0)), 1.5) : 0.0;\n    \n    float dotV = abs(dot(n, oi.dotDir));\n    float lineAlpha = lineMask * isActive * smoothstep(0.1, 0.4, 1.0 - dotV);\n    \n    vec3 wireColor = vec3(0);\n    if (u_shapeType == 0 && u_wireIntensity > 0.0) {\n        wireColor = u_color1 * u_wireIntensity * max(max((1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.y) - boxSize.y))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z)))), (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.x) - boxSize.x))) * (1.0 - smoothstep(thickness * 2.5 - ds, thickness * 2.5 + ds, abs(abs(p.z) - boxSize.z))));\n    }\n    float wireAlpha = (length(wireColor) > 0.001) ? u_wireOpacity : 0.0;\n\n    vec3 baseColor = mix(u_color1, u_color2, isActive);\n    float totalAlpha = clamp(lineAlpha + wireAlpha, 0.0, 1.0);\n    vec3 finalRGB = baseColor * lineAlpha + wireColor;\n    \n    float boost = isBack ? 1.0 : u_lineBrightness;\n    return vec4(finalRGB * boost, totalAlpha * (isBack ? 0.5 : 1.0));\n}\n\n#ifndef MAX_STEPS\n#define MAX_STEPS 48\n#endif\n\n#ifndef MIN_STEPS\n#define MIN_STEPS 16\n#endif\n\n#ifndef MAX_BACK_STEPS\n#define MAX_BACK_STEPS 24\n#endif\n\n#ifndef HIT_EPS\n#define HIT_EPS 0.003\n#endif\n\nvec4 render(vec3 ro_l, vec3 rd, vec2 bendSC, float invK, OrientInfo oi) {\n    // Tier 3 Optimization: Ray-Sphere Early-Out\n    float tSphere = intersectSphere(ro_l, rd, u_boundingRadius);\n    if (tSphere < 0.0 && length(ro_l) > u_boundingRadius) return vec4(0.0);\n\n    vec2 tBox = intersectBox(ro_l, rd, u_boxSize);\n    vec3 col = vec3(0.0);\n    float alpha = 0.0;\n    \n    if (tBox.y > 0.0) {\n        float t = max(0.0, tBox.x); bool hit = false; vec3 p;\n        \n        // Task 11: Half-resolution pre-pass early exit\n        #ifndef EXPORT_MODE\n        vec2 screenUV = gl_FragCoord.xy / u_resolution;\n        float prepassT = texture(u_prepassTex, screenUV).r;\n        if (prepassT < 0.0) return vec4(0.0); // Pre-pass missed, absolute skip\n        \n        // Start raymarching slightly before the pre-pass hit point for safety\n        t = max(t, prepassT - 0.05);\n        #endif\n\n        float lastD = 1e10;\n        float finalD = 0.0;\n        for(int i=0; i<MAX_STEPS; i++) { \n            if (i >= u_maxSteps) break;\n            // Simple shapes converge faster, reduce front-pass steps (P1 Optimization)\n            if (u_compositeMode == 0 && u_morphFactor <= 0.0 && i >= MIN_STEPS) break;\n\n            p = ro_l + rd * t; \n            float d = map(p, u_boxSize, u_borderRadius, bendSC, invK); \n            \n            float adaptiveEps = HIT_EPS * (1.0 + t * 0.05);\n            if(d < adaptiveEps) { hit = true; finalD = d; break; } \n            \n            // Task 8: Distance-based step acceleration\n            float stepScale = (d > 0.1 && d >= lastD) ? 1.5 : 1.0;\n            t += d * stepScale; \n            lastD = d;\n            \n            if(t > tBox.y) break; \n        }\n        if(hit) { \n            vec3 pBent = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);\n            \n            // P1-5: Use analytical normals for simple unbent shapes (saves 3 SDF calls)\n            vec3 n;\n            if (u_compositeMode == 0 && u_morphFactor <= 0.0 && abs(u_bendAmount) < 0.001) {\n                vec3 innerSize = max(u_boxSize - vec3(u_borderRadius), vec3(0.0001));\n                if (u_shapeType == 1) n = analyticalNormalSphere(pBent);\n                else if (u_shapeType == 0) n = analyticalNormalRoundBox(pBent, innerSize);\n                else if (u_shapeType == 5) n = analyticalNormalCylinder(pBent, innerSize, u_orientation);\n                else if (u_shapeType == 4) n = analyticalNormalCapsule(pBent, innerSize, u_orientation);\n                else n = calcNormalBent(pBent, u_boxSize, u_borderRadius, finalD);\n            } else {\n                n = calcNormalBent(pBent, u_boxSize, u_borderRadius, finalD);\n            }\n\n            \n            float rim = pow(1.0 - max(dot(-rd, n), 0.0), u_rimPower) * u_rimIntensity;\n            vec3 rimRGB = u_rimColor * rim;\n            \n            float ds = fwidth(getSliceCoord(pBent, oi));\n            vec4 surface = getSurfaceColor(pBent, u_boxSize, u_time, u_borderThickness, false, n, ds, oi);\n            col = surface.rgb + rimRGB;\n            alpha = surface.a + rim;\n            \n            if (u_enableBackface == 1 && alpha < 0.99) {\n                vec3 ro_b = ro_l + rd * tBox.y, rd_b = -rd; float tb = 0.0; hit = false;\n                float lastDb = 1e10;\n                float finalDb = 0.0;\n                for(int i=0; i<MAX_BACK_STEPS; i++) { \n                    if (i >= u_maxBackSteps) break;\n                    // Simple shapes converge faster, reduce back-pass steps (P1 Optimization)\n                    if (u_compositeMode == 0 && i >= MIN_STEPS) break;\n                    \n                    p = ro_b + rd_b * tb; \n                    float d = map(p, u_boxSize, u_borderRadius, bendSC, invK); \n                    \n                    float adaptiveEps = HIT_EPS * (1.0 + tb * 0.05);\n                    if(d < adaptiveEps) { hit = true; finalDb = d; break; } \n                    \n                    // Task 8: Distance-based step acceleration\n                    float stepScale = (d > 0.1 && d >= lastDb) ? 1.5 : 1.0;\n                    tb += d * stepScale; \n                    lastDb = d;\n                    \n                    if(tb > (tBox.y - tBox.x + 0.1)) break; \n                }\n                if(hit) {\n                    vec3 pBentB = (abs(u_bendAmount) < 0.001) ? p : opBend(p, u_bendAmount, bendSC, u_bendAxis, u_bendOffset, u_bendLimit, invK);\n                    \n                    #ifdef SIMPLE_BACKFACE_NORMALS\n                    vec3 nB = -rd;\n                    #else\n                    vec3 nB = calcNormalBent(pBentB, u_boxSize, u_borderRadius, finalDb);\n                    #endif\n\n                    \n                    vec4 surfaceBack = getSurfaceColor(pBentB, u_boxSize, u_time, u_borderThickness, true, nB, ds, oi);\n                    col += surfaceBack.rgb * (1.0 - alpha); \n                    alpha += surfaceBack.a * (1.0 - alpha);\n                }\n            }\n        }\n    }\n    return vec4(col, alpha);\n}\n\nvoid main() {\n    vec2 uv = (gl_FragCoord.xy - u_resolution.xy * 0.5) / (length(u_resolution.xy) * 0.35355);\n    mat3 mI = transpose(rotZ(u_rot.z) * rotY(u_rot.y) * rotX(u_rot.x));\n    \n    vec3 ro_l = mI * (u_camPos - u_position);\n    \n    vec3 worldFwd = normalize(-u_camPos);\n    vec3 worldRight = normalize(cross(vec3(0, 1, 0), worldFwd));\n    vec3 worldUp = cross(worldFwd, worldRight);\n\n    vec3 fwd = mI * worldFwd;\n    vec3 right = mI * worldRight;\n    vec3 up = mI * worldUp;\n    \n    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);\n\n    // Precompute invariants\n    float a = u_bendAngle * 0.01745329;\n    vec2 bendSC = vec2(sin(a), cos(a));\n    float invK = 1.0 / max(u_bendAmount, 0.0001);\n    OrientInfo oi = buildOrientInfo(u_boxSize);\n    \n    vec4 res = render(ro_l, rd, bendSC, invK, oi);\n    \n    fragColor = vec4(res.rgb, res.a);\n}\n";

// ── SVG SDF Module ──


// ── Renderer ──

const DEG_TO_RAD = Math.PI / 180;

const SHAPE_MAP = { Box: 0, Sphere: 1, Cone: 2, Torus: 3, Capsule: 4, Cylinder: 5, SVG: 6, Laptop: 7 };
const ORIENT_MAP = { Horizontal: 0, Vertical: 1, Depth: 2, Diagonal: 3 };
const BEND_AXIS_MAP = { X: 0, Y: 1, Z: 2 };
const COMPOSITE_MAP = { None: 0, Union: 1, Subtract: 2, Intersect: 3, SmoothUnion: 4 };

// Math Helpers
function mul3(A, B) {
    const R = new Array(9);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            R[r*3+c] = A[r*3+0]*B[0*3+c] + A[r*3+1]*B[1*3+c] + A[r*3+2]*B[2*3+c];
    return R;
}
function mv(m, v) { return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]]; }
function vadd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function norm(v) { const l = Math.sqrt(dot(v,v)); return [v[0]/l, v[1]/l, v[2]/l]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

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

// Compute a screen-space scissor rect for an object to avoid shading pixels outside its bounds.
// Returns {x, y, w, h} in WebGL bottom-left coords, or null to use full screen.
function calculateScissorRect(scene, obj, width, height) {
    const iz = 1.0 / scene.zoom;
    const camPos = [scene.camera.x * iz, scene.camera.y * iz, scene.camera.z * iz];

    // Build inverse model rotation (transpose of rotZ * rotY * rotX)
    const rx = obj._rotRad[0], ry = obj._rotRad[1], rz = obj._rotRad[2];
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);

    // rotX
    const RX = [1,0,0, 0,cx,-sx, 0,sx,cx];
    // rotY
    const RY = [cy,0,sy, 0,1,0, -sy,0,cy];
    // rotZ
    const RZ = [cz,-sz,0, sz,cz,0, 0,0,1];

    // M = rotZ * rotY * rotX  (column-major 3x3 as flat array)
    const M = mul3(mul3(RZ, RY), RX);
    // mI = transpose(M)
    const mI = [M[0],M[3],M[6], M[1],M[4],M[7], M[2],M[5],M[8]];

    const ro_l = mv(mI, sub(camPos, [obj.position.x, obj.position.y, obj.position.z]));

    const worldFwd = norm([-camPos[0], -camPos[1], -camPos[2]]);
    const upBase = [0, 1, 0];
    let worldRight = norm(cross(upBase, worldFwd));
    if (Math.abs(dot(upBase, worldFwd)) > 0.99) worldRight = norm(cross([1,0,0], worldFwd));
    const worldUp = cross(worldFwd, worldRight);

    const fwd   = norm(mv(mI, worldFwd));
    const right = norm(mv(mI, worldRight));
    const up    = norm(mv(mI, worldUp));

    // Task 7: Adaptive margin
    const margin = (Math.abs(obj.bendAmount) < 0.05 && (obj.compositeMode === 'None' || obj._compositeMode === 0)) ? 1.2 : 2.0;
    const b = [obj.dimensions.x * margin, obj.dimensions.y * margin, obj.dimensions.z * margin];
    const signs = [-1, 1];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const bx of signs) for (const by of signs) for (const bz of signs) {
        const p_obj = [bx*b[0], by*b[1], bz*b[2]];
        const v = sub(p_obj, ro_l);
        const dist = dot(v, fwd);
        if (dist < 0.1) return null;
        const uvX = dot(v, right) / dist;
        const uvY = dot(v, up) / dist;
        const diag = Math.sqrt(width * width + height * height) * 0.35355;
        const px = uvX * diag + 0.5 * width;
        const py = uvY * diag + 0.5 * height;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    }

    const pad = 10;
    const x = Math.max(0, Math.floor(minX - pad));
    const y = Math.max(0, Math.floor(minY - pad));
    const w = Math.min(width,  Math.ceil(maxX + pad)) - x;
    const h = Math.min(height, Math.ceil(maxY + pad)) - y;
    return { x, y, w, h };
}

function hexToRgb(hex) {
    if (!hex) return [0,0,0];
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
}

function initSnapshot(canvas, snapshot, vsSource, fsSource, svgSdfModule, resolutionScale) {
    resolutionScale = resolutionScale || 1.0;
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

    // Setup UBOs
    const sceneData = new Float32Array(24);
    const objectData = new Float32Array(112); // Task Tier 3: increased for boundingRadius
    const objectDataInt = new Int32Array(objectData.buffer);

    let sceneUbo = null;
    const sceneBlockIndex = gl.getUniformBlockIndex(program, 'SceneData');
    if (sceneBlockIndex !== 0xFFFFFFFF) {
        gl.uniformBlockBinding(program, sceneBlockIndex, 0);
        sceneUbo = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, sceneUbo);
    }

    let objectUbo = null;
    const objectBlockIndex = gl.getUniformBlockIndex(program, 'ObjectData');
    if (objectBlockIndex !== 0xFFFFFFFF) {
        gl.uniformBlockBinding(program, objectBlockIndex, 1);
        objectUbo = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, objectUbo);
        gl.bufferData(gl.UNIFORM_BUFFER, objectData.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, objectUbo);
    }

    // Cache sampler location
    const svgTexLoc = gl.getUniformLocation(program, 'u_svgSdfTex');

    // Fullscreen quad — stored in a VAO to avoid re-validating attribute state each draw
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);

    // Set program and clear color once — they never change
    gl.useProgram(program);
    const bg = hexToRgb(snapshot.scene.bgColor);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);

    // SVG SDF texture state
    let svgSdfTexture = null;
    let svgSdfResolution = 0;
    let svgSdfReady = false;

    // Check if any object needs SVG SDF
    const svgObj = snapshot.objects.find(o => o.visible && o.shapeType === 'SVG' && o.svgData && o.svgData.svgString);
    if (svgObj && svgSdfModule) {
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

    // Pre-normalize objects: compute rotation in radians and resolve optional fields once.
    // This avoids per-frame fallback object creation (|| {x:0,y:0,z:0}) and DEG_TO_RAD math
    // for fields that never change.
    const objects = snapshot.objects.filter(o => o.visible).map(o => {
        const sp = o.secondaryPosition   || { x: 0, y: 0, z: 0 };
        const sr = o.secondaryRotation   || { x: 0, y: 0, z: 0 };
        const sd = o.secondaryDimensions || { x: 1, y: 1, z: 1 };
        return {
            ...o,
            // Pre-converted rotation in radians
            _rotRad: [
                (o.rotation.x || 0) * DEG_TO_RAD,
                (o.rotation.y || 0) * DEG_TO_RAD,
                (o.rotation.z || 0) * DEG_TO_RAD,
            ],
            // Resolved secondary fields
            _spx: sp.x, _spy: sp.y, _spz: sp.z,
            _srx: sr.x * DEG_TO_RAD, _sry: sr.y * DEG_TO_RAD, _srz: sr.z * DEG_TO_RAD,
            _sdx: sd.x, _sdy: sd.y, _sdz: sd.z,
            // Resolved scalar defaults
            borderRadius:        o.borderRadius        || 0,
            thickness:           o.thickness           || 0.05,
            speed:               o.speed               || 1,
            longevity:           o.longevity           || 0.5,
            ease:                o.ease                || 0.1,
            numLines:            o.numLines            || 10,
            timeNoise:           o.timeNoise           || 0,
            svgExtrusionDepth:   o.svgExtrusionDepth   || 0.5,
            bendAmount:          o.bendAmount          || 0,
            bendAngle:           o.bendAngle           || 0,
            bendOffset:          o.bendOffset          || 0,
            bendLimit:           o.bendLimit           || 10,
            rimIntensity:        o.rimIntensity        || 0.4,
            rimPower:            o.rimPower            || 3.0,
            wireOpacity:         o.wireOpacity         || 0.1,
            wireIntensity:       o.wireIntensity       || 0.1,
            layerDelay:          o.layerDelay          || 0.02,
            torusThickness:      o.torusThickness      || 0.2,
            lineBrightness:      o.lineBrightness      || 2.5,
            compositeSmoothness: o.compositeSmoothness || 0.1,
            // Pre-resolved integer enum values
            _shapeType:          SHAPE_MAP[o.shapeType]          || 0,
            _orientType:         ORIENT_MAP[o.orientation]       || 0,
            _bendAxis:           BEND_AXIS_MAP[o.bendAxis]       || 1,
            _compositeMode:      COMPOSITE_MAP[o.compositeMode]  || 0,
            _secondaryShapeType: SHAPE_MAP[o.secondaryShapeType] || 1,
            enableBackface:      o.enableBackface === undefined  || o.enableBackface,
        };
    });

    const scene = snapshot.scene;
    const iz = 1.0 / scene.zoom;

    let paused = false;
    let rafId = 0;

    function render(now) {
        if (paused) return;

        gl.clear(gl.COLOR_BUFFER_BIT);

        // Update Scene UBO
        sceneData[0] = gl.canvas.width;
        sceneData[1] = gl.canvas.height;
        sceneData[2] = now * 0.001;
        sceneData[4] = scene.camera.x * iz;
        sceneData[5] = scene.camera.y * iz;
        sceneData[6] = scene.camera.z * iz;
        sceneData[8] = bg[0];
        sceneData[9] = bg[1];
        sceneData[10] = bg[2];

        if (sceneUbo) {
            gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, sceneData);
        }

        gl.bindVertexArray(vao);

        objects.forEach(obj => {
            // Fill Object UBO Data
            objectData[0] = obj.position.x;
            objectData[1] = obj.position.y;
            objectData[2] = obj.position.z;

            objectData[4] = obj.dimensions.x;
            objectData[5] = obj.dimensions.y;
            objectData[6] = obj.dimensions.z;

            // Pre-converted radians — no DEG_TO_RAD multiply per frame
            objectData[8]  = obj._rotRad[0];
            objectData[9]  = obj._rotRad[1];
            objectData[10] = obj._rotRad[2];

            // Pre-converted [r,g,b] arrays — no hexToRgb per frame
            objectData[12] = obj.color1[0];
            objectData[13] = obj.color1[1];
            objectData[14] = obj.color1[2];

            objectData[16] = obj.color2[0];
            objectData[17] = obj.color2[1];
            objectData[18] = obj.color2[2];

            objectData[20] = obj.rimColor[0];
            objectData[21] = obj.rimColor[1];
            objectData[22] = obj.rimColor[2];

            objectData[24] = obj._spx;
            objectData[25] = obj._spy;
            objectData[26] = obj._spz;

            // Compute secondary rotation matrix on CPU
            const sx = Math.sin(obj._srx), cx = Math.cos(obj._srx);
            const sy = Math.sin(obj._sry), cy = Math.cos(obj._sry);
            const sz = Math.sin(obj._srz), cz = Math.cos(obj._srz);
            const secRot = mul3(mul3([cz,-sz,0, sz,cz,0, 0,0,1], [cy,0,sy, 0,1,0, -sy,0,cy]), [1,0,0, 0,cx,-sx, 0,sx,cx]);

            // Column 0
            objectData[28] = secRot[0];
            objectData[29] = secRot[1];
            objectData[30] = secRot[2];
            objectData[31] = 0;
            // Column 1
            objectData[32] = secRot[3];
            objectData[33] = secRot[4];
            objectData[34] = secRot[5];
            objectData[35] = 0;
            // Column 2
            objectData[36] = secRot[6];
            objectData[37] = secRot[7];
            objectData[38] = secRot[8];
            objectData[39] = 0;
            // Column 3
            objectData[40] = 0;
            objectData[41] = 0;
            objectData[42] = 0;
            objectData[43] = 1;

            objectData[44] = obj._sdx;
            objectData[45] = obj._sdy;
            objectData[46] = obj._sdz;

            // Floats (starting at index 48)
            objectData[48] = obj.borderRadius;
            objectData[49] = obj.thickness;
            objectData[50] = obj.speed;
            objectData[51] = obj.longevity;

            objectData[52] = obj.ease;
            objectData[53] = obj.numLines;
            objectData[54] = 0; // morphFactor
            objectData[55] = obj.svgExtrusionDepth;
            objectData[56] = 32; // SDF_SPREAD
            objectData[57] = svgSdfResolution;
            objectData[58] = obj.bendAmount;

            objectData[59] = obj.bendAngle;
            objectData[60] = obj.bendOffset;
            objectData[61] = obj.bendLimit;
            objectData[62] = obj.rimIntensity;

            objectData[63] = obj.rimPower;
            objectData[64] = obj.wireOpacity;
            objectData[65] = obj.wireIntensity;
            objectData[66] = obj.layerDelay;

            objectData[67] = obj.torusThickness;
            objectData[68] = obj.lineBrightness;
            objectData[69] = obj.compositeSmoothness;

            // Pre-resolved integer enums
            objectDataInt[70] = obj._shapeType; 
            objectDataInt[71] = obj._shapeType; // shapeTypeNext
            objectDataInt[72] = obj._orientType; 

            const needsSvg = obj.shapeType === 'SVG';
            objectDataInt[73] = (needsSvg && svgSdfReady && svgSdfTexture) ? 1 : 0; 
            objectDataInt[74] = obj._bendAxis; 
            objectDataInt[75] = obj._compositeMode; 
            objectDataInt[76] = obj._secondaryShapeType; 
            objectDataInt[77] = obj.enableBackface ? 1 : 0; 

            // Adaptive Step Count (P2 Optimization)
            const camPos = [sceneData[4], sceneData[5], sceneData[6]];
            const objPos = [obj.position.x, obj.position.y, obj.position.z];
            const dist = Math.sqrt(
                (camPos[0] - objPos[0])**2 + 
                (camPos[1] - objPos[1])**2 + 
                (camPos[2] - objPos[2])**2
            );
            
            const baseSteps = 48; // match #define in standalone.html.ts
            const baseBackSteps = 24;
            const minSteps = 16;
            
            const complexity = (obj.compositeMode !== 'None' || obj.morphFactor > 0.01) ? 1.5 : 1.0;
            const morphPenalty = (obj.morphFactor > 0.01) ? 0.65 : 1.0; 
            const maxSteps = Math.max(minSteps, Math.floor(baseSteps * morphPenalty / (1.0 + Math.max(0, dist - 10.0) * 0.05 * complexity)));
            const maxBackSteps = Math.max(minSteps, Math.floor(baseBackSteps * morphPenalty / (1.0 + Math.max(0, dist - 10.0) * 0.05 * complexity)));

            objectDataInt[96] = maxSteps;
            objectDataInt[97] = maxBackSteps;

            // Task 7 & 13: Adaptive margin and combined bounds
            const margin = (Math.abs(obj.bendAmount) < 0.05 && (obj.compositeMode === 'None' || obj._compositeMode === 0)) ? 1.2 : 2.0;
            objectData[78] = margin;

            let rbX = obj.dimensions.x, rbY = obj.dimensions.y, rbZ = obj.dimensions.z;
            if (obj._compositeMode !== 0) {
                const sx = Math.sin(obj._srx), cx = Math.cos(obj._srx);
                const sy = Math.sin(obj._sry), cy = Math.cos(obj._sry);
                const sz = Math.sin(obj._srz), cz = Math.cos(obj._srz);
                const RX = [1,0,0, 0,cx,-sx, 0,sx,cx];
                const RY = [cy,0,sy, 0,1,0, -sy,0,cy];
                const RZ = [cz,-sz,0, sz,cz,0, 0,0,1];
                const rot = mul3(mul3(RZ, RY), RX);
                const sd = [obj._sdx, obj._sdy, obj._sdz];
                const sp = [obj._spx, obj._spy, obj._spz];
                const signs = [-1, 1];
                for (const bx of signs) for (const by of signs) for (const bz of signs) {
                    const p = vadd(sp, mv(rot, [bx*sd[0], by*sd[1], bz*sd[2]]));
                    rbX = Math.max(rbX, Math.abs(p[0]));
                    rbY = Math.max(rbY, Math.abs(p[1]));
                    rbZ = Math.max(rbZ, Math.abs(p[2]));
                }
            }
            objectData[80] = rbX;
            objectData[81] = rbY;
            objectData[82] = rbZ;

            // Bounding Volume Early-Out (Tier 3 Optimization)
            const bendFactor = 1.0 + Math.abs(obj.bendAmount) * 2.5;
            const diagonal = Math.sqrt(rbX * rbX + rbY * rbY + rbZ * rbZ) + obj.borderRadius;
            objectData[83] = diagonal * margin * bendFactor * 1.5;

            if (objectUbo) {
                gl.bindBuffer(gl.UNIFORM_BUFFER, objectUbo);
                gl.bufferSubData(gl.UNIFORM_BUFFER, 0, objectData);
            }

            if (needsSvg && svgSdfReady && svgSdfTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, svgSdfTexture);
                if (svgTexLoc) gl.uniform1i(svgTexLoc, 0);
            }

            // Scissor test temporarily disabled for debugging bounds logic
            gl.scissor(0, 0, gl.canvas.width, gl.canvas.height);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });

        gl.bindVertexArray(null);
        rafId = requestAnimationFrame(render);
    }

    function resize() {
        const width = canvas.clientWidth || window.innerWidth;
        const height = canvas.clientHeight || window.innerHeight;
        const dpr = (window.devicePixelRatio || 1) * resolutionScale;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
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
            gl.deleteVertexArray(vao);
            if (svgSdfTexture) gl.deleteTexture(svgSdfTexture);
        }
    };
}


class HeroLinesSnapshot extends HTMLElement {
    constructor() {
        super();
        this._renderer = null;
        this._ro = null;
    }

    connectedCallback() {
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; background: #1d1d1d; }
                canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
            </style>
            <canvas></canvas>
        `;
        const canvas = shadow.querySelector('canvas');
        this._renderer = initSnapshot(canvas, SNAPSHOT, VS_SOURCE, FS_SOURCE, null, SNAPSHOT.scene.resolutionScale || 0.75);
        if (!this._renderer) return;

        this._ro = new ResizeObserver(() => this._renderer.resize());
        this._ro.observe(this);
        this._renderer.start();
    }

    disconnectedCallback() {
        if (this._ro) this._ro.disconnect();
        if (this._renderer) this._renderer.dispose();
    }

    static get observedAttributes() { return ['paused']; }

    attributeChangedCallback(name, _old, val) {
        if (name === 'paused' && this._renderer) {
            this._renderer.paused = (val !== null);
        }
    }
}

if (!customElements.get('hero-lines-snapshot')) {
    customElements.define('hero-lines-snapshot', HeroLinesSnapshot);
}
})();
