export class Throttle {
    last = new Map();
    allow(key, tick, minInterval) {
        const l = this.last.get(key);
        if (l !== undefined && tick - l < minInterval)
            return false;
        this.last.set(key, tick);
        return true;
    }
}
