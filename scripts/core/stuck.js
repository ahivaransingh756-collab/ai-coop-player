import { dist } from './vec.js';
/** Reports stuck when the bot has moved less than `minMovement` blocks over `windowTicks`. */
export class StuckDetector {
    cfg;
    samples = [];
    constructor(cfg = { windowTicks: 40, minMovement: 0.6 }) {
        this.cfg = cfg;
    }
    reset() { this.samples = []; }
    update(tick, pos) {
        this.samples.push({ tick, pos });
        while (this.samples.length > 1 && tick - this.samples[1].tick >= this.cfg.windowTicks)
            this.samples.shift();
        const first = this.samples[0];
        if (tick - first.tick < this.cfg.windowTicks)
            return false;
        return dist(first.pos, pos) < this.cfg.minMovement;
    }
}
