import { sortedOffsets } from '../core/spatial.js';
import { dist, keyOf } from '../core/vec.js';
import { RESOURCES } from '../behaviors/resources.js';
import { hazardous } from '../core/safety.js';
export const cell = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
export const center = (p) => ({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
/** Local observed block model, with provenance, TTL and strict work/memory bounds. */
export class Perception {
    cells = new Map();
    visits = new Map();
    failures = new Map();
    hints = new Map();
    dimension;
    origin;
    cursor = 0;
    pass = 0;
    constructor({ radius = 8, probes = 128, maxCells = 8192, ttl = 400 } = {}) {
        this.radius = radius;
        this.probes = probes;
        this.maxCells = maxCells;
        this.ttl = ttl;
        this.offsets = sortedOffsets(radius);
    }
    observe(world, s) {
        if (this.dimension !== s.dimension) {
            this.cells.clear();
            this.visits.clear();
            this.failures.clear();
            this.hints.clear();
            this.lastVisit = undefined;
            this.origin = undefined;
            this.pass = 0;
            this.dimension = s.dimension;
        }
        if (!this.origin || dist(this.origin, s.position) > 3 || this.cursor >= this.offsets.length) {
            if (this.cursor >= this.offsets.length) this.pass++;
            this.origin = cell(s.position);
            this.cursor = 0;
        }
        let reads = 0;
        while (reads < this.probes && this.cursor < this.offsets.length) {
            const o = this.offsets[this.cursor++],
                p = { x: this.origin.x + o.x, y: this.origin.y + o.y, z: this.origin.z + o.z };
            const b = world.blockAt(p);
            this.remember(p, b, s.tick);
            reads++;
        }
        // Novelty is spatial, not proportional to time standing still.
        const key = `${Math.floor(s.position.x / 4)},${Math.floor(s.position.z / 4)}`;
        if (key !== this.lastVisit) {
            this.visits.set(key, (this.visits.get(key) ?? 0) + 1);
            this.lastVisit = key;
        }
        if (this.visits.size > 512) this.visits.delete(this.visits.keys().next().value);
        return reads;
    }
    remember(pos, block, tick) {
        const p = cell(pos),
            key = keyOf(p);
        this.cells.delete(key);
        if (block) {
            const fact = { pos: p, block: { ...block }, tick };
            this.cells.set(key, fact);
            if (
                (!['minecraft:stone', 'minecraft:cobblestone'].includes(block.typeId) &&
                    Object.values(RESOURCES).some((r) => r.blockMatch(block.typeId))) ||
                ['minecraft:crafting_table', 'minecraft:furnace', 'minecraft:lit_furnace'].includes(
                    block.typeId,
                )
            ) {
                this.hints.delete(key);
                this.hints.set(key, fact);
            } else this.hints.delete(key);
        }
        while (this.hints.size > 256) this.hints.delete(this.hints.keys().next().value);
        while (this.cells.size > this.maxCells) this.cells.delete(this.cells.keys().next().value);
    }
    view(now) {
        return {
            blockAt: (p) => {
                const v = this.cells.get(keyOf(cell(p)));
                return v && now - v.tick <= this.ttl && now >= v.tick ? v.block : undefined;
            },
        };
    }
    matches(match, from, tick) {
        return [...this.cells.values()]
            .filter((v) => tick >= v.tick && tick - v.tick <= this.ttl && match(v.block.typeId))
            .sort((a, b) => dist(a.pos, from) - dist(b.pos, from));
    }
    remembered(match, from, tick) {
        return [...this.hints.values()]
            .filter((v) => tick - v.tick <= 12000 && match(v.block.typeId))
            .sort((a, b) => dist(a.pos, from) - dist(b.pos, from));
    }
    resource(kind, from, tick) {
        return this.matches(RESOURCES[kind].blockMatch, from, tick);
    }
    reject(key, tick, reason) {
        const n = (this.failures.get(key)?.count ?? 0) + 1;
        this.failures.set(key, {
            count: n,
            until: tick + Math.min(2400, 200 * 2 ** Math.min(n - 1, 4)),
            reason,
        });
        if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value);
    }
    blocked(key, tick) {
        return (this.failures.get(key)?.until ?? 0) > tick;
    }
    novelty(p) {
        return 1 / (1 + (this.visits.get(`${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`) ?? 0));
    }
    summary(s) {
        let fresh = 0,
            hazards = 0,
            resources = 0;
        for (const v of this.cells.values())
            if (s.tick - v.tick <= this.ttl) {
                fresh++;
                if (hazardous(v.block)) hazards++;
                if (Object.values(RESOURCES).some((r) => r.blockMatch(v.block.typeId))) resources++;
            }
        return {
            dimension: this.dimension,
            known: fresh,
            hazards,
            resources,
            scanned: Math.round((100 * this.cursor) / this.offsets.length),
            failedTargets: this.failures.size,
        };
    }
}
