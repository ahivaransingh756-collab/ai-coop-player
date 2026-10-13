import { system, world } from '@minecraft/server';
import { UNKNOWN, observed } from '../core/types.js';
import { weaponRank } from '../core/combat.js';
import { dist } from '../core/vec.js';
export class ScriptBody {
    sim;
    ownerName;
    cfg;
    cache;
    constructor(sim, ownerName, cfg) {
        this.sim = sim;
        this.ownerName = ownerName;
        this.cfg = cfg;
    }
    get player() { return this.sim; }
    valid() { try {
        return this.sim.isValid;
    }
    catch {
        return false;
    } }
    find(id) { try {
        return world.getEntity(id);
    }
    catch {
        return undefined;
    } }
    owner() {
        const n = this.ownerName();
        return n === undefined ? undefined : world.getAllPlayers().find((p) => p.name === n && p.id !== this.sim.id);
    }
    snapshot() {
        const tick = system.currentTick;
        if (this.cache?.tick === tick)
            return this.cache.snap;
        const snap = this.read(tick);
        this.cache = { tick, snap };
        return snap;
    }
    read(tick) {
        const human = this.owner();
        if (!this.valid()) {
            return { tick, alive: false, dimension: 'unknown', position: { x: 0, y: 0, z: 0 }, onGround: false, health: UNKNOWN, hunger: UNKNOWN, inventory: {}, emptySlots: 0, hostiles: [], human: UNKNOWN };
        }
        const sim = this.sim;
        const hp = sim.getComponent('minecraft:health')?.currentValue;
        const hunger = sim.getComponent('minecraft:player.hunger')?.currentValue;
        const inventory = {};
        const container = sim.getComponent('minecraft:inventory')?.container;
        if (container)
            for (let i = 0; i < container.size; i++) {
                const it = container.getItem(i);
                if (it)
                    inventory[it.typeId] = (inventory[it.typeId] ?? 0) + it.amount;
            }
        const hostiles = new Map();
        const scan = (center, dimension) => {
            try {
                for (const e of dimension.getEntities({ location: center, maxDistance: Math.max(24, this.cfg.combat.threatRadius * 2), families: ['monster'] })) {
                    if (e.id !== sim.id)
                        hostiles.set(e.id, { id: e.id, typeId: e.typeId, position: e.location, distance: dist(e.location, sim.location) });
                }
            }
            catch { /* unloaded */ }
        };
        scan(sim.location, sim.dimension);
        if (human && human.dimension.id === sim.dimension.id)
            scan(human.location, human.dimension);
        const hInfo = human && { name: human.name, position: human.location, dimension: human.dimension.id, health: this.healthOf(human, tick) };
        return {
            tick, alive: hp === undefined ? true : hp > 0, dimension: sim.dimension.id, position: sim.location, onGround: sim.isOnGround,
            health: hp === undefined ? UNKNOWN : observed(hp, tick), hunger: hunger === undefined ? UNKNOWN : observed(hunger, tick),
            inventory, emptySlots: container?.emptySlotsCount ?? 0, hostiles: [...hostiles.values()],
            human: hInfo ? observed(hInfo, tick) : UNKNOWN,
        };
    }
    healthOf(p, tick) {
        const v = p.getComponent('minecraft:health')?.currentValue;
        return v === undefined ? UNKNOWN : observed(v, tick);
    }
    nav(fn) {
        try {
            const r = fn();
            return r.isFullPath ? 'full' : r.getPath().length > 0 ? 'partial' : 'failed';
        }
        catch {
            return 'failed';
        }
    }
    navigateTo(pos, speed = 1) { return this.nav(() => this.sim.navigateToLocation(pos, speed)); }
    navigateToBlock(pos, speed = 1) { return this.nav(() => this.sim.navigateToBlock(pos, speed)); }
    navigateToEntity(id, speed = 1) {
        const e = this.find(id);
        return e ? this.nav(() => this.sim.navigateToEntity(e, speed)) : 'failed';
    }
    stopMoving() { try {
        this.sim.stopMoving();
    }
    catch { /* invalid */ } }
    lookAt(pos) { try {
        this.sim.lookAtLocation(pos);
    }
    catch { /* invalid */ } }
    breakBlock(pos) { try {
        return this.sim.breakBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
    }
    catch {
        return false;
    } }
    stopBreaking() { try {
        this.sim.stopBreakingBlock();
    }
    catch { /* invalid */ } }
    attackEntity(id) { const e = this.find(id); try {
        return e ? this.sim.attackEntity(e) : false;
    }
    catch {
        return false;
    } }
    teleportTo(pos) { try {
        this.sim.teleport(pos, { dimension: this.sim.dimension });
    }
    catch { /* invalid */ } }
    respawn() { try {
        return this.sim.respawn();
    }
    catch {
        return false;
    } }
    say(message) { world.sendMessage(`§b[${this.cfg.botName}]§r ${message}`); }
    equipBestWeapon() {
        try {
            const c = this.sim.getComponent('minecraft:inventory')?.container;
            if (!c)
                return false;
            let best = -1, rank = 0;
            for (let i = 0; i < c.size; i++) {
                const it = c.getItem(i);
                const r = it ? weaponRank(it.typeId) : 0;
                if (r > rank) {
                    rank = r;
                    best = i;
                }
            }
            if (best < 0)
                return false;
            if (best < 9)
                this.sim.selectedSlotIndex = best;
            else
                c.swapItems(best, this.sim.selectedSlotIndex, c);
            return true;
        }
        catch {
            return false;
        }
    }
}
