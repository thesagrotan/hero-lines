import { ObjectTimelineRow } from '../types';

export function interpolateProperty(
    rows: ObjectTimelineRow[],
    objectId: string,
    property: string,
    time: number,
    defaultValue: any
): any {
    const row = rows.find(r => r.objectId === objectId && r.property === property);
    if (!row || !row.actions.length) return defaultValue;

    const actions = [...row.actions].sort((a, b) => a.start - b.start);

    if (time <= actions[0].start) return actions[0].data.value;
    if (time >= actions[actions.length - 1].start) return actions[actions.length - 1].data.value;

    for (let i = 0; i < actions.length - 1; i++) {
        const a1 = actions[i];
        const a2 = actions[i + 1];

        if (time >= a1.start && time <= a2.start) {
            const t = (time - a1.start) / (a2.start - a1.start);
            const v1 = a1.data.value;
            const v2 = a2.data.value;

            if (typeof v1 === 'number' && typeof v2 === 'number') {
                return v1 + (v2 - v1) * t;
            }

            if (typeof v1 === 'string' && v1.startsWith('#') && typeof v2 === 'string' && v2.startsWith('#')) {
                const h2r = (hex: string) => [
                    parseInt(hex.slice(1, 3), 16),
                    parseInt(hex.slice(3, 5), 16),
                    parseInt(hex.slice(5, 7), 16)
                ];
                const r1 = h2r(v1);
                const r2 = h2r(v2);
                const res = r1.map((c, idx) => Math.round(c + (r2[idx] - c) * t));
                return `#${res.map(c => c.toString(16).padStart(2, '0')).join('')}`;
            }

            return v1;
        }
    }

    return defaultValue;
}
