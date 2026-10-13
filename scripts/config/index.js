export const DEFAULT_CONFIG = {
    botName: 'Speedy',
    riskProfile: 'balanced',
    autoDefend: true,
    follow: { minDistance: 3, maxDistance: 6, sprintDistance: 14, regroupDistance: 48, allowTeleportRegroup: false, repathTicks: 10 },
    gather: { searchRadius: 16, reachDistance: 4, probesPerTick: 2500, maxStuckPerBlock: 2 },
    combat: { threatRadius: 12, attackRange: 3.2, attackCooldownTicks: 12, retreatHealth: 6, clearTicks: 60, reactionDelayTicks: 5 },
    chat: { minStatusIntervalTicks: 100 },
};
const PROFILES = ['casual', 'aggressive', 'balanced', 'safe', 'support'];
const RANGES = {
    'follow.minDistance': [1, 20], 'follow.maxDistance': [2, 40], 'follow.sprintDistance': [4, 64], 'follow.regroupDistance': [8, 256],
    'follow.repathTicks': [2, 100], 'gather.searchRadius': [4, 32], 'gather.reachDistance': [2, 5], 'gather.probesPerTick': [100, 20000],
    'gather.maxStuckPerBlock': [1, 10], 'combat.threatRadius': [4, 32], 'combat.attackRange': [1.5, 4.5], 'combat.attackCooldownTicks': [4, 40],
    'combat.retreatHealth': [0, 20], 'combat.clearTicks': [10, 400], 'combat.reactionDelayTicks': [0, 40], 'chat.minStatusIntervalTicks': [0, 2400],
};
export class ConfigError extends Error {
    problems;
    constructor(problems) {
        super(`Invalid bot config:\n - ${problems.join('\n - ')}`);
        this.problems = problems;
    }
}
/** Merge a partial override onto defaults, rejecting unknown keys, wrong types and out-of-range numbers. */
export function validateConfig(raw, base = DEFAULT_CONFIG) {
    const problems = [];
    const merge = (b, o, path) => {
        if (o === undefined)
            return b;
        if (typeof b === 'object' && b !== null) {
            if (typeof o !== 'object' || o === null || Array.isArray(o)) {
                problems.push(`${path || 'config'} must be an object`);
                return b;
            }
            const out = {};
            for (const k of Object.keys(o))
                if (!(k in b))
                    problems.push(`unknown key ${path ? path + '.' : ''}${k}`);
            for (const [k, v] of Object.entries(b))
                out[k] = merge(v, o[k], path ? `${path}.${k}` : k);
            return out;
        }
        if (typeof o !== typeof b) {
            problems.push(`${path} must be a ${typeof b}`);
            return b;
        }
        if (typeof o === 'number') {
            const r = RANGES[path];
            if (!Number.isFinite(o) || (r && (o < r[0] || o > r[1]))) {
                problems.push(`${path} must be within ${r ? r.join('..') : 'finite range'}`);
                return b;
            }
        }
        if (path === 'riskProfile' && !PROFILES.includes(o)) {
            problems.push(`riskProfile must be one of ${PROFILES.join(', ')}`);
            return b;
        }
        if (path === 'botName' && !/^[A-Za-z0-9_ ]{1,16}$/.test(o)) {
            problems.push('botName must be 1-16 letters/digits/underscore/space');
            return b;
        }
        return o;
    };
    const merged = merge(base, raw, '');
    if (merged.follow.maxDistance <= merged.follow.minDistance)
        problems.push('follow.maxDistance must exceed follow.minDistance');
    if (problems.length)
        throw new ConfigError(problems);
    return merged;
}
