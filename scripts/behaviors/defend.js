import { pickThreats } from '../core/combat.js';
import { factValue } from '../core/types.js';
import { dist } from '../core/vec.js';
export class Defend {
    kind = 'defend';
    startTick = 0;
    lastThreat = 0;
    lastAttack = -999;
    lastNav = -999;
    lastEquip = -999;
    start(ctx) {
        const t = ctx.body.snapshot().tick;
        this.startTick = t;
        this.lastThreat = t;
        this.lastAttack = -999;
        this.lastNav = -999;
        this.lastEquip = -999;
    }
    cancel(ctx) { ctx.body.stopMoving(); }
    tick(ctx) {
        const snap = ctx.body.snapshot();
        const now = snap.tick;
        if (!snap.alive)
            return { status: 'failed', reason: 'bot died' };
        const hp = factValue(snap.health);
        const threats = pickThreats(snap.hostiles, snap.position, factValue(snap.human)?.position, ctx.cfg.combat.threatRadius);
        if (threats.length === 0) {
            return now - this.lastThreat >= ctx.cfg.combat.clearTicks ? { status: 'succeeded', detail: 'area clear' } : { status: 'running' };
        }
        if (hp !== undefined && hp <= ctx.cfg.combat.retreatHealth) {
            ctx.body.stopMoving();
            return { status: 'failed', reason: `health ${hp} at or below retreat threshold` };
        }
        this.lastThreat = now;
        const t = threats[0];
        if (now - this.lastEquip >= 100) {
            this.lastEquip = now;
            ctx.body.equipBestWeapon();
        }
        if (now - this.startTick < ctx.cfg.combat.reactionDelayTicks)
            return { status: 'running' };
        if (dist(t.position, snap.position) <= ctx.cfg.combat.attackRange) {
            ctx.body.lookAt(t.position);
            if (now - this.lastAttack >= ctx.cfg.combat.attackCooldownTicks) {
                this.lastAttack = now;
                ctx.body.attackEntity(t.id);
            }
        }
        else if (now - this.lastNav >= 10) {
            this.lastNav = now;
            ctx.body.navigateToEntity(t.id, 1.2);
        }
        return { status: 'running' };
    }
}
