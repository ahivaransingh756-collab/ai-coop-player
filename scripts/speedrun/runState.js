import { dist } from '../core/vec.js';
import { ROUTE_VERSION } from './graph.js';
export const MARKERS = Object.freeze({ overworld_portal: 'minecraft:portal', nether_portal: 'minecraft:portal', end_portal: 'minecraft:end_portal', rally: undefined });
const DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];
const validPos = p => p && [p.x, p.y, p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 30000000);
export class RunState {
    waypoints = {};
    bearings = [];
    dragonDeath;
    elapsedTicks = 0;
    lastTick;
    splits = [];
    advance(tick, active) {
        if (active && this.lastTick !== undefined) this.elapsedTicks += Math.max(0, Math.min(20, tick - this.lastTick));
        this.lastTick = tick;
    }
    mark(name, pos, dimension) {
        if (!Object.hasOwn(MARKERS, name) || !validPos(pos) || !DIMENSIONS.includes(dimension)) throw new Error('invalid waypoint');
        const expectedDimension = { overworld_portal: 'minecraft:overworld', nether_portal: 'minecraft:nether', end_portal: 'minecraft:overworld' }[name];
        if (expectedDimension && dimension !== expectedDimension) throw new Error(`${name} must be in ${expectedDimension}`);
        this.waypoints[name] = { pos: { ...pos }, dimension };
    }
    verifyPortal(name, snap, world) {
        const t = this.waypoints[name];
        if (!t || t.dimension !== snap.dimension || dist(t.pos, snap.position) > 8) return false;
        return world.blockAt(t.pos)?.typeId === MARKERS[name] && `active ${name} block observed nearby`;
    }
    recordDragonDeath(event, snap, running) {
        if (!running || !snap.alive || event.typeId !== 'minecraft:ender_dragon' || event.dimension !== 'minecraft:the_end' || snap.dimension !== event.dimension || !validPos(event.position) || dist(event.position, snap.position) > 128) return false;
        this.dragonDeath = { tick: snap.tick, position: { ...event.position } };
        return true;
    }
    split(id) {
        if (!this.splits.some(s => s.id === id)) this.splits.push({ id, ticks: this.elapsedTicks });
    }
    serialize(owner, graph) {
        return JSON.stringify({ version: ROUTE_VERSION, owner, progress: Object.fromEntries(Object.entries(graph.exportProgress()).filter(([id]) => !id.startsWith('adhoc-'))), waypoints: this.waypoints, bearings: this.bearings, dragonDeath: this.dragonDeath, elapsedTicks: this.elapsedTicks, splits: this.splits });
    }
    static restore(raw, owner, graph) {
        const run = new RunState();
        if (!raw) return run;
        try {
            const data = JSON.parse(raw);
            if (data.version !== ROUTE_VERSION || data.owner !== owner) return run;
            graph.importProgress(data.progress);
            for (const [name, t] of Object.entries(data.waypoints ?? {})) {
                try { run.mark(name, t.pos, t.dimension); } catch { /* discard invalid waypoint */ }
            }
            if (Number.isSafeInteger(data.elapsedTicks) && data.elapsedTicks >= 0) run.elapsedTicks = data.elapsedTicks;
            run.splits = Array.isArray(data.splits) ? data.splits.filter(s => graph.get(s?.id)?.status === 'succeeded' && Number.isSafeInteger(s.ticks) && s.ticks >= 0).slice(0, 64) : [];
            // Do not restore uncompleted dragon evidence or eye bearings across sessions.
        } catch { /* invalid checkpoint: start safely paused */ }
        return run;
    }
}
