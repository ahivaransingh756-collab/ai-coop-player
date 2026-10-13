import { dist } from './vec.js';
/** Hostiles near the human first (protect the teammate), then nearest to the bot. */
export function pickThreats(hostiles, botPos, humanPos, radius) {
    const neutral = new Set(['minecraft:enderman', 'minecraft:piglin', 'minecraft:zombie_pigman', 'minecraft:zombified_piglin']);
    const near = hostiles.filter((h) => !neutral.has(h.typeId) && h.typeId !== 'minecraft:ender_dragon').filter((h) => dist(h.position, botPos) <= radius || (humanPos !== undefined && dist(h.position, humanPos) <= radius));
    const score = (h) => (humanPos ? dist(h.position, humanPos) * 1.5 : 0) + dist(h.position, botPos);
    return near.sort((a, b) => score(a) - score(b));
}
const WEAPON_RANK = {
    netherite_sword: 100, diamond_sword: 90, iron_sword: 80, stone_sword: 70, golden_sword: 60, wooden_sword: 50,
    netherite_axe: 45, diamond_axe: 42, iron_axe: 40, stone_axe: 35, golden_axe: 30, wooden_axe: 25,
};
/** Higher is better; 0 = not a weapon. */
export const weaponRank = (typeId) => WEAPON_RANK[typeId.replace('minecraft:', '')] ?? 0;
