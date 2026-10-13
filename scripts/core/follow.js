import { dist, pointToward } from './vec.js';
export function decideFollow(botPos, botDim, human, cfg) {
    if (human.dimension !== botDim)
        return { kind: 'blocked', reason: `${human.name} is in another dimension (portal travel not implemented)` };
    const d = dist(botPos, human.position);
    if (d > cfg.regroupDistance && cfg.allowTeleportRegroup)
        return { kind: 'teleport', target: human.position };
    if (d <= cfg.maxDistance)
        return { kind: 'idle' };
    return { kind: 'navigate', target: pointToward(human.position, botPos, cfg.minDistance), speed: d > cfg.sprintDistance ? 1.3 : 1 };
}
