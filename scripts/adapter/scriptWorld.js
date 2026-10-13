import { PREY } from '../autonomy/recipes.js';
import { system } from '@minecraft/server';
export class ScriptWorld {
    dimension;
    constructor(dimension) {
        this.dimension = dimension;
    }
    tick() { return system.currentTick; }
    blockAt(pos) {
        try {
            const b = this.dimension()?.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
            if (!b)
                return undefined; // unloaded chunk: unknown, not air
            return { typeId: b.typeId, solid: b.isSolid, air: b.isAir, liquid: b.isLiquid };
        }
        catch {
            return undefined;
        }
    }
    animalsNear(pos, radius) {
        const out = [];
        try {
            const dim = this.dimension();
            if (!dim) return out;
            // Whitelist queries: no players, pets or neutral combat mobs are food targets.
            for (const type of Object.keys(PREY)) for (const e of dim.getEntities({ type, location: pos, maxDistance: radius })) {
                out.push({ id: e.id, typeId: e.typeId, position: e.location, baby: !!e.getComponent('minecraft:is_baby'), protected: !!e.nameTag || !!e.getComponent('minecraft:tameable')?.isTamed });
            }
        } catch { /* unavailable entities */ }
        return out;
    }
    droppedItemsNear(pos, radius) {
        const dim = this.dimension();
        if (!dim)
            return [];
        const out = [];
        try {
            for (const e of dim.getEntities({ type: 'minecraft:item', location: pos, maxDistance: radius })) {
                const stack = e.getComponent('minecraft:item')?.itemStack;
                if (stack)
                    out.push({ id: e.id, typeId: stack.typeId, position: e.location });
            }
        }
        catch { /* chunk unloaded mid-query */ }
        return out;
    }
}
