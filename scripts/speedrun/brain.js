import { Defend } from '../behaviors/defend.js';
import { Follow } from '../behaviors/follow.js';
import { RESOURCES } from '../behaviors/resources.js';
import { pickThreats } from '../core/combat.js';
import { countItems, factValue } from '../core/types.js';
const fmt = (n) => Math.round(n * 10) / 10;
export class Brain {
    d;
    base = { type: 'idle' };
    active;
    byKind = new Map();
    noDefendUntil = 0;
    deadSince;
    lastRespawnTry = -999;
    adhoc = 0;
    follow = new Follow();
    defend = new Defend();
    constructor(d) {
        this.d = d;
        for (const b of d.behaviors)
            this.byKind.set(b.kind, b);
    }
    get ctx() { return this.d.ctx; }
    // ---- player-facing controls -------------------------------------------------
    followHuman() { this.halt(); this.base = { type: 'follow' }; return 'Following you.'; }
    stop() { this.halt(); this.base = { type: 'idle' }; return 'Stopped. Say !bot resume to continue the run.'; }
    defendMe() {
        this.halt();
        this.base = { type: 'follow' };
        this.noDefendUntil = 0;
        return 'Guarding you: following and engaging hostiles near you.';
    }
    gather(resource, count) {
        if (!RESOURCES[resource])
            return `I can only gather: ${Object.keys(RESOURCES).join(', ')}.`;
        const id = `adhoc-${++this.adhoc}`;
        const spec = {
            id, kind: 'gather_blocks', description: `Gather ${count} ${resource}`, dependsOn: [], preconditions: [], requires: [],
            estimatedSeconds: 20 * count, risk: 0.02, expected: `${count} ${resource} collected`, maxRetries: 1, timeoutTicks: 20 * 60 * 6, params: { resource, count },
        };
        this.d.graph.add(spec);
        this.halt();
        this.base = { type: 'task', taskId: id };
        return `Gathering ${count} ${resource}.`;
    }
    resume() {
        this.halt();
        const g = this.d.graph;
        for (const t of g.all())
            if (t.status === 'failed' || t.status === 'cancelled')
                g.reopen(t.spec.id);
        this.base = { type: 'autopilot' };
        return 'Resuming the speedrun route from the last completed step.';
    }
    status() {
        const s = this.ctx.body.snapshot();
        const hp = factValue(s.health), hunger = factValue(s.hunger), h = factValue(s.human);
        const tasks = this.d.graph.all().filter((t) => !t.spec.id.startsWith('adhoc-'));
        const done = tasks.filter((t) => t.status === 'succeeded').length;
        const logs = countItems(s.inventory, (i) => i.endsWith('_log'));
        return [
            `Mode: ${this.base.type}${this.active ? ` (doing: ${this.active.label})` : ''}${s.alive ? '' : ' [dead]'}`,
            `Pos ${fmt(s.position.x)}, ${fmt(s.position.y)}, ${fmt(s.position.z)} in ${s.dimension.replace('minecraft:', '')} | HP ${hp ?? '?'} | Hunger ${hunger ?? '?'} | Logs ${logs}`,
            `Teammate: ${h ? `${h.name} at ${fmt(h.position.x)}, ${fmt(h.position.y)}, ${fmt(h.position.z)}` : 'not visible'} | Hostiles near: ${s.hostiles.length}`,
            `Route: ${done}/${tasks.length} steps done | ${this.d.telemetry.summary()}`,
        ];
    }
    // ---- tick loop ---------------------------------------------------------------
    tick() {
        const snap = this.ctx.body.snapshot();
        if (!snap.alive) {
            this.onDeath(snap);
            return;
        }
        this.deadSince = undefined;
        if (this.shouldPreemptWithDefend(snap))
            this.startDefend(snap);
        if (this.active)
            this.runActive(snap);
        else
            this.startBase(snap);
    }
    shouldPreemptWithDefend(s) {
        if (!this.ctx.cfg.autoDefend || this.base.type === 'idle' || this.active?.label === 'defend' || s.tick < this.noDefendUntil)
            return false;
        const hp = factValue(s.health);
        if (hp !== undefined && hp <= this.ctx.cfg.combat.retreatHealth)
            return false;
        return pickThreats(s.hostiles, s.position, factValue(s.human)?.position, this.ctx.cfg.combat.threatRadius).length > 0;
    }
    startDefend(s) {
        if (this.active)
            this.interrupt(s.tick);
        this.defend.start(this.ctx);
        this.active = { behavior: this.defend, label: 'defend', since: s.tick };
        this.ctx.log.info('brain.defend_start', { hostiles: s.hostiles.length });
    }
    runActive(s) {
        const a = this.active;
        let res;
        try {
            res = a.behavior.tick(this.ctx);
        }
        catch (e) {
            res = { status: 'failed', reason: `exception: ${e instanceof Error ? e.message : String(e)}` };
            this.ctx.log.error('brain.behavior_exception', { label: a.label, error: String(e) });
        }
        if (res.status === 'running') {
            if (a.taskId && this.d.graph.timedOut(a.taskId, s.tick))
                this.finishFailed(a, 'task timeout', s.tick);
            return;
        }
        if (res.status === 'succeeded') {
            if (a.taskId) {
                this.d.graph.succeed(a.taskId, s.tick);
                this.d.telemetry.record({ id: a.taskId, outcome: 'succeeded', ticks: s.tick - a.since, ...(res.detail ? { detail: res.detail } : {}) });
                this.ctx.body.say(`Done: ${this.d.graph.get(a.taskId).spec.description}${res.detail ? ` (${res.detail})` : ''}.`);
                if (this.base.type === 'task')
                    this.base = { type: 'idle' };
            }
            this.active = undefined;
            return;
        }
        this.finishFailed(a, res.reason, s.tick);
    }
    finishFailed(a, reason, tick) {
        try {
            a.behavior.cancel(this.ctx);
        }
        catch { /* body may be invalid */ }
        this.active = undefined;
        if (!a.taskId) {
            if (a.label === 'defend') {
                this.noDefendUntil = tick + 200;
                this.ctx.body.say(`Backing off: ${reason}.`);
            }
            return;
        }
        const r = this.d.graph.fail(a.taskId, reason, tick);
        this.d.telemetry.record({ id: a.taskId, outcome: 'failed', ticks: tick - a.since, detail: reason });
        if (r === 'retry') {
            this.d.telemetry.bump('retries');
            this.ctx.log.warn('brain.task_retry', { task: a.taskId, reason });
            return;
        }
        this.ctx.body.say(`Giving up on "${this.d.graph.get(a.taskId).spec.description}": ${reason}.`);
        if (this.base.type === 'task')
            this.base = { type: 'idle' };
    }
    startBase(s) {
        switch (this.base.type) {
            case 'idle': return;
            case 'follow':
                this.follow.start();
                this.active = { behavior: this.follow, label: 'follow', since: s.tick };
                return;
            case 'task': {
                const t = this.d.graph.get(this.base.taskId);
                if (!t || t.status !== 'pending') {
                    this.base = { type: 'idle' };
                    return;
                }
                this.startTask(t.spec, s);
                return;
            }
            case 'autopilot': {
                const next = this.d.graph.next(s);
                if (next && this.byKind.has(next.spec.kind)) {
                    this.startTask(next.spec, s);
                    return;
                }
                this.explainAutopilotStop(s);
                this.base = { type: 'idle' };
            }
        }
    }
    startTask(spec, s) {
        const b = this.byKind.get(spec.kind);
        if (!b) {
            this.ctx.body.say(`No executor for "${spec.kind}".`);
            this.base = { type: 'idle' };
            return;
        }
        this.d.graph.start(spec.id, s.tick);
        try {
            b.start(this.ctx, spec.params ?? {});
        }
        catch (e) {
            this.d.graph.fail(spec.id, `start failed: ${e instanceof Error ? e.message : String(e)}`, s.tick);
            this.ctx.log.error('brain.start_failed', { task: spec.id, error: String(e) });
            return;
        }
        this.active = { behavior: b, label: spec.description, taskId: spec.id, since: s.tick };
        this.ctx.log.info('brain.task_start', { task: spec.id });
    }
    explainAutopilotStop(s) {
        const g = this.d.graph;
        const dead = g.deadlocked();
        if (dead.length) {
            this.ctx.body.say(`Route blocked: "${dead[0].spec.description}" depends on a failed step. Use !bot resume to retry.`);
            return;
        }
        const front = g.frontier()[0];
        if (!front) {
            this.ctx.body.say('Route complete.');
            return;
        }
        if (!this.byKind.has(front.spec.kind)) {
            this.ctx.body.say(`Next step is "${front.spec.description}" but that is not implemented yet. Stopping autopilot; you can take this part.`);
            return;
        }
        this.ctx.body.say(`Waiting on: ${g.unmet(front.spec.id, s).join('; ')}.`);
    }
    interrupt(tick) {
        const a = this.active;
        if (!a)
            return;
        try {
            a.behavior.cancel(this.ctx);
        }
        catch { /* ignore */ }
        if (a.taskId) {
            this.d.graph.interrupt(a.taskId);
            this.d.telemetry.record({ id: a.taskId, outcome: 'interrupted', ticks: tick - a.since });
        }
        this.active = undefined;
    }
    halt() { this.interrupt(this.ctx.body.snapshot().tick); }
    onDeath(s) {
        if (this.deadSince === undefined) {
            this.deadSince = s.tick;
            this.d.telemetry.bump('deaths');
            this.ctx.memory.recordDeath({ who: 'bot', pos: s.position, dimension: s.dimension, tick: s.tick });
            this.interrupt(s.tick);
            this.base = { type: 'idle' };
            this.ctx.body.say(`I died near ${fmt(s.position.x)}, ${fmt(s.position.y)}, ${fmt(s.position.z)}. Respawning; say !bot follow or !bot resume.`);
        }
        if (s.tick - this.deadSince >= 40 && s.tick - this.lastRespawnTry >= 40) {
            this.lastRespawnTry = s.tick;
            this.ctx.body.respawn();
        }
    }
}
