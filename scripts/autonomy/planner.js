import { RECIPES, LOGS, PLANKS, COOKING, total } from './recipes.js';
import { foodPoints, pickaxeTier } from '../core/safety.js';
import { factValue } from '../core/types.js';
const count = (s, id) => s.inventory[`minecraft:${id}`] ?? 0;
const hasTier = (s, tier) =>
    Object.keys(s.inventory).some((id) => s.inventory[id] > 0 && pickaxeTier(id) >= tier);
const request = (kind, params, reason) => ({ kind, ...params, reason });
/** Inventory-driven recursive prerequisite planner, rebuilt from LIVE state after every action. */
export function planNext(s, env) {
    const trace = [];
    const choose = (job) => ({ ...job, trace: [...trace] });
    function planks(n) {
        if (total(s.inventory, PLANKS) >= n) return;
        const log = LOGS.find((id) => (s.inventory[id] ?? 0) > 0);
        if (log) return craft(log.slice('minecraft:'.length).replace('_log', '_planks'));
        return request('harvest', { resource: 'wood' }, 'Need a log for real plank ingredients');
    }
    function station(id) {
        if (env.stations[id]) return;
        if (count(s, id) > 0)
            return request('place', { item: `minecraft:${id}` }, `Place a ${id} on known safe ground`);
        return craft(id);
    }
    function tier(n) {
        if (hasTier(s, n)) return;
        return craft(n === 1 ? 'wooden_pickaxe' : n === 2 ? 'stone_pickaxe' : 'iron_pickaxe');
    }
    function smelt(input, amount) {
        const prerequisite = station('furnace');
        if (prerequisite) return prerequisite;
        const output = COOKING[input],
            state = env.furnace;
        // Finish existing work before introducing a different ingredient. Never overwrite it.
        if (state?.input && state.input.typeId !== input) return smelt(state.input.typeId, 0);
        if (state?.output)
            return request(
                'smelt',
                {
                    input:
                        state.input?.typeId ??
                        Object.keys(COOKING).find((id) => COOKING[id] === state.output.typeId) ??
                        input,
                },
                'Collect already-smelted output using native container transfer',
            );
        const queued = state?.input?.typeId === input ? state.input.amount : 0;
        if (queued === 0 && (s.inventory[input] ?? 0) < amount) {
            if (input === 'minecraft:raw_iron') return need('raw_iron', amount);
            return request('hunt', {}, 'Acquire actual raw meat from an observed animal');
        }
        // Planks are a renewable bootstrap fuel if coal is unavailable. Furnace burning state is not exposed.
        if (!state?.fuel && count(s, 'coal') + count(s, 'charcoal') === 0 && total(s.inventory, PLANKS) < 2) {
            const job = planks(2);
            if (job) return job;
        }
        return request('smelt', { input, output }, 'Feed a real furnace and wait for engine-produced output');
    }
    function need(id, n) {
        if (count(s, id) >= n) return;
        trace.push(`need ${n} ${id} (have ${count(s, id)})`);
        if (trace.length > 32) return request('blocked', {}, 'Recipe prerequisite depth exceeded');
        if (id === 'planks') return planks(n);
        if (id === 'iron_ingot') return smelt('minecraft:raw_iron', n - count(s, id));
        if (['cobblestone', 'raw_iron', 'coal'].includes(id)) {
            const tool = tier(id === 'raw_iron' ? 2 : 1);
            if (tool) return tool;
            return request(
                'harvest',
                { resource: id === 'raw_iron' ? 'iron' : id },
                `Obtain ${id} with a suitable pickaxe`,
            );
        }
        if (id === 'flint') {
            if (count(s, 'gravel') > 0 && !env.hasGravel)
                return request(
                    'place',
                    { item: 'minecraft:gravel' },
                    'Recycle owned gravel with real placement and random drops',
                );
            return request(
                'harvest',
                { resource: 'gravel' },
                'Break gravel and observe the actual flint/gravel drop',
            );
        }
        if (Object.hasOwn(RECIPES, id)) return craft(id);
        return request('blocked', {}, `No acquisition policy for ${id}`);
    }
    function craft(id) {
        const r = RECIPES[id];
        if (!r) return request('blocked', {}, `Unsupported recipe ${id}`);
        if (r.station) {
            const job = station(r.station);
            if (job) return job;
        }
        for (const ingredient of r.inputs) {
            if (total(s.inventory, ingredient.ids) < ingredient.count) {
                const job =
                    ingredient.ids.length > 1
                        ? planks(ingredient.count)
                        : need(ingredient.ids[0].slice(10), ingredient.count);
                if (job) return job;
            }
        }
        return request(
            'craft',
            { recipe: id },
            `Consume real ingredients to make ${r.amount} ${id} using the disclosed modded recipe bridge`,
        );
    }
    function food(target = 40) {
        if (foodPoints(s.inventory) >= target) return;
        if (count(s, 'wheat') >= 3) return craft('bread');
        const state = env.furnace;
        const raw = Object.keys(COOKING).find(
            (id) =>
                id !== 'minecraft:raw_iron' &&
                ((s.inventory[id] ?? 0) > 0 ||
                    state?.input?.typeId === id ||
                    state?.output?.typeId === COOKING[id]),
        );
        if (raw) return smelt(raw, Math.min(5, s.inventory[raw] ?? 0));
        return request('hunt', {}, 'Food reserve is low; find an observed, reachable adult food animal');
    }
    if (s.dimension !== 'minecraft:overworld')
        return choose(
            request(
                'blocked',
                {},
                'Autonomous production is currently supported in the Overworld only; no full speedrun completion claim',
            ),
        );
    const complete = () =>
        choose(
            request(
                'complete',
                {},
                'Autonomous Overworld kit verified: food, iron tools, bucket, ignition and shield. Nether/dragon autonomy is not implemented.',
            ),
        );
    if (
        hasTier(s, 3) &&
        count(s, 'iron_sword') > 0 &&
        count(s, 'bucket') + count(s, 'water_bucket') > 0 &&
        count(s, 'flint_and_steel') > 0 &&
        count(s, 'shield') > 0 &&
        foodPoints(s.inventory) >= 40
    )
        return complete();
    const hunger = factValue(s.hunger);
    let job;
    // Tool bootstrap is short; sword/furnace allow safe-ish renewable food acquisition thereafter.
    if ((job = tier(1))) return choose(job);
    if ((job = tier(2))) return choose(job);
    if (
        count(s, 'iron_sword') +
            count(s, 'diamond_sword') +
            count(s, 'netherite_sword') +
            count(s, 'stone_sword') ===
            0 &&
        (job = need('stone_sword', 1))
    )
        return choose(job);
    if ((job = station('furnace'))) return choose(job);
    if ((hunger !== undefined && hunger <= 14) || foodPoints(s.inventory) < 40) {
        if ((job = food())) return choose(job);
    }
    for (const id of ['iron_pickaxe', 'iron_sword', 'bucket', 'flint_and_steel', 'shield']) {
        if (id === 'iron_pickaxe' && hasTier(s, 3)) continue;
        if (id === 'bucket' && count(s, 'water_bucket') > 0) continue;
        if ((job = need(id, 1))) return choose(job);
    }
    return complete();
}
