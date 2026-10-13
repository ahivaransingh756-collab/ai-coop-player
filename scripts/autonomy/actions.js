import { RESOURCES } from '../behaviors/resources.js';
import { countItems } from '../core/types.js';
import { canExcavate } from '../core/safety.js';
import { dist } from '../core/vec.js';
import { COOKING, PREY } from './recipes.js';
import { reachable, pathTo, SafeWalk, clearReach } from './navigation.js';
import { cell, center } from './perception.js';
const running = { status: 'running' };
const fail = (reason) => ({ status: 'failed', reason });
/** One bounded action, with a checked approach, real effects and evidence-based completion. */
export class Action {
    constructor(job, s) {
        this.job = job;
        this.started = s.tick;
        this.dimension = s.dimension;
        this.baseline = { ...s.inventory };
        this.walk = job.path?.length ? new SafeWalk(job.path, s.dimension) : undefined;
        this.lastAct = -Infinity;
        this.issued = false;
        this.lastTarget = job.target;
    }
    cancel(ctx) {
        ctx.body.stopMoving();
        ctx.body.stopBreaking();
        ctx.body.stopUsingItem();
    }
    gain(s, match) {
        return countItems(s.inventory, match) > countItems(this.baseline, match);
    }
    pickup(ctx, s, model, match, around = this.lastTarget ?? s.position) {
        const drops = ctx.world.droppedItemsNear(around, 6).filter((d) => match(d.typeId));
        const nodes = reachable(model.view(s.tick), s.position);
        for (const drop of drops.sort(
            (a, b) => dist(a.position, s.position) - dist(b.position, s.position),
        )) {
            if (dist(drop.position, s.position) < 1.2) return running;
            const path = pathTo(nodes, drop.position);
            if (path?.length) {
                this.walk = new SafeWalk(path, s.dimension);
                return running;
            }
        }
        return running;
    }
    tick(ctx, s, model) {
        const j = this.job;
        if (s.dimension !== this.dimension) return fail('dimension changed');
        if (s.tick - this.started > (j.kind === 'smelt' ? 1800 : 1200)) return fail(`${j.kind} timed out`);
        // Check inventory before following a stale pickup path.
        if (
            j.kind === 'harvest' &&
            this.gain(
                s,
                (id) =>
                    RESOURCES[j.resource].itemMatch(id) ||
                    (j.resource === 'gravel' && id === 'minecraft:flint'),
            )
        )
            return { status: 'succeeded', detail: 'physical resource pickup observed' };
        if (j.kind === 'hunt' && this.gain(s, (id) => id === j.drop || id === COOKING[j.drop]))
            return { status: 'succeeded', detail: 'food drop collected' };
        if (j.kind === 'recover' && this.gain(s, (id) => id === j.item))
            return { status: 'succeeded', detail: 'dropped supply recovered' };
        if (this.walk) {
            const r = this.walk.tick(ctx, s);
            if (r.status !== 'succeeded') return r;
            this.walk = undefined;
            ctx.body.stopMoving();
        }
        if (j.kind === 'walk' || j.kind === 'retreat') return { status: 'succeeded', detail: j.reason };
        if (j.kind === 'recover') return this.pickup(ctx, s, model, (id) => id === j.item, j.target);
        if (j.kind === 'craft') {
            const result = ctx.body.production.craft(j.recipe, j.target);
            return result.ok
                ? { status: 'succeeded', detail: `assisted recipe ${j.recipe} committed` }
                : fail(result.reason);
        }
        if (j.kind === 'place') {
            const b = ctx.world.blockAt(j.target);
            if (
                this.issued &&
                b?.typeId === j.item &&
                (s.inventory[j.item] ?? 0) < (this.baseline[j.item] ?? 0)
            ) {
                if (j.item === 'minecraft:furnace') ctx.body.production.ownFurnace(j.target);
                model.remember(j.target, b, s.tick);
                return { status: 'succeeded', detail: `native placement of ${j.item} verified` };
            }
            if (this.issued)
                return s.tick - this.lastAct > 40
                    ? fail('placement did not consume item and create block')
                    : running;
            this.issued = true;
            this.lastAct = s.tick;
            return ctx.body.production.place(j.item, j.target) ? running : fail('native placement rejected');
        }
        if (j.kind === 'smelt') {
            const output = COOKING[j.input];
            if (!output) return fail('unrecognized furnace recipe');
            if (this.gain(s, (id) => id === output))
                return { status: 'succeeded', detail: 'engine-smelted output transferred to inventory' };
            if (s.tick - this.lastAct >= 20) {
                this.lastAct = s.tick;
                const result = ctx.body.production.serviceFurnace(j.target, j.input);
                if (!result.ok) return fail(result.reason);
            }
            return running;
        }
        if (j.kind === 'harvest') {
            const b = ctx.world.blockAt(j.target),
                def = RESOURCES[j.resource];
            if (!b) return fail('resource chunk became unavailable');
            if (b.air) {
                ctx.body.stopBreaking();
                model.remember(j.target, b, s.tick);
                return this.pickup(
                    ctx,
                    s,
                    model,
                    (id) => def.itemMatch(id) || (j.resource === 'gravel' && id === 'minecraft:flint'),
                    j.target,
                );
            }
            if (!def.blockMatch(b.typeId)) return fail('resource changed before harvest');
            if (!clearReach(ctx.world, s.position, j.target) || !canExcavate(ctx.world, j.target, s.position))
                return fail('resource no longer reachable/safe');
            if (def.tier && !ctx.body.equipPickaxe(def.tier))
                return fail('required pickaxe missing or broken');
            if (!this.issued) {
                ctx.body.lookAt({
                    ...j.target,
                    x: j.target.x + 0.5,
                    y: j.target.y + 0.5,
                    z: j.target.z + 0.5,
                });
                if (!ctx.body.breakBlock(j.target)) return fail('break request rejected');
                this.issued = true;
            }
            return running;
        }
        if (j.kind === 'hunt') {
            const animal = ctx.body.entityInfo(j.entityId);
            if (!animal || !animal.alive)
                return this.pickup(ctx, s, model, (id) => id === j.drop || id === COOKING[j.drop]);
            if (animal.dimension !== s.dimension || !PREY[animal.typeId] || animal.baby || animal.protected)
                return fail('animal is no longer a valid target');
            this.lastTarget = animal.position;
            if (dist(s.position, animal.position) > 2.8) {
                const nodes = reachable(model.view(s.tick), s.position),
                    target = [...nodes.values()]
                        .filter((n) => dist(center(n.pos), animal.position) < 2.5)
                        .sort((a, b) => a.steps - b.steps)[0];
                const path = target && pathTo(nodes, target.pos);
                if (!path?.length) return fail('animal moved beyond known safe terrain');
                this.walk = new SafeWalk(path, s.dimension);
                return running;
            }
            if (!clearReach(ctx.world, s.position, cell(animal.position), 3.5))
                return fail('animal obscured by terrain');
            if (s.tick - this.lastAct >= 12) {
                this.lastAct = s.tick;
                ctx.body.equipBestWeapon();
                ctx.body.lookAt(animal.position);
                ctx.body.attackEntity(j.entityId);
            }
            return running;
        }
        return fail(`unsupported action ${j.kind}`);
    }
}
