/** Co-op handoff: success requires live evidence, never a user 'done' command. */
export class Observe {
    kind = 'observe';
    start(ctx, params) {
        this.params = params;
        this.lastMessage = -Infinity;
        ctx.body.stopMoving();
        ctx.body.stopBreaking();
    }
    cancel(ctx) { ctx.body.stopMoving(); }
    tick(ctx) {
        const s = ctx.body.snapshot();
        const result = this.params.verify(s, ctx);
        if (result) return { status: 'succeeded', detail: result };
        if (s.tick - this.lastMessage >= 600) {
            ctx.body.say(`Co-op handoff: ${this.params.help}`);
            this.lastMessage = s.tick;
        }
        return { status: 'running' };
    }
}
