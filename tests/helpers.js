import { DEFAULT_CONFIG } from '../scripts/config/index.js';
import { WorldMemory } from '../scripts/core/memory.js';
import { RunState } from '../scripts/speedrun/runState.js';
import { observed } from '../scripts/core/types.js';
export const air = { typeId: 'minecraft:air', air: true, solid: false, liquid: false };
export const stone = { typeId: 'minecraft:stone', air: false, solid: true, liquid: false };
export function fixture(overrides = {}) {
    const snap = { tick: 0, alive: true, dimension: 'minecraft:overworld', position: { x: 0, y: 64, z: 0 }, onGround: true, inventory: {}, emptySlots: 20, hostiles: [], health: observed(20, 0), hunger: observed(20, 0), human: { kind: 'unknown' }, ...overrides };
    const calls = [], messages = [];
    const body = { snapshot: () => snap, say: m => messages.push(m), navigateTo: () => 'full', navigateToBlock: () => 'full', navigateToEntity: () => 'full', equipPickaxe: () => true, equipBestWeapon: () => true, attackEntity: () => true, useFood: () => true, respawn: () => true, lookAt() {},
        stopMoving: () => calls.push('stopMoving'), stopBreaking: () => calls.push('stopBreaking'), stopUsingItem: () => calls.push('stopUsingItem'), breakBlock: () => { calls.push('breakBlock'); return true; } };
    const ctx = { body, cfg: structuredClone(DEFAULT_CONFIG), memory: new WorldMemory(), run: new RunState(), log: { info() {}, warn() {}, error() {} }, world: { blockAt: () => air, droppedItemsNear: () => [] } };
    ctx.cfg.autoDefend = false;
    return { ctx, snap, calls, messages };
}
