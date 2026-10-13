import { canExcavate, pickaxeTier } from '../core/safety.js';
import { RESOURCES } from './resources.js';
import { countItems } from '../core/types.js';
import { sortedOffsets } from '../core/spatial.js';
import { StuckDetector } from '../core/stuck.js';
import { dist, keyOf, v3 } from '../core/vec.js';
const HEAD = 1.62;
const center = (p) => v3(Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5, Math.floor(p.z) + 0.5);
/**
 * search -> approach -> break -> collect, verified by inventory delta.
 * Every state has a timeout; unreachable blocks are blacklisted so we never loop on them.
 */
export class GatherBlocks {
    kind = 'gather_blocks';
    def;
    target = 1;
    baseline = 0;
    state = 'search';
    stateSince = 0;
    origin = v3(0, 0, 0);
    idx = 0;
    block;
    blacklist = new Set();
    stuckCount = 0;
    lastNav = -999;
    lastBreak = -999;
    stuck = new StuckDetector();
    start(ctx, params) {
        const res = Object.hasOwn(RESOURCES, String(params.resource)) ? RESOURCES[String(params.resource)] : undefined;
        if (!res)
            throw new Error(`unknown resource "${String(params.resource)}"`);
        this.def = res;
        this.target = Number(params.count ?? 1);
        if (!Number.isInteger(this.target) || this.target < 1 || this.target > 64)
            throw new Error('gather count must be an integer from 1 to 64');
        this.total = params.total === true;
        const snap = ctx.body.snapshot();
        this.baseline = this.total ? 0 : (params.baseline ?? countItems(snap.inventory, res.itemMatch));
        this.dimension = snap.dimension;
        this.lastBreak = -999;
        this.blacklist.clear();
        this.stuckCount = 0;
        this.block = undefined;
        this.enter('search', snap.tick, snap.position);
    }
    cancel(ctx) { ctx.body.stopBreaking(); ctx.body.stopMoving(); }
    tick(ctx) {
        const snap = ctx.body.snapshot();
        const now = snap.tick;
        if (!snap.alive)
            return { status: 'failed', reason: 'bot died' };
        if (snap.dimension !== this.dimension)
            return { status: 'failed', reason: 'dimension changed during gathering' };
        if (this.def.tier && !Object.keys(snap.inventory).some(id => snap.inventory[id] > 0 && pickaxeTier(id) >= this.def.tier))
            return { status: 'failed', reason: `requires pickaxe tier ${this.def.tier}; hand me a suitable pickaxe` };
        const gained = countItems(snap.inventory, this.def.itemMatch) - this.baseline;
        if (gained >= this.target) {
            this.cancel(ctx);
            return { status: 'succeeded', detail: `collected ${gained} ${this.def.label}` };
        }
        if (snap.emptySlots === 0 && !ctx.body.canCollect?.(this.def.itemMatch)) {
            this.cancel(ctx);
            return { status: 'failed', reason: `inventory full after ${gained} ${this.def.label}` };
        }
        switch (this.state) {
            case 'search': return this.search(ctx, now, gained);
            case 'approach': return this.approach(ctx, snap.position, now);
            case 'break': return this.breaking(ctx, snap.position, now);
            case 'collect': return this.collect(ctx, snap.position, now);
        }
    }
    enter(s, tick, origin) {
        this.state = s;
        this.stateSince = tick;
        this.stuck.reset();
        if (s === 'search' && origin) {
            this.origin = origin;
            this.idx = 0;
        }
    }
    reject(ctx, why, now, pos) {
        if (this.block) {
            this.blacklist.add(keyOf(this.block));
            ctx.log.warn('gather.reject_block', { block: this.block, why });
            ctx.memory.recordFailure(`block:${keyOf(this.block)}`, now);
        }
        ctx.body.stopBreaking();
        ctx.body.stopMoving();
        this.block = undefined;
        this.stuckCount = 0;
        this.enter('search', now, pos);
    }
    search(ctx, now, gained) {
        const offsets = sortedOffsets(ctx.cfg.gather.searchRadius);
        const dim = ctx.body.snapshot().dimension;
        let probes = 0;
        while (probes < ctx.cfg.gather.probesPerTick && this.idx < offsets.length) {
            const o = offsets[this.idx++];
            probes++;
            const p = v3(Math.floor(this.origin.x) + o.x, Math.floor(this.origin.y) + o.y, Math.floor(this.origin.z) + o.z);
            const b = ctx.world.blockAt(p);
            if (b && this.def.blockMatch(b.typeId) && !this.blacklist.has(keyOf(p)) && canExcavate(ctx.world, p, this.origin)) {
                this.block = p;
                ctx.memory.rememberResource(this.def.label, p, dim, now);
                this.lastNav = -999;
                this.enter('approach', now);
                return { status: 'running' };
            }
        }
        if (this.idx >= offsets.length) {
            ctx.memory.recordFailure(`search:${this.def.label}`, now);
            return { status: 'failed', reason: `no reachable ${this.def.label} within ${ctx.cfg.gather.searchRadius} blocks (collected ${gained}/${this.target})` };
        }
        return { status: 'running' };
    }
    approach(ctx, pos, now) {
        const blk = this.block;
        const cur = ctx.world.blockAt(blk);
        if (!cur || !this.def.blockMatch(cur.typeId)) {
            this.block = undefined;
            this.enter('search', now, pos);
            return { status: 'running' };
        }
        if (dist(v3(pos.x, pos.y + HEAD, pos.z), center(blk)) <= ctx.cfg.gather.reachDistance) {
            ctx.body.stopMoving();
            this.enter('break', now);
            return { status: 'running' };
        }
        if (now - this.stateSince > 600) {
            this.reject(ctx, 'approach timeout', now, pos);
            return { status: 'running' };
        }
        if (this.stuck.update(now, pos)) {
            ctx.log.warn('gather.stuck', { pos, block: blk });
            this.stuckCount++;
            this.stuck.reset();
            if (this.stuckCount >= ctx.cfg.gather.maxStuckPerBlock) {
                this.reject(ctx, 'stuck while approaching', now, pos);
                return { status: 'running' };
            }
            this.lastNav = -999; // local replan: re-issue navigation
        }
        if (ctx.body.snapshot().onGround && now - this.lastNav >= 20) {
            this.lastNav = now;
            if (ctx.body.navigateToBlock(blk, 1) === 'failed')
                this.reject(ctx, 'no path', now, pos);
        }
        return { status: 'running' };
    }
    breaking(ctx, pos, now) {
        const blk = this.block;
        const cur = ctx.world.blockAt(blk);
        if (!cur) {
            this.reject(ctx, 'block unloaded', now, pos);
            return { status: 'running' };
        }
        if (cur.air) {
            ctx.body.stopBreaking();
            this.enter('collect', now);
            return { status: 'running' };
        }
        if (!this.def.blockMatch(cur.typeId)) {
            this.block = undefined;
            this.enter('search', now, pos);
            return { status: 'running' };
        }
        if (dist(v3(pos.x, pos.y + HEAD, pos.z), center(blk)) > ctx.cfg.gather.reachDistance + 1) {
            this.enter('approach', now);
            return { status: 'running' };
        }
        if (now - this.stateSince > 600) {
            this.reject(ctx, 'break timeout', now, pos);
            return { status: 'running' };
        }
        if (!canExcavate(ctx.world, blk, pos)) {
            this.reject(ctx, 'unsafe excavation', now, pos);
            return { status: 'running' };
        }
        if (this.lastBreak < this.stateSince) {
            this.lastBreak = now;
            ctx.body.lookAt(center(blk));
            if (this.def.tier && !ctx.body.equipPickaxe(this.def.tier)) {
                this.reject(ctx, 'no suitable pickaxe', now, pos);
                return { status: 'running' };
            }
            if (!ctx.body.breakBlock(blk)) this.reject(ctx, 'break rejected', now, pos);
        }
        return { status: 'running' };
    }
    collect(ctx, pos, now) {
        const drops = ctx.world.droppedItemsNear(this.block ?? pos, 8).filter((d) => this.def.itemMatch(d.typeId));
        if (drops.length > 0 && now - this.stateSince < 200) {
            const nearest = drops.sort((a, b) => dist(a.position, pos) - dist(b.position, pos))[0];
            if (dist(nearest.position, pos) > 1.2 && now - this.lastNav >= 10) {
                this.lastNav = now;
                ctx.body.navigateTo(nearest.position, 1);
            }
            return { status: 'running' };
        }
        if (now - this.stateSince >= 15) {
            // Nothing left to collect here (or timed out): find the next block from where we stand.
            ctx.body.stopMoving();
            this.block = undefined;
            this.enter('search', now, pos);
        }
        return { status: 'running' };
    }
}
