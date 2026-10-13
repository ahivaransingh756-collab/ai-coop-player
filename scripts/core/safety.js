const HAZARDS = new Set(['lava', 'fire', 'soul_fire', 'magma', 'cactus', 'sweet_berry_bush', 'powder_snow', 'campfire', 'soul_campfire']);
export const hazardous = (block) => !!block && HAZARDS.has(block.typeId.replace('minecraft:', ''));
export const TOOL_TIERS = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
export function pickaxeTier(id) {
    const match = /^minecraft:(\w+)_pickaxe$/.exec(id);
    return match ? TOOL_TIERS[match[1]] ?? 0 : 0;
}
// Deliberately exclude raw/poisonous food. Values are food points, not saturation.
export const FOODS = Object.freeze({
    'minecraft:cooked_beef': 8, 'minecraft:cooked_porkchop': 8,
    'minecraft:cooked_mutton': 6, 'minecraft:cooked_chicken': 6,
    'minecraft:cooked_salmon': 6, 'minecraft:cooked_cod': 5,
    'minecraft:bread': 5, 'minecraft:baked_potato': 5,
    'minecraft:carrot': 3, 'minecraft:apple': 4, 'minecraft:golden_carrot': 6,
});
export const foodPoints = (inventory) => Object.entries(inventory).reduce((n, [id, count]) => n + (FOODS[id] ?? 0) * count, 0);
/** Conservative local excavation veto; unknown neighbors are NOT assumed safe. */
export function canExcavate(world, block, feet) {
    if (Math.floor(feet.x) === block.x && Math.floor(feet.z) === block.z && block.y < feet.y)
        return false; // never mine the supporting column beneath ourselves
    for (const [x, y, z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const b = world.blockAt({ x: block.x + x, y: block.y + y, z: block.z + z });
        if (!b || b.liquid || hazardous(b)) return false;
        if (y === 1 && /:(sand|red_sand|gravel)$/.test(b.typeId)) return false;
    }
    return true;
}

export function safeSpawnNear(world, position) {
    for (const [dx, dz] of [[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,-1],[0,0]]) {
        const p = { x: Math.floor(position.x) + dx, y: Math.floor(position.y), z: Math.floor(position.z) + dz };
        const floor = world.blockAt({ ...p, y: p.y - 1 });
        const feet = world.blockAt(p), head = world.blockAt({ ...p, y: p.y + 1 });
        if (floor?.solid && !hazardous(floor) && feet?.air && head?.air)
            return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
    }
    return undefined;
}
