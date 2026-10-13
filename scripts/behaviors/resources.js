/** Harvesting is always survival breakBlock + physical pickup, never inventory injection. */
const isLog = (id) => id.startsWith('minecraft:') && id.endsWith('_log') && !id.includes('stripped_');
const oneOf = (...ids) => (id) => ids.includes(id.replace('minecraft:', ''));
export const RESOURCES = {
    wood: { label: 'wood', blockMatch: isLog, itemMatch: (id) => id.endsWith('_log'), tier: 0 },
    cobblestone: { label: 'cobblestone', blockMatch: oneOf('stone', 'cobblestone'), itemMatch: oneOf('cobblestone'), tier: 1 },
    iron: { label: 'raw iron', blockMatch: oneOf('iron_ore', 'deepslate_iron_ore'), itemMatch: oneOf('raw_iron'), tier: 2 },
    coal: { label: 'coal', blockMatch: oneOf('coal_ore', 'deepslate_coal_ore'), itemMatch: oneOf('coal'), tier: 1 },
    gravel: { label: 'gravel', blockMatch: oneOf('gravel'), itemMatch: oneOf('gravel'), tier: 0 },
};
