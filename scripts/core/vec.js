export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const floorVec = (a) => v3(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
export const keyOf = (a) => `${Math.floor(a.x)},${Math.floor(a.y)},${Math.floor(a.z)}`;
/** Point `d` blocks from `target` toward `from` (used to stop short of a target). */
export function pointToward(target, from, d) {
    const len = dist(target, from);
    if (len <= d || len === 0)
        return from;
    const k = d / len;
    return v3(target.x + (from.x - target.x) * k, target.y + (from.y - target.y) * k, target.z + (from.z - target.z) * k);
}
