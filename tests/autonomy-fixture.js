import { Production } from '../scripts/adapter/production.js';
import { RECIPES, COOKING } from '../scripts/autonomy/recipes.js';
import { fixture, air, stone } from './helpers.js';
import { keyOf, dist } from '../scripts/core/vec.js';
export class Stack {
    constructor(typeId, amount = 1) {
        this.typeId = typeId;
        this.amount = amount;
        this.maxAmount = Object.values(RECIPES).find((r) => r.output === typeId)?.maxAmount ?? 64;
        this.lore = [];
    }
    clone() {
        const s = new Stack(this.typeId, this.amount);
        s.nameTag = this.nameTag;
        s.lore = [...this.lore];
        return s;
    }
    getLore() {
        return this.lore;
    }
    getComponent() {
        return undefined;
    }
    getDynamicPropertyIds() {
        return [];
    }
}
export class Container {
    constructor(size = 36) {
        this.size = size;
        this.slots = Array(size).fill(undefined);
        this.writes = 0;
        this.failAt = undefined;
        this.failAlways = false;
    }
    getItem(i) {
        return this.slots[i]?.clone();
    }
    get emptySlotsCount() {
        return this.slots.filter((s) => !s).length;
    }
    setItem(i, item) {
        this.writes++;
        if (this.failAlways || this.writes === this.failAt) throw new Error('injected container failure');
        this.slots[i] = item?.clone();
    }
    swapItems(i, j, other) {
        const a = this.getItem(i),
            b = other.getItem(j);
        this.setItem(i, b);
        other.setItem(j, a);
    }
    transferItem(i, other) {
        const item = this.getItem(i);
        if (!item) return;
        const rem = other.add(item);
        this.setItem(i, rem);
        return rem;
    }
    add(item) {
        let n = item.amount;
        for (let i = 0; i < this.size && n > 0; i++) {
            const s = this.slots[i];
            if (s?.typeId === item.typeId && s.amount < s.maxAmount && !s.nameTag) {
                const a = Math.min(n, s.maxAmount - s.amount);
                s.amount += a;
                n -= a;
            }
        }
        for (let i = 0; i < this.size && n > 0; i++)
            if (!this.slots[i]) {
                const s = item.clone();
                s.amount = Math.min(n, s.maxAmount);
                this.slots[i] = s;
                n -= s.amount;
            }
        if (n) {
            const rem = item.clone();
            rem.amount = n;
            return rem;
        }
    }
    counts() {
        const out = {};
        for (const s of this.slots) if (s) out[s.typeId] = (out[s.typeId] ?? 0) + s.amount;
        return out;
    }
}
export function productionFixture() {
    const f = fixture({ position: { x: 0.5, y: 64, z: 0.5 } }),
        inventory = new Container(),
        blocks = new Map(),
        furnaces = new Map(),
        drops = [],
        animals = [];
    const key = (p) => keyOf({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
    const blockAt = (p) => blocks.get(key(p)) ?? (Math.floor(p.y) <= 63 ? stone : air);
    const put = (p, id) =>
        blocks.set(
            key(p),
            id === 'minecraft:air' ? air : { typeId: id, solid: true, air: false, liquid: false },
        );
    const getBlock = (p) => {
        const b = blockAt(p);
        return {
            ...b,
            isAir: b.air,
            isSolid: b.solid,
            location: p,
            getComponent: () => ({ container: furnaces.get(key(p)) }),
        };
    };
    const sim = {
        location: f.snap.position,
        dimension: { id: f.snap.dimension, getBlock },
        getComponent: () => ({ container: inventory }),
        useItemInSlotOnBlock(slot, support) {
            const s = inventory.getItem(slot);
            if (!s) return false;
            const p = { ...support, y: support.y + 1 };
            if (!blockAt(p).air) return false;
            put(p, s.typeId);
            if (s.typeId === 'minecraft:furnace') furnaces.set(key(p), new Container(3));
            s.amount--;
            inventory.setItem(slot, s.amount ? s : undefined);
            return true;
        },
    };
    f.ctx.body.player = sim;
    f.ctx.body.selectItem = (score) => inventory.slots.findIndex((s) => s && score(s.typeId) > 0);
    f.ctx.body.production = new Production(f.ctx.body, (id, n) => new Stack(id, n), 'Up');
    f.ctx.body.navigateTo = (p) => {
        f.snap.position = { ...p };
        sim.location = f.snap.position;
        return 'full';
    };
    f.ctx.body.snapshot = () => {
        f.snap.inventory = inventory.counts();
        f.snap.emptySlots = inventory.emptySlotsCount;
        sim.dimension.id = f.snap.dimension;
        return f.snap;
    };
    f.ctx.body.entityInfo = (id) => {
        const a = animals.find((a) => a.id === id);
        return a && { ...a, alive: a.hp > 0, dimension: f.snap.dimension };
    };
    f.ctx.world.blockAt = blockAt;
    f.ctx.world.droppedItemsNear = (p, r) => drops.filter((d) => dist(d.position, p) <= r);
    f.ctx.world.animalsNear = (p, r) => animals.filter((a) => a.hp > 0 && dist(a.position, p) <= r);
    let mined = 0;
    f.ctx.body.breakBlock = (p) => {
        const b = blockAt(p);
        if (!b.solid) return false;
        const id = b.typeId.endsWith('_log')
            ? b.typeId
            : {
                  'minecraft:stone': 'minecraft:cobblestone',
                  'minecraft:iron_ore': 'minecraft:raw_iron',
                  'minecraft:coal_ore': 'minecraft:coal',
                  'minecraft:gravel': 'minecraft:flint',
              }[b.typeId];
        if (!id) return false;
        put(p, 'minecraft:air');
        drops.push({ id: `drop-${++mined}`, typeId: id, position: { x: p.x + 0.5, y: p.y, z: p.z + 0.5 } });
        return true;
    };
    f.ctx.body.attackEntity = (id) => {
        const a = animals.find((a) => a.id === id);
        if (!a) return false;
        a.hp -= 4;
        if (a.hp <= 0)
            drops.push({ id: `meat-${id}`, typeId: 'minecraft:beef', position: a.position, amount: 3 });
        return true;
    };
    function engineTick() {
        for (let i = drops.length - 1; i >= 0; i--)
            if (dist(drops[i].position, f.snap.position) < 1.3) {
                inventory.add(new Stack(drops[i].typeId, drops[i].amount ?? 1));
                drops.splice(i, 1);
            }
        // Accelerated deterministic mock furnace, NOT a claim about real game timing.
        if (f.snap.tick % 20 === 0)
            for (const c of furnaces.values()) {
                const input = c.getItem(0),
                    fuel = c.getItem(1),
                    out = c.getItem(2);
                if (!input || !COOKING[input.typeId] || (!fuel && !c.burns)) continue;
                if (!c.burns && fuel) {
                    c.burns = fuel.typeId.endsWith('_planks') ? 1 : 8;
                    fuel.amount--;
                    c.setItem(1, fuel.amount ? fuel : undefined);
                }
                if (out && out.typeId !== COOKING[input.typeId]) continue;
                c.setItem(2, new Stack(COOKING[input.typeId], (out?.amount ?? 0) + 1));
                input.amount--;
                c.setItem(0, input.amount ? input : undefined);
                c.burns--;
            }
    }
    return { ...f, inventory, blocks, furnaces, drops, animals, put, engineTick, sim };
}
