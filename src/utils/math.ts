export type Vec3 = [number, number, number];

export const vec3 = {
    sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a: Vec3, b: Vec3): Vec3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ],
    normalize: (a: Vec3): Vec3 => {
        const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
    },
    multiplyScalar: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
    add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
};

export type Mat3 = [
    number, number, number,
    number, number, number,
    number, number, number
];

/**
 * Basic Mat3 math for WebGL scissoring and bounds calculation.
 * Matrices are Column-Major (standard for WebGL/GLSL).
 */
export const mat3 = {
    identity: (): Mat3 => [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1
    ],
    rotateX: (a: number): Mat3 => {
        const s = Math.sin(a), c = Math.cos(a);
        return [
            1, 0, 0,
            0, c, s,
            0, -s, c
        ];
    },
    rotateY: (a: number): Mat3 => {
        const s = Math.sin(a), c = Math.cos(a);
        return [
            c, 0, -s,
            0, 1, 0,
            s, 0, c
        ];
    },
    rotateZ: (a: number): Mat3 => {
        const s = Math.sin(a), c = Math.cos(a);
        return [
            c, s, 0,
            -s, c, 0,
            0, 0, 1
        ];
    },
    multiply: (a: Mat3, b: Mat3): Mat3 => {
        const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as Mat3;
        for (let c = 0; c < 3; c++) {
            for (let r = 0; r < 3; r++) {
                out[c * 3 + r] =
                    a[0 * 3 + r] * b[c * 3 + 0] +
                    a[1 * 3 + r] * b[c * 3 + 1] +
                    a[2 * 3 + r] * b[c * 3 + 2];
            }
        }
        return out;
    },
    transpose: (a: Mat3): Mat3 => [
        a[0], a[3], a[6],
        a[1], a[4], a[7],
        a[2], a[5], a[8]
    ],
    multiplyVec: (m: Mat3, v: Vec3): Vec3 => [
        m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
        m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
        m[2] * v[0] + m[5] * v[1] + m[8] * v[2]
    ]
};
