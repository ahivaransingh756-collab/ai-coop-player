import { factValue } from '../core/types.js';
import { FOODS } from '../core/safety.js';
export class Eat {
    kind = 'eat';
    start(ctx) {
        const s = ctx.body.snapshot();
        this.started = s.tick;
        this.hunger = factValue(s.hunger);
        this.inventory = { ...s.inventory };
        ctx.body.stopMoving();
        ctx.body.stopBreaking();
        this.accepted = ctx.body.useFood();
    }
    cancel(ctx) { ctx.body.stopUsingItem(); }
    tick(ctx) {
        const s = ctx.body.snapshot();
        const consumed = Object.keys(FOODS).some(id => (s.inventory[id] ?? 0) < (this.inventory[id] ?? 0));
        if (consumed || factValue(s.hunger) > this.hunger) {
            this.cancel(ctx);
            return { status: 'succeeded', detail: 'food consumed' };
        }
        if (!this.accepted || s.tick - this.started > 80)
            return { status: 'failed', reason: 'could not consume food' };
        return { status: 'running' };
    }
}
