export class Telemetry {
    records = [];
    counters = { deaths: 0, stuckEvents: 0, retries: 0 };
    record(r) { this.records.push(r); if (this.records.length > 200)
        this.records.shift(); }
    bump(name) { this.counters[name] = (this.counters[name] ?? 0) + 1; }
    slowest(n = 3) { return [...this.records].sort((a, b) => b.ticks - a.ticks).slice(0, n); }
    summary() {
        const ok = this.records.filter((r) => r.outcome === 'succeeded').length;
        const c = this.counters;
        return `tasks ok ${ok}/${this.records.length}, deaths ${c.deaths}, stuck ${c.stuckEvents}, retries ${c.retries}`;
    }
}
