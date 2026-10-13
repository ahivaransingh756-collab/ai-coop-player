export const UNKNOWN = { kind: 'unknown' };
export const observed = (value, tick) => ({ kind: 'observed', value, tick });
export const inferred = (value, tick, basis) => ({ kind: 'inferred', value, tick, basis });
export const factValue = (f) => (f.kind === 'unknown' ? undefined : f.value);
export const factAge = (f, nowTick) => (f.kind === 'unknown' ? Infinity : nowTick - f.tick);
export const countItems = (inv, match) => Object.entries(inv).reduce((n, [id, c]) => (match(id) ? n + c : n), 0);
