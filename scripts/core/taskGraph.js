import { countItems } from './types.js';
const RISK_WEIGHT = { aggressive: 0.5, casual: 1, support: 1.5, balanced: 2, safe: 4 };
export class TaskGraph {
    profile;
    tasks = new Map();
    constructor(profile = 'balanced') {
        this.profile = profile;
    }
    add(spec) {
        if (this.tasks.has(spec.id))
            throw new Error(`duplicate task id: ${spec.id}`);
        for (const d of spec.dependsOn)
            if (!this.tasks.has(d))
                throw new Error(`task ${spec.id} depends on unknown/not-yet-added task ${d}`);
        this.tasks.set(spec.id, { spec, status: 'pending', attempts: 0 });
    }
    get(id) { return this.tasks.get(id); }
    all() { return [...this.tasks.values()]; }
    depsSatisfied(id) {
        return this.require(id).spec.dependsOn.every((d) => this.tasks.get(d)?.status === 'succeeded');
    }
    /** Human-readable reasons a task cannot start right now. Empty = startable. */
    unmet(id, snap) {
        const t = this.require(id);
        const out = [];
        if (t.status !== 'pending')
            out.push(`status is ${t.status}`);
        for (const d of t.spec.dependsOn) {
            const s = this.tasks.get(d)?.status;
            if (s !== 'succeeded')
                out.push(`dependency ${d} is ${s}`);
        }
        for (const c of t.spec.preconditions)
            if (!c.check(snap))
                out.push(`precondition: ${c.description}`);
        for (const r of t.spec.requires) {
            const have = r.match ? countItems(snap.inventory, r.match) : (snap.inventory[r.item] ?? 0);
            if (have < r.count)
                out.push(`needs ${r.count} ${r.item} (have ${have})`);
        }
        return out;
    }
    /** Tasks whose dependencies are done, ignoring item/precondition checks (acquisition tasks produce those). */
    frontier() {
        return this.all().filter((t) => t.status === 'pending' && this.depsSatisfied(t.spec.id));
    }
    /** Cheapest startable task by estimated time inflated by risk (weight depends on the profile). */
    next(snap) {
        const ready = this.frontier().filter((t) => this.unmet(t.spec.id, snap).length === 0);
        const cost = (t) => t.spec.estimatedSeconds * (1 + t.spec.risk * RISK_WEIGHT[this.profile]);
        return ready.sort((a, b) => cost(a) - cost(b))[0];
    }
    /** Pending tasks that can never run because a dependency failed or was cancelled. */
    deadlocked() {
        return this.all().filter((t) => t.status === 'pending' && t.spec.dependsOn.some((d) => ['failed', 'cancelled'].includes(this.tasks.get(d)?.status ?? '')));
    }
    start(id, tick) {
        const t = this.require(id);
        if (t.status !== 'pending')
            throw new Error(`cannot start ${id}: ${t.status}`);
        t.status = 'running';
        t.attempts++;
        t.startedTick = tick;
        delete t.lastFailure;
    }
    succeed(id, tick) {
        const t = this.require(id);
        t.status = 'succeeded';
        t.finishedTick = tick;
    }
    /** Returns 'retry' while attempts remain (1 initial + maxRetries), otherwise 'failed'. */
    fail(id, reason, tick) {
        const t = this.require(id);
        t.lastFailure = reason;
        if (t.attempts > t.spec.maxRetries) {
            t.status = 'failed';
            t.finishedTick = tick;
            return 'failed';
        }
        t.status = 'pending';
        return 'retry';
    }
    /** Pause a running task without spending a retry (e.g. the human needs help). */
    interrupt(id) {
        const t = this.require(id);
        if (t.status === 'running') {
            t.status = 'pending';
            t.attempts = Math.max(0, t.attempts - 1);
        }
    }
    timedOut(id, tick) {
        const t = this.require(id);
        return t.status === 'running' && t.startedTick !== undefined && tick - t.startedTick > t.spec.timeoutTicks;
    }
    cancel(id, cascade = true) {
        const hit = [];
        const visit = (tid) => {
            const t = this.require(tid);
            if (t.status === 'succeeded' || t.status === 'cancelled')
                return;
            t.status = 'cancelled';
            hit.push(tid);
            if (cascade)
                for (const o of this.tasks.values())
                    if (o.spec.dependsOn.includes(tid))
                        visit(o.spec.id);
        };
        visit(id);
        return hit;
    }
    /** Reset failed/cancelled tasks (and their dependents) so a run can resume from the last verified checkpoint. */
    reopen(id) {
        const t = this.require(id);
        if (t.status === 'succeeded')
            return;
        t.status = 'pending';
        t.attempts = 0;
        delete t.lastFailure;
        for (const d of t.spec.dependsOn)
            if (['failed', 'cancelled'].includes(this.tasks.get(d)?.status ?? ''))
                this.reopen(d);
    }
    exportProgress() {
        const out = {};
        for (const t of this.tasks.values()) {
            const p = { status: t.status === 'running' ? 'pending' : t.status, attempts: t.attempts };
            if (t.lastFailure !== undefined)
                p.lastFailure = t.lastFailure;
            out[t.spec.id] = p;
        }
        return out;
    }
    importProgress(p) {
        for (const [id, v] of Object.entries(p)) {
            const t = this.tasks.get(id);
            if (!t)
                continue;
            t.status = v.status;
            t.attempts = v.attempts;
            if (v.lastFailure !== undefined)
                t.lastFailure = v.lastFailure;
        }
    }
    require(id) {
        const t = this.tasks.get(id);
        if (!t)
            throw new Error(`unknown task: ${id}`);
        return t;
    }
}
