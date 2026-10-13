const cache = new Map();
/**
 * All integer offsets within a sphere of `radius`, sorted nearest-first.
 * Scanning blocks in this order means the first match is the Euclidean-nearest one.
 */
export function sortedOffsets(radius) {
    const hit = cache.get(radius);
    if (hit)
        return hit;
    const out = [];
    const r2 = radius * radius;
    for (let x = -radius; x <= radius; x++)
        for (let y = -radius; y <= radius; y++)
            for (let z = -radius; z <= radius; z++) {
                const d = x * x + y * y + z * z;
                if (d <= r2)
                    out.push({ o: { x, y, z }, d });
            }
    out.sort((a, b) => a.d - b.d);
    const res = out.map((e) => e.o);
    cache.set(radius, res);
    return res;
}
