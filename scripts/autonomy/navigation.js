import { hazardous } from '../core/safety.js';
import { dist, keyOf } from '../core/vec.js';
import { cell, center } from './perception.js';
const addY = (p, y) => ({ ...p, y: p.y + y });
export function standable(world, p) {
    const feet = world.blockAt(p),
        head = world.blockAt(addY(p, 1)),
        floor = world.blockAt(addY(p, -1));
    return !!(feet?.air && head?.air && floor?.solid && !hazardous(floor));
}
export function safeStep(world, from, to) {
    if (
        !standable(world, to) ||
        Math.abs(from.x - to.x) + Math.abs(from.z - to.z) !== 1 ||
        Math.abs(from.y - to.y) > 1
    )
        return false;
    if (to.y > from.y && !world.blockAt(addY(from, 2))?.air) return false;
    if (to.y < from.y && !world.blockAt(addY(to, 2))?.air) return false;
    return true;
}
/** BFS on observed stand positions only. No teleport, diagonal corner cuts or blind jumps. */
export function reachable(world, position, maxNodes = 384, radius = 8) {
    const start = cell(position),
        nodes = new Map([[keyOf(start), { pos: start, parent: undefined, steps: 0 }]]),
        queue = [start];
    for (let index = 0; index < queue.length && nodes.size < maxNodes; index++) {
        const from = queue[index];
        for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            for (const dy of [0, 1, -1]) {
                const to = { x: from.x + dx, y: from.y + dy, z: from.z + dz },
                    key = keyOf(to);
                if (Math.hypot(to.x - start.x, to.z - start.z) > radius || Math.abs(to.y - start.y) > 4)
                    continue;
                if (!safeStep(world, from, to)) continue;
                if (!nodes.has(key) && nodes.size < maxNodes) {
                    nodes.set(key, { pos: to, parent: keyOf(from), steps: nodes.get(keyOf(from)).steps + 1 });
                    queue.push(to);
                }
                break;
            }
        }
    }
    return nodes;
}
export function pathTo(nodes, pos) {
    let n = nodes.get(keyOf(cell(pos)));
    if (!n) return undefined;
    const path = [];
    while (n?.parent) {
        path.unshift(center(n.pos));
        n = nodes.get(n.parent);
    }
    return path;
}
export function clearReach(world, from, target, max = 4) {
    const a = { x: from.x, y: from.y + 1.62, z: from.z },
        b = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    const d = dist(a, b);
    if (d > max) return false;
    for (let t = 0.25; t < d; t += 0.25) {
        const p = cell({
            x: a.x + ((b.x - a.x) * t) / d,
            y: a.y + ((b.y - a.y) * t) / d,
            z: a.z + ((b.z - a.z) * t) / d,
        });
        if (keyOf(p) === keyOf(cell(target))) return true;
        const block = world.blockAt(p);
        if (!block || block.solid || block.liquid || hazardous(block)) return false;
    }
    return true;
}
export function approach(nodes, world, target, max = 3.8) {
    return [...nodes.values()]
        .filter((n) => clearReach(world, center(n.pos), target, max))
        .sort((a, b) => a.steps - b.steps)[0];
}
/** Execute one checked edge at a time; invalidate the entire route if terrain changes. */
export class SafeWalk {
    constructor(path, dimension) {
        this.path = path;
        this.dimension = dimension;
        this.index = 0;
        this.lastNav = -Infinity;
        this.progressTick = undefined;
    }
    cancel(ctx) {
        ctx.body.stopMoving();
    }
    tick(ctx, s) {
        if (s.dimension !== this.dimension)
            return { status: 'failed', reason: 'dimension changed during local navigation' };
        if (this.progressTick === undefined) this.progressTick = s.tick;
        while (this.index < this.path.length && dist(s.position, this.path[this.index]) < 0.65) {
            this.index++;
            this.progressTick = s.tick;
            ctx.body.stopMoving();
        }
        if (this.index >= this.path.length) return { status: 'succeeded' };
        const target = this.path[this.index],
            from = cell(s.position),
            to = cell(target);
        if (keyOf(from) !== keyOf(to) && !safeStep(ctx.world, from, to))
            return { status: 'failed', reason: 'next step became unsafe or unknown' };
        if (!standable(ctx.world, to)) return { status: 'failed', reason: 'destination lost support' };
        if (s.tick - this.progressTick > 120)
            return { status: 'failed', reason: 'no progress along safe path' };
        if (s.onGround && s.tick - this.lastNav >= 10) {
            this.lastNav = s.tick;
            if (ctx.body.navigateTo(target, 0.9) === 'failed')
                return { status: 'failed', reason: 'native navigation rejected safe edge' };
        }
        return { status: 'running' };
    }
}
