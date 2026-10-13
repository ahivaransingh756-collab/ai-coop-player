import { decideFollow } from '../core/follow.js';
import { factValue } from '../core/types.js';
import { StuckDetector } from '../core/stuck.js';
import { dist } from '../core/vec.js';
import { Throttle } from '../core/throttle.js';
/** Open-ended: never reports success. Cancel it to stop. */
export class Follow {
    kind = 'follow';
    lastNav = -999;
    lastTarget;
    stuckEvents = 0;
    stuck = new StuckDetector();
    say = new Throttle();
    start() { this.lastNav = -999; this.lastTarget = undefined; this.stuckEvents = 0; this.stuck.reset(); }
    cancel(ctx) { ctx.body.stopMoving(); }
    tick(ctx) {
        const snap = ctx.body.snapshot();
        if (!snap.alive)
            return { status: 'failed', reason: 'bot died' };
        const human = factValue(snap.human);
        if (!human)
            return { status: 'running' };
        const d = decideFollow(snap.position, snap.dimension, human, ctx.cfg.follow);
        const now = snap.tick;
        switch (d.kind) {
            case 'idle':
                this.stuck.reset();
                this.stuckEvents = 0;
                this.lastTarget = undefined;
                return { status: 'running' };
            case 'blocked':
                if (this.say.allow('blocked', now, 600))
                    ctx.body.say(d.reason);
                return { status: 'running' };
            case 'teleport':
                ctx.body.teleportTo(d.target);
                ctx.log.warn('follow.teleport_regroup', { to: d.target });
                return { status: 'running' };
            case 'navigate': {
                if (this.stuck.update(now, snap.position)) {
                    this.stuckEvents++;
                    this.stuck.reset();
                    this.lastNav = -999;
                    ctx.log.warn('follow.stuck', { pos: snap.position, events: this.stuckEvents });
                    if (this.stuckEvents >= 3 && this.say.allow('stuck', now, 600))
                        ctx.body.say(`I'm stuck ~${Math.round(dist(snap.position, human.position))} blocks away. Come closer or help me out.`);
                }
                const moved = !this.lastTarget || dist(this.lastTarget, d.target) > 2;
                if (now - this.lastNav >= ctx.cfg.follow.repathTicks && (moved || now - this.lastNav >= 40)) {
                    this.lastNav = now;
                    this.lastTarget = d.target;
                    if (ctx.body.navigateTo(d.target, d.speed) === 'failed')
                        this.stuckEvents++;
                }
                return { status: 'running' };
            }
        }
    }
}
