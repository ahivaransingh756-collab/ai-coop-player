import { TaskGraph } from '../core/taskGraph.js';
import { countItems } from '../core/types.js';
const has = (n, match) => (s) => countItems(s.inventory, match) >= n;
const isLog = (id) => id.endsWith('_log');
const T = (t) => ({
    dependsOn: [], preconditions: [], requires: [], estimatedSeconds: 60, risk: 0.05, maxRetries: 2, timeoutTicks: 20 * 300, ...t,
});
/**
 * The full any% route as data. Only kinds that have a registered executor can run;
 * the brain reports the first objective without one instead of pretending.
 */
export function buildSpeedrunGraph(profile) {
    const g = new TaskGraph(profile);
    g.add(T({ id: 'wood', kind: 'gather_blocks', description: 'Collect 6 logs', expected: '>=6 logs in inventory', estimatedSeconds: 45, risk: 0.02, params: { resource: 'wood', count: 6 } }));
    g.add(T({ id: 'wood_tools', kind: 'craft', description: 'Craft table + wooden pickaxe', expected: 'wooden pickaxe', dependsOn: ['wood'], requires: [{ item: 'log', count: 4, match: isLog }], estimatedSeconds: 15 }));
    g.add(T({ id: 'stone', kind: 'mine_blocks', description: 'Mine stone and craft stone tools', expected: 'stone pickaxe + sword', dependsOn: ['wood_tools'], estimatedSeconds: 60, risk: 0.1 }));
    g.add(T({ id: 'food', kind: 'get_food', description: 'Get food', expected: 'food in inventory', dependsOn: ['wood_tools'], estimatedSeconds: 60, risk: 0.05 }));
    g.add(T({ id: 'iron', kind: 'mine_blocks', description: 'Mine iron ore', expected: '>=11 raw iron', dependsOn: ['stone'], estimatedSeconds: 240, risk: 0.3 }));
    g.add(T({ id: 'smelt', kind: 'smelt', description: 'Smelt iron', expected: 'iron ingots', dependsOn: ['iron'], estimatedSeconds: 90, risk: 0.02 }));
    g.add(T({ id: 'iron_kit', kind: 'craft', description: 'Craft bucket, flint and steel, iron pickaxe, sword', expected: 'bucket + flint_and_steel', dependsOn: ['smelt'], estimatedSeconds: 20 }));
    g.add(T({ id: 'portal', kind: 'build_portal', description: 'Build and light Nether portal', expected: 'active portal', dependsOn: ['iron_kit', 'food'], estimatedSeconds: 120, risk: 0.35, recovery: 'rebuild_portal' }));
    g.add(T({ id: 'nether', kind: 'enter_dimension', description: 'Enter the Nether', expected: 'bot in nether', dependsOn: ['portal'], estimatedSeconds: 10, risk: 0.3 }));
    g.add(T({ id: 'fortress', kind: 'find_structure', description: 'Find a Nether fortress', expected: 'fortress observed', dependsOn: ['nether'], estimatedSeconds: 300, risk: 0.6, recovery: 'nether_retreat' }));
    g.add(T({ id: 'blaze', kind: 'get_blaze_rods', description: 'Collect blaze rods', expected: '>=7 blaze rods', dependsOn: ['fortress'], estimatedSeconds: 240, risk: 0.7 }));
    g.add(T({ id: 'pearls', kind: 'get_pearls', description: 'Collect ender pearls', expected: '>=12 pearls', dependsOn: ['nether'], estimatedSeconds: 300, risk: 0.5 }));
    g.add(T({ id: 'eyes', kind: 'craft', description: 'Craft Eyes of Ender', expected: '>=12 eyes', dependsOn: ['blaze', 'pearls'], estimatedSeconds: 15 }));
    g.add(T({ id: 'stronghold', kind: 'find_stronghold', description: 'Triangulate and reach the stronghold portal room', expected: 'end portal room found', dependsOn: ['eyes'], estimatedSeconds: 300, risk: 0.3 }));
    g.add(T({ id: 'prep_end', kind: 'prepare_end', description: 'Prepare for the End', expected: 'armor, blocks, food', dependsOn: ['stronghold'], estimatedSeconds: 45 }));
    g.add(T({ id: 'end', kind: 'enter_dimension', description: 'Enter the End', expected: 'bot in the end', dependsOn: ['prep_end'], estimatedSeconds: 10, risk: 0.4 }));
    g.add(T({ id: 'dragon', kind: 'kill_dragon', description: 'Destroy crystals and kill the Ender Dragon', expected: 'dragon death observed', dependsOn: ['end'], estimatedSeconds: 240, risk: 0.8, recovery: 'end_recovery' }));
    return g;
}
export { has };
