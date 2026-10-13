/** Overworld logs only. Stripped logs are excluded (not a natural tree block). */
const isLog = (id) => id.startsWith('minecraft:') && id.endsWith('_log') && !id.includes('stripped_');
export const RESOURCES = {
    wood: { label: 'wood', blockMatch: isLog, itemMatch: (id) => id.endsWith('_log') },
};
