import { TaskGraph } from '../core/taskGraph.js';
import { countItems } from '../core/types.js';
import { foodPoints, pickaxeTier } from '../core/safety.js';
export const ROUTE_VERSION = 2;
const count = (s, id) => s.inventory[`minecraft:${id}`] ?? 0;
const has = (id, n = 1) => (s) => count(s, id) >= n && `${n} ${id} observed in bot inventory`;
const pick = (tier) => (s) => Object.keys(s.inventory).some(id => s.inventory[id] > 0 && pickaxeTier(id) >= tier) && `pickaxe tier >= ${tier} observed`;
const inDimension = (id) => (s) => s.dimension === `minecraft:${id}` && `bot observed in ${id}`;
const T = (t) => ({ dependsOn: [], preconditions: [], requires: [], estimatedSeconds: 60, risk: 0.05, maxRetries: 2, timeoutTicks: 6000, ...t });
/** Complete co-op objective chain, NOT a claim of autonomous execution. */
export function buildSpeedrunGraph(profile) {
    const g = new TaskGraph(profile);
    const add = (id, description, dependsOn, verify, help, extra = {}) => g.add(T({
        id, kind: 'observe', description, dependsOn, expected: description, verify,
        timeoutTicks: 20 * 60 * 30, params: { verify, help }, ...extra,
    }));
    const logs = s => countItems(s.inventory, id => id.endsWith('_log')) >= 6 && '6 logs observed';
    add('wood', 'Collect 6 logs', [], logs, 'Give me six logs.', { kind: 'gather_blocks', params: { resource: 'wood', count: 6, total: true } });
    add('wood_tools', 'Obtain a wooden pickaxe or better', ['wood'], pick(1), 'Craft a table and wooden pickaxe; drop the pickaxe beside me. Crafting UI automation is unavailable.');
    add('stone', 'Collect 16 cobblestone', ['wood_tools'], has('cobblestone', 16), '', { kind: 'gather_blocks', params: { resource: 'cobblestone', count: 16, total: true } });
    add('stone_tools', 'Obtain a stone pickaxe or better', ['stone'], pick(2), 'Craft a stone pickaxe and furnace. Drop the pickaxe beside me; keep the furnace for smelting.');
    add('food', 'Stock 40 food points', ['stone_tools'], s => foodPoints(s.inventory) >= 40 && '40 safe food points observed', 'Drop cooked food or bread beside me (40 food points, e.g. 8 bread).');
    add('iron', 'Collect 10 raw iron', ['stone_tools'], has('raw_iron', 10), '', { kind: 'gather_blocks', estimatedSeconds: 240, risk: 0.25, params: { resource: 'iron', count: 10, total: true } });
    add('smelt', 'Obtain 10 iron ingots', ['iron'], has('iron_ingot', 10), 'Smelt our iron using your furnace and fuel, then drop 10 ingots beside me.');
    add('iron_kit', 'Verify portal kit and iron pickaxe', ['smelt'], s =>
        pick(3)(s) && (count(s, 'bucket') + count(s, 'water_bucket') > 0) && count(s, 'flint_and_steel') > 0 && 'iron pickaxe, bucket and flint and steel observed',
    'Craft an iron pickaxe, bucket, flint and steel; drop them beside me. Reserve remaining iron for sword/shield.');
    add('portal', 'Observe an active Overworld Nether portal', ['iron_kit', 'food'], (s, ctx) => ctx.run.verifyPortal('overworld_portal', s, ctx.world),
        'Build/light a Nether portal, look at an active portal block and use !bot mark overworld_portal; bring me within 8 blocks.');
    add('nether', 'Enter the Nether through the marked portal', ['portal'], inDimension('nether'), '', {
        kind: 'portal_travel', risk: 0.3, params: { waypoint: 'overworld_portal', destination: 'minecraft:nether' }, timeoutTicks: 1400,
    });
    add('blaze', 'Obtain 7 blaze rods', ['nether'], has('blaze_rod', 7), 'Find a fortress and fight blazes together. Bring me 7 rods. I do not locate structures or safely farm blazes autonomously.');
    add('pearls', 'Obtain 14 ender pearls', ['nether'], has('ender_pearl', 14), 'Barter gold with piglins or fight endermen; bring me 14 pearls. Barter results are random, not guaranteed.', { estimatedSeconds: 300, risk: 0.5 });
    add('eyes', 'Obtain 14 Eyes of Ender', ['blaze', 'pearls'], has('ender_eye', 14), 'Craft 7 rods into 14 powder; combine with 14 pearls. Drop 14 eyes beside me. Two spare eyes are a buffer, not a guarantee.');
    add('return', 'Return through the marked Nether-side portal', ['eyes'], inDimension('overworld'), '', {
        kind: 'portal_travel', params: { waypoint: 'nether_portal', destination: 'minecraft:overworld' }, timeoutTicks: 1400,
    });
    add('stronghold', 'Observe an activated stronghold End portal', ['return'], (s, ctx) => ctx.run.verifyPortal('end_portal', s, ctx.world),
        'Use eyes to find the stronghold, activate its portal, then !bot mark end_portal while looking at it. Bring me within 8 blocks. Use !bot eye <x> <z> for triangulation assistance.');
    add('prep_end', 'Verify minimum End supplies', ['stronghold'], s => foodPoints(s.inventory) >= 40 && count(s, 'cobblestone') >= 32 && count(s, 'water_bucket') >= 1 && 'food, 32 cobblestone and water bucket observed',
        'Bring me 40 food points, 32 cobblestone and a water bucket. YOU must prepare armor, ranged weapon and a safe crystal strategy; this check does not certify combat readiness.');
    add('end', 'Enter the End through the marked portal', ['prep_end'], inDimension('the_end'), '', {
        kind: 'portal_travel', risk: 0.5, params: { waypoint: 'end_portal', destination: 'minecraft:the_end' }, timeoutTicks: 1400,
    });
    add('dragon', 'Observe the co-op Ender Dragon death', ['end'], (s, ctx) => ctx.run.dragonDeath && 'nearby Ender Dragon death event recorded during this run',
        'Destroy crystals and fight the dragon. I will not claim victory from an absent/unloaded dragon; a nearby death event in the End is required. Autonomous dragon combat is not implemented.', { risk: 0.8 });
    return g;
}
