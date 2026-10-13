import { dist, keyOf } from './vec.js';
const MAX_SIGHTINGS = 150;
/**
 * Observations (resources) go stale and carry a tick; persistent facts (portals, deaths) do not expire.
 * Nothing here is "known" unless the bot observed it.
 */
export class WorldMemory {
    resources = new Map();
    failures = new Map();
    portals = [];
    deaths = [];
    rememberResource(kind, pos, dimension, tick) {
        this.resources.set(`${dimension}|${kind}|${keyOf(pos)}`, { kind, pos, dimension, tick });
        if (this.resources.size > MAX_SIGHTINGS) {
            const oldest = [...this.resources.entries()].sort((a, b) => a[1].tick - b[1].tick)[0];
            if (oldest)
                this.resources.delete(oldest[0]);
        }
    }
    forgetResource(kind, pos, dimension) { this.resources.delete(`${dimension}|${kind}|${keyOf(pos)}`); }
    nearestResource(kind, from, dimension, nowTick, maxAgeTicks) {
        let best;
        for (const s of this.resources.values()) {
            if (s.kind !== kind || s.dimension !== dimension || nowTick - s.tick > maxAgeTicks)
                continue;
            if (!best || dist(s.pos, from) < dist(best.pos, from))
                best = s;
        }
        return best;
    }
    resourceCount(kind) { return [...this.resources.values()].filter((s) => s.kind === kind).length; }
    recordFailure(key, tick) {
        const c = (this.failures.get(key)?.c ?? 0) + 1;
        this.failures.set(key, { c, t: tick });
        return c;
    }
    failureCount(key) { return this.failures.get(key)?.c ?? 0; }
    recordPortal(pos, dimension, tick) { this.portals.push({ kind: 'portal', pos, dimension, tick }); }
    portalsIn(dimension) { return this.portals.filter((p) => p.dimension === dimension); }
    recordDeath(d) { this.deaths.push(d); if (this.deaths.length > 20)
        this.deaths.shift(); }
    lastDeath(who) { return [...this.deaths].reverse().find((d) => d.who === who); }
    serialize() {
        const s = { r: [...this.resources.values()], f: Object.fromEntries(this.failures), p: this.portals, d: this.deaths };
        return JSON.stringify(s);
    }
    static deserialize(json) {
        const m = new WorldMemory();
        if (!json)
            return m;
        try {
            const s = JSON.parse(json);
            for (const r of s.r ?? [])
                m.rememberResource(r.kind, r.pos, r.dimension, r.tick);
            for (const [k, v] of Object.entries(s.f ?? {}))
                m.failures.set(k, v);
            m.portals = s.p ?? [];
            m.deaths = s.d ?? [];
        }
        catch { /* corrupt memory is discarded rather than trusted */ }
        return m;
    }
}
