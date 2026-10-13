import { clearReach } from '../autonomy/navigation.js';
import { commitCraft } from '../autonomy/crafting.js';
import { COOKING, RECIPES } from '../autonomy/recipes.js';
import { dist, keyOf } from '../core/vec.js';
import { hazardous } from '../core/safety.js';
const floor = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
/** Explicit MODDED crafting/container bridge; no recipe output without real ingredient debit. */
export class Production {
    enabled = false;
    fault;
    furnaces = new Map();
    constructor(body, makeStack, up) {
        this.body = body;
        this.makeStack = makeStack;
        this.up = up;
    }
    get sim() {
        return this.body.player;
    }
    key(p) {
        return `${this.sim.dimension.id}|${keyOf(floor(p))}`;
    }
    inventory() {
        return this.sim.getComponent('minecraft:inventory')?.container;
    }
    block(pos) {
        return this.sim.dimension.getBlock(floor(pos));
    }
    near(pos) {
        const view = {
            blockAt: (p) => {
                const b = this.block(p);
                return b && { typeId: b.typeId, solid: b.isSolid, air: b.isAir, liquid: b.isLiquid };
            },
        };
        return dist(this.sim.location, pos) <= 4.5 && clearReach(view, this.sim.location, floor(pos), 4.5);
    }
    craft(recipeId, station) {
        if (!this.enabled || this.fault)
            return {
                ok: false,
                fatal: !!this.fault,
                reason: this.fault ?? 'assisted crafting is not authorized',
            };
        const r = Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : undefined;
        if (!r) return { ok: false, reason: 'recipe not allowed' };
        try {
            if (
                r.station &&
                (!station || !this.near(station) || this.block(station)?.typeId !== `minecraft:${r.station}`)
            )
                return { ok: false, reason: 'required crafting station is absent/out of reach' };
            const c = this.inventory();
            if (!c) return { ok: false, reason: 'inventory unavailable' };
            const result = commitCraft(c, this.makeStack, recipeId);
            if (result.fatal) this.fault = result.reason;
            this.body.cache = undefined;
            return result;
        } catch (e) {
            return { ok: false, reason: String(e) };
        }
    }
    place(itemId, pos) {
        if (
            !this.enabled ||
            this.fault ||
            !['minecraft:crafting_table', 'minecraft:furnace', 'minecraft:gravel'].includes(itemId)
        )
            return false;
        try {
            const p = floor(pos),
                support = { ...p, y: p.y - 1 },
                target = this.block(p),
                below = this.block(support);
            if (
                !this.near(p) ||
                !target?.isAir ||
                !below?.isSolid ||
                hazardous(below) ||
                dist(this.sim.location, p) < 1
            )
                return false;
            const slot = this.body.selectItem((id) => (id === itemId ? 1 : 0));
            return (
                slot >= 0 && this.sim.useItemInSlotOnBlock(slot, support, this.up, { x: 0.5, y: 1, z: 0.5 })
            );
        } catch {
            return false;
        }
    }
    ownFurnace(pos) {
        if (!this.enabled || this.block(pos)?.typeId !== 'minecraft:furnace') return;
        const key = this.key(pos);
        this.furnaces.set(key, floor(pos));
        if (this.furnaces.size > 32) this.furnaces.delete(this.furnaces.keys().next().value);
    }
    furnace(pos) {
        if (!this.furnaces.has(this.key(pos))) return undefined; // never take over a human furnace
        const b = this.block(pos);
        if (!['minecraft:furnace', 'minecraft:lit_furnace'].includes(b?.typeId)) return undefined;
        return b.getComponent('minecraft:inventory')?.container;
    }
    furnaceState(pos) {
        try {
            const c = this.furnace(pos);
            if (!c) return undefined;
            const slot = (i) => {
                const s = c.getItem(i);
                return s && { typeId: s.typeId, amount: s.amount };
            };
            return { input: slot(0), fuel: slot(1), output: slot(2) };
        } catch {
            return undefined;
        }
    }
    serviceFurnace(pos, input) {
        if (!this.enabled || this.fault || !Object.hasOwn(COOKING, input))
            return { ok: false, reason: 'furnace action unauthorized' };
        try {
            if (!this.near(pos)) return { ok: false, reason: 'furnace out of reach' };
            const c = this.furnace(pos),
                inventory = this.inventory();
            if (!c || c.size !== 3 || !inventory) return { ok: false, reason: 'owned furnace unavailable' };
            // Native cross-container transfer: leftovers remain in the furnace, never spawned/deleted.
            if (c.getItem(2)) c.transferItem(2, inventory);
            const existing = c.getItem(0);
            if (existing && existing.typeId !== input)
                return { ok: false, reason: `furnace busy with ${existing.typeId}` };
            const move = (to, match) => {
                if (c.getItem(to)) return;
                for (let i = 0; i < inventory.size; i++) {
                    const s = inventory.getItem(i);
                    if (s && match(s.typeId)) {
                        inventory.swapItems(i, to, c);
                        break;
                    }
                }
            };
            move(0, (id) => id === input);
            move(
                1,
                (id) =>
                    id === 'minecraft:coal' ||
                    id === 'minecraft:charcoal' ||
                    /minecraft:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_planks$/.test(
                        id,
                    ),
            );
            this.body.cache = undefined;
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: `furnace transfer failed: ${String(e)}` };
        }
    }
}
