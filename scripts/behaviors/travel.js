import { dist } from '../core/vec.js';
import { hazardous } from '../core/safety.js';
import { StuckDetector } from '../core/stuck.js';
/** Bounded, explicitly authorized waypoint travel. No teleport or blind cross-dimension path. */
export class Travel {
    kind = 'travel';
    start(ctx, params) {
        this.target = params.target;
        this.destination = params.destination;
        this.started = ctx.body.snapshot().tick;
        this.lastNav = -Infinity;
        this.stuck = new StuckDetector();
        this.failures = 0;
    }
    cancel(ctx) { ctx.body.stopMoving(); }
    tick(ctx) {
        const s = ctx.body.snapshot(), t = this.target;
        if (this.destination && s.dimension === this.destination) {
            this.cancel(ctx);
            return { status: 'succeeded', detail: `entered ${s.dimension}` };
        }
        if (!t || t.dimension !== s.dimension)
            return { status: 'failed', reason: 'waypoint missing or in another dimension; mark it on this side' };
        if (s.tick - this.started > 1200) return { status: 'failed', reason: 'travel timeout; check path/portal' };
        const d = dist(s.position, t.pos);
        if (!this.destination && d < 2) {
            this.cancel(ctx);
            return { status: 'succeeded', detail: 'waypoint reached' };
        }
        if (this.destination && Math.hypot(s.position.x-t.pos.x, s.position.z-t.pos.z) < 0.35 && Math.abs(s.position.y-t.pos.y) < 1.8) {
            ctx.body.stopMoving(); // stay in the portal for its transition delay
            return { status: 'running' };
        }
        if (this.stuck.update(s.tick, s.position)) {
            this.stuck.reset();
            if (++this.failures >= 3) return { status: 'failed', reason: 'stuck approaching waypoint' };
        }
        // Native navigation can still be unsafe: reject unknown/hazardous next steps locally.
        const step = { x: s.position.x + (t.pos.x-s.position.x)/Math.max(d, 1), y: s.position.y, z: s.position.z + (t.pos.z-s.position.z)/Math.max(d,1) };
        const floor = ctx.world.blockAt({ ...step, y: step.y - 1 });
        const feet = ctx.world.blockAt(step);
        const enteringPortal = this.destination && d < 2 && ['minecraft:portal', 'minecraft:end_portal'].includes(ctx.world.blockAt(t.pos)?.typeId);
        if (!floor || !feet || hazardous(floor) || hazardous(feet) || (!floor.solid && !enteringPortal))
            return { status: 'failed', reason: 'unsafe or unloaded next step; build a safe path' };
        if (s.onGround && s.tick - this.lastNav >= 20) {
            this.lastNav = s.tick;
            if (ctx.body.navigateTo(t.pos, 1) === 'failed' && ++this.failures >= 3)
                return { status: 'failed', reason: 'native navigation found no path' };
        }
        return { status: 'running' };
    }
}

export class PortalTravel extends Travel {
    kind = 'portal_travel';
    start(ctx, params) {
        super.start(ctx, { target: ctx.run.waypoints[params.waypoint], destination: params.destination });
        this.waypoint = params.waypoint;
        const s = ctx.body.snapshot();
        if (s.dimension !== params.destination && !ctx.run.verifyPortal(params.waypoint, s, ctx.world))
            throw new Error(`mark an active ${params.waypoint} and bring me within 8 blocks first`);
    }
}
