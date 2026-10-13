// Deliberately small, version-reviewed recipe allowlist. Not a universal recipe engine.
const mc = (id) => `minecraft:${id}`;
export const WOODS = [
    'oak',
    'spruce',
    'birch',
    'jungle',
    'acacia',
    'dark_oak',
    'mangrove',
    'cherry',
    'pale_oak',
];
export const LOGS = WOODS.map((w) => mc(`${w}_log`));
export const PLANKS = WOODS.map((w) => mc(`${w}_planks`));
const ingredient = (ids, count) => ({ ids: Array.isArray(ids) ? ids : [mc(ids)], count });
const recipe = (id, inputs, amount = 1, station = 'crafting_table', maxAmount = 64) => ({
    id,
    output: mc(id),
    amount,
    inputs,
    station,
    maxAmount,
});
export const RECIPES = Object.freeze(
    Object.fromEntries(
        [
            ...WOODS.map((w) => recipe(`${w}_planks`, [ingredient(`${w}_log`, 1)], 4, null)),
            recipe('stick', [ingredient(PLANKS, 2)], 4, null),
            recipe('crafting_table', [ingredient(PLANKS, 4)], 1, null),
            recipe('wooden_pickaxe', [ingredient(PLANKS, 3), ingredient('stick', 2)], 1, 'crafting_table', 1),
            recipe(
                'stone_pickaxe',
                [ingredient('cobblestone', 3), ingredient('stick', 2)],
                1,
                'crafting_table',
                1,
            ),
            recipe(
                'stone_sword',
                [ingredient('cobblestone', 2), ingredient('stick', 1)],
                1,
                'crafting_table',
                1,
            ),
            recipe('furnace', [ingredient('cobblestone', 8)]),
            recipe(
                'iron_pickaxe',
                [ingredient('iron_ingot', 3), ingredient('stick', 2)],
                1,
                'crafting_table',
                1,
            ),
            recipe(
                'iron_sword',
                [ingredient('iron_ingot', 2), ingredient('stick', 1)],
                1,
                'crafting_table',
                1,
            ),
            recipe('bucket', [ingredient('iron_ingot', 3)], 1, 'crafting_table', 16),
            recipe(
                'flint_and_steel',
                [ingredient('iron_ingot', 1), ingredient('flint', 1)],
                1,
                'crafting_table',
                1,
            ),
            recipe('shield', [ingredient(PLANKS, 6), ingredient('iron_ingot', 1)], 1, 'crafting_table', 1),
            recipe('bread', [ingredient('wheat', 3)]),
        ].map((r) => [r.id, r]),
    ),
);
export const COOKING = Object.freeze({
    'minecraft:raw_iron': 'minecraft:iron_ingot',
    'minecraft:beef': 'minecraft:cooked_beef',
    'minecraft:porkchop': 'minecraft:cooked_porkchop',
    'minecraft:mutton': 'minecraft:cooked_mutton',
    'minecraft:chicken': 'minecraft:cooked_chicken',
});
export const PREY = Object.freeze({
    'minecraft:cow': 'minecraft:beef',
    'minecraft:pig': 'minecraft:porkchop',
    'minecraft:sheep': 'minecraft:mutton',
    'minecraft:chicken': 'minecraft:chicken',
});
export const total = (inv, ids) => ids.reduce((n, id) => n + (inv[id] ?? 0), 0);
