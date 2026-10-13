import { Perception, cell, center } from './perception.js';
import { reachable, approach, pathTo, standable } from './navigation.js';
import { planNext } from './planner.js';
import { Action } from './actions.js';
import { Eat } from '../behaviors/eat.js';
import { factValue } from '../core/types.js';
import { foodPoints, canExcavate, hazardous } from '../core/safety.js';
import { RESOURCES } from '../behaviors/resources.js';
import { PREY, RECIPES } from './recipes.js';
import { dist, keyOf } from '../core/vec.js';
const keyFor = (j) =>
    `${j.kind}:${j.resource ?? j.recipe ?? j.item ?? j.input ?? ''}:${j.entityId ?? (j.target ? keyOf(cell(j.target)) : '')}`;
/** Explainable closed-loop controller. Supported goal: an autonomous Overworld production kit. */
export class AutonomousController {
    constructor(ctx) {
        this.ctx = ctx;
        this.model = new Perception();
        this.state = 'idle';
        this.history = [];
        this.deaths = 0;
        this.nextPlan = 0;
        this.lastMessage = -Infinity;
        this.noProgressSince = undefined;
    }
    start() {
        if (this.ctx.body.production?.fault) return `Cannot start: ${this.ctx.body.production.fault}`;
        if (!this.ctx.body.production) return 'Production adapter unavailable.';
        this.ctx.body.production.enabled = true;
        this.state = 'running';
        this.reason = 'Observing terrain before choosing a safe action';
        this.nextPlan = 0;
        this.noProgressSince = undefined;
        this.blockedSince = undefined;
        this.deadSince = undefined;
        this.deaths = 0;
        this.plan = undefined;
        this.healSince = undefined;
        this.noEatUntil = 0;
        this.decisions = 0;
        this.explorations = 0;
        this.model = new Perception();
        return 'Autonomous Overworld mode started (MODDED ingredient-consuming crafting + real furnace). Goal: food and iron kit, not an autonomous dragon kill. Use !bot why / !bot surroundings / !bot stop.';
    }
    stop() {
        this.active?.cancel(this.ctx);
        this.active = undefined;
        this.state = 'idle';
        if (this.ctx.body.production) this.ctx.body.production.enabled = false;
    }
    note(s, kind, reason) {
        this.reason = reason;
        this.history.push({ tick: s.tick, kind, reason });
        if (this.history.length > 64) this.history.shift();
        this.ctx.log.info('auto.decision', { tick: s.tick, kind, reason });
    }
    why() {
        return [
            `Autonomy: ${this.state} | ${this.reason ?? 'not started'}`,
            `Action: ${this.active?.job?.kind ?? (this.active instanceof Eat ? 'eat' : 'none')} | Decisions ${this.decisions ?? 0} | Explorations ${this.explorations ?? 0} | Deaths ${this.deaths}`,
            ...(this.plan?.trace ?? []).slice(-6).map((t) => `Because: ${t}`),
        ];
    }
    surroundings(s) {
        const m = this.model.summary(s);
        return [
            `Observed ${m.known} fresh blocks in ${m.dimension ?? 'unknown'}; ${m.resources} resource blocks; ${m.hazards} hazard blocks. Scan ${m.scanned}%.`,
            `Known terrain only; ${m.failedTargets} remembered failed targets. Unloaded/expired blocks are unknown. This is a local map, not omniscient navigation.`,
        ];
    }
    env(s, nodes) {
        const stations = {},
            view = this.model.view(s.tick);
        for (const id of ['crafting_table', 'furnace']) {
            const candidates = this.model.remembered(
                (type) =>
                    type === `minecraft:${id}` || (id === 'furnace' && type === 'minecraft:lit_furnace'),
                s.position,
                s.tick,
            );
            for (const c of candidates) {
                if (id === 'furnace' && !this.ctx.body.production.furnaceState(c.pos)) continue;
                stations[id] = c.pos;
                break;
            }
        }
        return {
            stations,
            furnace: stations.furnace ? this.ctx.body.production.furnaceState(stations.furnace) : undefined,
            hasGravel: this.model
                .resource('gravel', s.position, s.tick)
                .some((c) => approach(nodes, view, c.pos)),
        };
    }
    toward(target, s, nodes, reason) {
        const candidates = [...nodes.values()]
            .filter((n) => n.steps > 0 && dist(center(n.pos), target) < dist(s.position, target) - 0.5)
            .sort(
                (a, b) =>
                    dist(center(a.pos), target) +
                    a.steps * 0.05 -
                    (dist(center(b.pos), target) + b.steps * 0.05),
            );
        for (const n of candidates) {
            const job = { kind: 'walk', target: center(n.pos), path: pathTo(nodes, n.pos), reason };
            if (!this.model.blocked(keyFor(job), s.tick)) return job;
        }
    }
    resolve(job, s, nodes, env) {
        const view = this.model.view(s.tick),
            withPath = (target, n, extra = {}) => ({ ...job, ...extra, target, path: pathTo(nodes, n.pos) });
        if (job.kind === 'craft' || job.kind === 'smelt') {
            const name = job.kind === 'smelt' ? 'furnace' : RECIPES[job.recipe]?.station;
            if (!name) return { ...job, path: [] };
            const target = env.stations[name],
                n = target && approach(nodes, view, target);
            return n
                ? withPath(target, n)
                : target
                  ? this.toward(target, s, nodes, `Return toward remembered ${name}; reverify it before use`)
                  : undefined;
        }
        if (job.kind === 'harvest') {
            for (const c of this.model.resource(job.resource, s.position, s.tick)) {
                const n = approach(nodes, view, c.pos);
                if (!n) continue;
                const candidate = withPath(c.pos, n);
                if (!this.model.blocked(keyFor(candidate), s.tick) && canExcavate(view, c.pos, center(n.pos)))
                    return candidate;
            }
        }
        if (job.kind === 'harvest') {
            for (const c of this.model.remembered(RESOURCES[job.resource].blockMatch, s.position, s.tick)) {
                const candidate = { ...job, target: c.pos };
                if (this.model.blocked(keyFor(candidate), s.tick)) continue;
                const move = this.toward(
                    c.pos,
                    s,
                    nodes,
                    `Revisit remembered ${job.resource}; old sightings are hints, not current proof`,
                );
                if (move) return move;
            }
        }
        if (job.kind === 'place') {
            for (const n of [...nodes.values()].sort((a, b) => a.steps - b.steps)) {
                if (n.steps < 1 || n.steps > 4) continue;
                const target = n.pos;
                if (!standable(view, target) || dist(center(target), s.position) < 1.2) continue;
                // Place from a nearby reachable cell, never replace the bot's own floor/head space.
                const from = approach(nodes, view, target, 3.5);
                if (!from || keyOf(from.pos) === keyOf(target)) continue;
                const candidate = withPath(target, from);
                if (!this.model.blocked(keyFor(candidate), s.tick)) return candidate;
            }
        }
        if (job.kind === 'hunt') {
            for (const animal of this.ctx.world.animalsNear?.(s.position, 12) ?? []) {
                if (!PREY[animal.typeId] || animal.baby || animal.protected) continue;
                const n = [...nodes.values()]
                    .filter((n) => dist(center(n.pos), animal.position) < 2.6)
                    .sort((a, b) => a.steps - b.steps)[0];
                if (!n) continue;
                const candidate = withPath(cell(animal.position), n, {
                    entityId: animal.id,
                    drop: PREY[animal.typeId],
                });
                if (!this.model.blocked(keyFor(candidate), s.tick)) return candidate;
            }
        }
        return undefined;
    }
    explore(s, nodes, threats = []) {
        const candidates = [...nodes.values()]
            .filter((n) => n.steps >= 3 && n.steps <= 14)
            .map((n) => {
                const p = center(n.pos),
                    clearance = threats.length ? Math.min(...threats.map((t) => dist(p, t.position))) : 0;
                return {
                    n,
                    score: threats.length
                        ? clearance - n.steps * 0.08
                        : this.model.novelty(p) * 10 + dist(p, s.position) * 0.4 - n.steps * 0.1,
                };
            })
            .sort((a, b) => b.score - a.score);
        for (const { n } of candidates) {
            const job = {
                kind: threats.length ? 'retreat' : 'walk',
                target: center(n.pos),
                path: pathTo(nodes, n.pos),
                reason: threats.length
                    ? 'Increase separation from observed danger'
                    : 'Explore reachable, less-visited terrain to discover missing resources',
            };
            if (
                threats.length &&
                Math.min(...threats.map((t) => dist(job.target, t.position))) <=
                    Math.min(...threats.map((t) => dist(s.position, t.position))) + 1
            )
                continue;
            // Do not route within four blocks of a threat, unless already closer at the start.
            if (
                threats.length &&
                job.path.some((p) =>
                    threats.some((t) => dist(p, t.position) < Math.min(4, dist(s.position, t.position))),
                )
            )
                continue;
            if (!this.model.blocked(keyFor(job), s.tick)) return job;
        }
    }
    launch(job, s) {
        this.active = new Action(job, s);
        this.decisions++;
        this.note(s, job.kind, job.reason);
    }
    block(s, reason) {
        this.state = 'blocked';
        this.active?.cancel(this.ctx);
        this.active = undefined;
        this.note(s, 'blocked', reason);
        this.ctx.body.say(`Autonomy paused safely: ${reason}`);
        this.ctx.body.production.enabled = false;
    }
    tick(s) {
        if (this.state !== 'running') return;
        if (this.ctx.body.production.fault) {
            this.block(s, this.ctx.body.production.fault);
            return;
        }
        if (!s.alive) {
            if (this.deadSince === undefined) {
                this.deadSince = s.tick;
                this.active?.cancel(this.ctx);
                this.active = undefined;
                this.deaths++;
                this.note(s, 'death', 'Will respawn and replan from actual surviving inventory');
            }
            if (this.deaths >= 3) {
                this.block(s, 'Three deaths in this autonomy session; stopping the death loop');
                return;
            }
            if (s.tick - this.deadSince >= 40 && (s.tick - this.deadSince) % 40 === 0)
                this.ctx.body.respawn();
            return;
        }
        if (this.deadSince !== undefined) {
            this.deadSince = undefined;
            this.model = new Perception();
            this.nextPlan = s.tick;
            this.noProgressSince = s.tick;
        }
        this.model.observe(this.ctx.world, s);
        if (this.noProgressSince === undefined) this.noProgressSince = s.tick;
        if (s.tick - this.noProgressSince > 12000) {
            this.block(s, 'No productive action for 10 game minutes; exploration budget exhausted');
            return;
        }
        if (s.dimension !== 'minecraft:overworld') {
            this.block(s, 'Unsupported autonomous dimension; use the co-op route for Nether/End');
            return;
        }
        const hp = factValue(s.health),
            hunger = factValue(s.hunger);
        if (hp === undefined) {
            this.block(s, 'Health is unknown; refusing blind survival actions');
            return;
        }
        const feet = cell(s.position),
            hazard =
                hazardous(this.ctx.world.blockAt(feet)) ||
                hazardous(this.ctx.world.blockAt({ ...feet, y: feet.y - 1 }));
        const threats = s.hostiles.filter(
            (t) =>
                ![
                    'minecraft:enderman',
                    'minecraft:piglin',
                    'minecraft:zombie_pigman',
                    'minecraft:zombified_piglin',
                ].includes(t.typeId) && dist(t.position, s.position) < 7,
        );
        if (hazard) threats.push({ id: 'local-hazard', typeId: 'hazard', position: { ...s.position } });
        if (threats.length && (hazard || s.tick >= this.nextPlan) && this.active?.job?.kind !== 'retreat') {
            this.active?.cancel(this.ctx);
            this.active = undefined;
            const escape = this.explore(s, reachable(this.model.view(s.tick), s.position), threats);
            if (escape) {
                this.launch(escape, s);
                this.nextPlan = s.tick + 20;
            } else {
                this.block(s, 'Threat nearby and no observed safe escape; refusing a blind charge');
                return;
            }
        }
        if (
            !threats.length &&
            !(this.active instanceof Eat) &&
            hunger !== undefined &&
            (hunger <= 14 || (hp <= 10 && hunger < 20)) &&
            foodPoints(s.inventory) > 0 &&
            s.tick >= (this.noEatUntil ?? 0)
        ) {
            this.active?.cancel(this.ctx);
            this.active = new Eat();
            this.active.start(this.ctx);
            this.note(s, 'eat', 'Hunger/health takes priority over production');
        }
        if (hp <= 6 && !(this.active instanceof Eat) && this.active?.job?.kind !== 'retreat') {
            this.active?.cancel(this.ctx);
            this.active = undefined;
            if (this.healSince === undefined) {
                this.healSince = s.tick;
                this.note(
                    s,
                    'heal',
                    'Critical health: staying still for regeneration instead of continuing work',
                );
            }
            if (s.tick - this.healSince > 1200)
                this.block(s, 'Health did not recover within the healing budget');
            return;
        }
        this.healSince = undefined;
        if (this.active) {
            let result;
            try {
                result = this.active.tick(this.ctx, s, this.model);
            } catch (e) {
                result = { status: 'failed', reason: String(e) };
            }
            if (result.status === 'running') return;
            const job = this.active.job;
            this.active.cancel(this.ctx);
            this.active = undefined;
            if (result.status === 'failed') {
                if (result.reason.includes('inventory space')) {
                    this.block(s, result.reason + '; refusing to discard gear automatically');
                    return;
                }
                if (job) this.model.reject(keyFor(job), s.tick, result.reason);
                else this.noEatUntil = s.tick + 200;
                this.note(s, 'failure', result.reason);
                this.nextPlan = s.tick + 20;
            } else if (job && !['walk', 'retreat'].includes(job.kind)) {
                this.noProgressSince = s.tick;
                this.explorations = 0;
                this.note(s, 'verified', result.detail ?? job.kind);
            }
            return;
        }
        if (s.tick < this.nextPlan) return;
        this.nextPlan = s.tick + 20;
        const nodes = reachable(this.model.view(s.tick), s.position),
            env = this.env(s, nodes);
        this.plan = planNext(s, env);
        if (this.plan.kind === 'blocked') {
            this.block(s, this.plan.reason);
            return;
        }
        if (this.plan.kind === 'complete') {
            this.state = 'complete';
            this.ctx.body.production.enabled = false;
            this.note(s, 'complete', this.plan.reason);
            this.ctx.body.say(this.plan.reason);
            return;
        }
        // Reclaim reachable dropped materials before acquiring replacements.
        for (const d of this.ctx.world.droppedItemsNear(s.position, 6)) {
            if (
                !/minecraft:(.*_log|.*_planks|.*_pickaxe|.*_sword|raw_iron|iron_ingot|coal|flint|gravel|cobblestone|stick|bread|cooked_.*)$/.test(
                    d.typeId,
                )
            )
                continue;
            const path = pathTo(nodes, d.position),
                job = {
                    kind: 'recover',
                    item: d.typeId,
                    target: cell(d.position),
                    path,
                    reason: 'Recover observed dropped supplies before replacing them',
                };
            if (path && !this.model.blocked(keyFor(job), s.tick)) {
                this.launch(job, s);
                return;
            }
        }
        const job = this.resolve(this.plan, s, nodes, env);
        if (job && !this.model.blocked(keyFor(job), s.tick)) {
            this.launch(job, s);
            return;
        }
        // Wait for at least one full local scan before leaving an apparently empty area.
        if (this.model.pass < 1) {
            this.reason = `Scanning: ${this.plan.reason}`;
            return;
        }
        const move = this.explore(s, nodes);
        if (move) {
            this.explorations++;
            this.launch(move, s);
            return;
        }
        this.reason = `No safe reachable target yet: ${this.plan.reason}`;
        if (s.tick - this.lastMessage >= 600) {
            this.lastMessage = s.tick;
            this.ctx.body.say(this.reason);
        }
    }
}
