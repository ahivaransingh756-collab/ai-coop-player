import test from 'node:test';
import assert from 'node:assert/strict';
import { planCraft, commitCraft } from '../scripts/autonomy/crafting.js';
import { RECIPES } from '../scripts/autonomy/recipes.js';
import { Perception } from '../scripts/autonomy/perception.js';
import { reachable, pathTo, safeStep, SafeWalk } from '../scripts/autonomy/navigation.js';
import { planNext } from '../scripts/autonomy/planner.js';
import { Action } from '../scripts/autonomy/actions.js';
import { AutonomousController } from '../scripts/autonomy/controller.js';
import { Brain } from '../scripts/speedrun/brain.js';
import { buildSpeedrunGraph } from '../scripts/speedrun/graph.js';
import { Telemetry } from '../scripts/core/telemetry.js';
import { fixture, air, stone } from './helpers.js';
import { Stack, Container, productionFixture } from './autonomy-fixture.js';
import { observed } from '../scripts/core/types.js';
const mc = (id, n = 1) => ({ typeId: `minecraft:${id}`, amount: n, maxAmount: 64, eligible: true });
const env = {
    stations: { crafting_table: { x: 2, y: 64, z: 0 }, furnace: { x: 3, y: 64, z: 0 } },
    hasGravel: false,
};
test('crafting requires actual ingredients and never mutates dry-run input', () => {
    const slots = [mc('oak_log'), undefined];
    const original = JSON.stringify(slots);
    const result = planCraft(slots, 'oak_planks');
    assert.equal(result.ok, true);
    assert.equal(result.next[0].amount, 4);
    assert.equal(JSON.stringify(slots), original);
    assert.equal(planCraft(slots, 'iron_pickaxe').ok, false);
    assert.equal(planCraft(slots, '__proto__').ok, false);
    assert.equal(planCraft(slots, 'oak_planks', Infinity).ok, false);
});
test('crafting handles mixed planks and non-stackable output limits', () => {
    const result = planCraft([mc('oak_planks', 2), mc('birch_planks', 2)], 'crafting_table');
    assert.equal(result.ok, true);
    assert.equal(result.next.filter(Boolean).length, 1);
    const slots = [mc('iron_ingot', 6), mc('stick', 4), undefined, undefined];
    const picks = planCraft(slots, 'iron_pickaxe', 2);
    assert.equal(picks.ok, true);
    assert.equal(picks.next.filter(Boolean).length, 2);
    assert.ok(picks.next.filter(Boolean).every((s) => s.amount === 1));
});
test('full inventory craft rejects overflow without consuming anything', () => {
    const slots = [mc('oak_planks', 64)];
    assert.equal(planCraft(slots, 'stick').ok, false);
    assert.equal(slots[0].amount, 64);
});
test('named ingredients are protected and successful commits debit ingredients', () => {
    const c = new Container(4),
        s = new Stack('minecraft:oak_log', 2);
    s.nameTag = 'Keepsake';
    c.setItem(0, s);
    assert.equal(commitCraft(c, (id, n) => new Stack(id, n), 'oak_planks').ok, false);
    s.nameTag = undefined;
    c.setItem(0, s);
    assert.equal(commitCraft(c, (id, n) => new Stack(id, n), 'oak_planks').ok, true);
    assert.deepEqual(c.counts(), { 'minecraft:oak_log': 1, 'minecraft:oak_planks': 4 });
});
test('write fault rolls back exact inventory; rollback fault becomes fatal', () => {
    const c = new Container(4);
    c.setItem(0, new Stack('minecraft:oak_log', 2));
    const before = c.counts();
    c.failAt = c.writes + 2;
    const r = commitCraft(c, (id, n) => new Stack(id, n), 'oak_planks');
    assert.equal(r.ok, false);
    assert.equal(r.fatal, undefined);
    assert.deepEqual(c.counts(), before);
    c.failAlways = true;
    assert.equal(commitCraft(c, (id, n) => new Stack(id, n), 'oak_planks').fatal, true);
});
test('all allowlisted recipes produce exact outputs for exact inputs', () => {
    for (const r of Object.values(RECIPES)) {
        const slots = r.inputs.map((i) => ({ ...mc(i.ids[0].slice(10), i.count) }));
        while (slots.length < 10) slots.push(undefined);
        const plan = planCraft(slots, r.id);
        assert.ok(plan.ok, r.id);
        assert.deepEqual(
            plan.next.filter(Boolean).map((s) => [s.typeId, s.amount]),
            [[r.output, r.amount]],
            r.id,
        );
    }
});
test('production is opt-in and crafting station is checked live', () => {
    const f = productionFixture();
    f.inventory.add(new Stack('minecraft:oak_planks', 8));
    f.inventory.add(new Stack('minecraft:stick', 2));
    assert.equal(f.ctx.body.production.craft('wooden_pickaxe', { x: 2, y: 64, z: 0 }).ok, false);
    f.ctx.body.production.enabled = true;
    assert.equal(f.ctx.body.production.craft('wooden_pickaxe', { x: 2, y: 64, z: 0 }).ok, false);
    f.put({ x: 2, y: 64, z: 0 }, 'minecraft:crafting_table');
    assert.equal(f.ctx.body.production.craft('wooden_pickaxe', { x: 2, y: 64, z: 0 }).ok, true);
});
test('native placement consumes owned item and furnace ownership follows verification', () => {
    const f = productionFixture();
    f.ctx.body.production.enabled = true;
    f.inventory.add(new Stack('minecraft:furnace'));
    f.ctx.body.snapshot();
    const model = new Perception(),
        a = new Action({ kind: 'place', item: 'minecraft:furnace', target: { x: 2, y: 64, z: 0 } }, f.snap);
    assert.equal(a.tick(f.ctx, f.snap, model).status, 'running');
    f.snap.tick++;
    f.ctx.body.snapshot();
    assert.equal(a.tick(f.ctx, f.snap, model).status, 'succeeded');
    assert.ok(f.ctx.body.production.furnaceState({ x: 2, y: 64, z: 0 }));
    assert.equal(f.inventory.counts()['minecraft:furnace'], undefined);
});
test('furnace transfers conserve materials and never fabricate instant smelted output', () => {
    const f = productionFixture(),
        p = { x: 2, y: 64, z: 0 };
    f.put(p, 'minecraft:furnace');
    f.furnaces.set('2,64,0', new Container(3));
    const bridge = f.ctx.body.production;
    bridge.enabled = true;
    assert.equal(
        bridge.serviceFurnace(p, 'minecraft:raw_iron').ok,
        false,
        'must not touch a foreign furnace',
    );
    bridge.ownFurnace(p);
    f.inventory.add(new Stack('minecraft:raw_iron', 3));
    f.inventory.add(new Stack('minecraft:coal', 1));
    assert.equal(bridge.serviceFurnace(p, 'minecraft:raw_iron').ok, true);
    assert.equal(f.inventory.counts()['minecraft:iron_ingot'], undefined);
    assert.equal(bridge.furnaceState(p).input.amount, 3);
    f.snap.tick = 20;
    f.engineTick();
    bridge.serviceFurnace(p, 'minecraft:raw_iron');
    assert.equal(f.inventory.counts()['minecraft:iron_ingot'], 1);
    assert.equal(bridge.furnaceState(p).input.amount, 2);
});
test('perception enforces query/memory budgets, TTL and dimension isolation', () => {
    const model = new Perception({ radius: 3, probes: 7, maxCells: 10, ttl: 5 });
    let reads = 0;
    const world = {
            blockAt: () => {
                reads++;
                return stone;
            },
        },
        s = fixture().snap;
    model.observe(world, s);
    assert.equal(reads, 7);
    assert.equal(model.cells.size, 7);
    s.tick++;
    model.observe(world, s);
    assert.equal(model.cells.size, 10);
    assert.equal(model.view(100).blockAt({ x: 0, y: 64, z: 0 }), undefined);
    s.dimension = 'minecraft:nether';
    model.observe({ blockAt: () => undefined }, s);
    assert.equal(model.cells.size, 0);
});
test('safe navigation cannot cross unknown blocks, lava, gaps or diagonal corners', () => {
    const flat = { blockAt: (p) => (p.y === 63 ? stone : air) };
    const nodes = reachable(flat, { x: 0, y: 64, z: 0 }, 100, 4);
    assert.ok(pathTo(nodes, { x: 3, y: 64, z: 0 }));
    const wall = { blockAt: (p) => (p.x === 1 ? undefined : flat.blockAt(p)) };
    assert.equal(pathTo(reachable(wall, { x: 0, y: 64, z: 0 }), { x: 2, y: 64, z: 0 }), undefined);
    assert.equal(safeStep(flat, { x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 1 }), false);
    const lava = {
        blockAt: (p) => (p.y === 63 ? { typeId: 'minecraft:lava', solid: false, liquid: true } : air),
    };
    assert.equal(reachable(lava, { x: 0, y: 64, z: 0 }).size, 1);
});
test('navigation revalidates terrain after a path was planned', () => {
    const f = fixture(),
        walk = new SafeWalk([{ x: 1.5, y: 64, z: 0.5 }], f.snap.dimension);
    f.ctx.world.blockAt = () => undefined;
    assert.equal(walk.tick(f.ctx, f.snap).status, 'failed');
});
test('planner recursively bootstraps tools instead of waiting on a human', () => {
    const { snap } = fixture();
    assert.equal(planNext(snap, { stations: {} }).resource, 'wood');
    snap.inventory = { 'minecraft:oak_log': 1 };
    assert.equal(planNext(snap, { stations: {} }).recipe, 'oak_planks');
    snap.inventory = { 'minecraft:crafting_table': 1 };
    assert.equal(planNext(snap, { stations: {} }).kind, 'place');
    snap.inventory = { 'minecraft:oak_planks': 3, 'minecraft:stick': 2 };
    assert.equal(planNext(snap, env).recipe, 'wooden_pickaxe');
    snap.inventory = { 'minecraft:wooden_pickaxe': 1 };
    assert.equal(planNext(snap, env).resource, 'cobblestone');
});
test('planner replans lost tools and requires live food/items for completion', () => {
    const { snap } = fixture({
        inventory: {
            'minecraft:iron_pickaxe': 1,
            'minecraft:iron_sword': 1,
            'minecraft:bucket': 1,
            'minecraft:flint_and_steel': 1,
            'minecraft:shield': 1,
            'minecraft:bread': 8,
        },
    });
    assert.equal(planNext(snap, env).kind, 'complete');
    delete snap.inventory['minecraft:bread'];
    assert.equal(planNext(snap, env).kind, 'hunt');
    delete snap.inventory['minecraft:iron_pickaxe'];
    assert.notEqual(planNext(snap, env).kind, 'complete');
});
test('planner preserves queued furnace inputs instead of reacquiring them', () => {
    const { snap } = fixture({
        inventory: {
            'minecraft:stone_pickaxe': 1,
            'minecraft:stone_sword': 1,
            'minecraft:bread': 8,
            'minecraft:oak_planks': 4,
            'minecraft:stick': 4,
        },
    });
    const result = planNext(snap, {
        ...env,
        furnace: {
            input: { typeId: 'minecraft:raw_iron', amount: 3 },
            fuel: { typeId: 'minecraft:coal', amount: 1 },
        },
    });
    assert.equal(result.kind, 'smelt');
    assert.equal(result.input, 'minecraft:raw_iron');
});
test('controller stop revokes bridge authorization and cancels physical actions', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    c.start();
    assert.equal(f.ctx.body.production.enabled, true);
    c.stop();
    assert.equal(f.ctx.body.production.enabled, false);
    assert.equal(c.state, 'idle');
});
test('controller fails closed on transaction faults and unknown health', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    c.start();
    f.ctx.body.production.fault = 'rollback fault';
    c.tick(f.snap);
    assert.equal(c.state, 'blocked');
    assert.equal(f.ctx.body.production.enabled, false);
    f.ctx.body.production.fault = undefined;
    c.start();
    f.snap.health = { kind: 'unknown' };
    c.tick(f.snap);
    assert.equal(c.state, 'blocked');
});
test('controller does not report an autonomous dragon victory in unsupported dimensions', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    c.start();
    f.snap.dimension = 'minecraft:nether';
    c.tick(f.snap);
    assert.equal(c.state, 'blocked');
    assert.match(c.reason, /Unsupported/);
});
test('controller aborts repeated deaths instead of respawn looping forever', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    c.start();
    for (let i = 0; i < 3; i++) {
        f.snap.alive = false;
        f.snap.tick += 40;
        c.tick(f.snap);
        if (i < 2) {
            f.snap.alive = true;
            f.snap.tick++;
            c.tick(f.snap);
        }
    }
    assert.equal(c.state, 'blocked');
    assert.equal(c.deaths, 3);
});
test('Brain auto mode delegates decisions and stop returns control without recipe permission', () => {
    const f = productionFixture(),
        b = new Brain({ ctx: f.ctx, graph: buildSpeedrunGraph(), telemetry: new Telemetry(), behaviors: [] });
    assert.match(b.autonomous(), /MODDED/);
    assert.equal(b.base.type, 'autonomous');
    b.tick();
    b.stop();
    assert.equal(f.ctx.body.production.enabled, false);
});
test('closed-loop mocked world: autonomous production from empty inventory, no human handoffs', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    // Deterministic resource-rich test area. This is not a random-seed or real-engine test.
    for (let x = -6; x <= 6; x += 2)
        for (let z = -6; z <= 6; z += 2) {
            if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;
            f.put(
                { x, y: 64, z },
                x < 0
                    ? 'minecraft:oak_log'
                    : z < 0
                      ? 'minecraft:iron_ore'
                      : z === 0
                        ? 'minecraft:gravel'
                        : 'minecraft:stone',
            );
        }
    f.animals.push(
        ...Array.from({ length: 5 }, (_, i) => ({
            id: `cow${i}`,
            typeId: 'minecraft:cow',
            position: { x: 3.5, y: 64, z: 3.5 + i },
            hp: 4,
            baby: false,
        })),
    );
    c.start();
    for (f.snap.tick = 0; f.snap.tick < 18000 && c.state === 'running'; f.snap.tick++) {
        f.engineTick();
        f.ctx.body.snapshot();
        c.tick(f.snap);
    }
    assert.equal(
        c.state,
        'complete',
        JSON.stringify(
            {
                reason: c.reason,
                inventory: f.inventory.counts(),
                position: f.snap.position,
                history: c.history.slice(-10),
            },
            null,
            2,
        ),
    );
    const inv = f.inventory.counts();
    for (const id of ['iron_pickaxe', 'iron_sword', 'bucket', 'flint_and_steel', 'shield'])
        assert.ok(inv[`minecraft:${id}`] >= 1, id);
    assert.ok(c.history.some((e) => e.reason.includes('engine-smelted')));
    assert.equal(f.ctx.body.production.enabled, false);
});
test('old sightings guide exploration but are not usable as current block evidence', () => {
    const m = new Perception({ ttl: 2 }),
        p = { x: 2, y: 64, z: 0 };
    m.remember(p, { typeId: 'minecraft:iron_ore', solid: true }, 0);
    assert.equal(m.view(10).blockAt(p), undefined);
    assert.equal(m.remembered((id) => id === 'minecraft:iron_ore', { x: 0, y: 64, z: 0 }, 10).length, 1);
    m.remember(p, air, 11);
    assert.equal(m.remembered(() => true, p, 11).length, 0);
});
test('ordinary stone cannot evict important workstation and rare-resource hints', () => {
    const m = new Perception(),
        p = { x: 2, y: 64, z: 0 };
    m.remember(p, { typeId: 'minecraft:furnace', solid: true }, 0);
    for (let x = 10; x < 2000; x++) m.remember({ x, y: 63, z: 0 }, stone, 1);
    assert.equal(m.remembered((id) => id === 'minecraft:furnace', p, 2).length, 1);
});
test('switching furnace recipes first acquires fuel for the existing batch', () => {
    const { snap } = fixture({
        inventory: {
            'minecraft:stone_pickaxe': 1,
            'minecraft:stone_sword': 1,
            'minecraft:bread': 8,
            'minecraft:stick': 4,
        },
    });
    const job = planNext(snap, { ...env, furnace: { input: { typeId: 'minecraft:beef', amount: 1 } } });
    assert.equal(job.kind, 'harvest');
    assert.equal(job.resource, 'wood');
});
test('station access through a solid wall is rejected by the bridge', () => {
    const f = productionFixture();
    f.ctx.body.production.enabled = true;
    f.inventory.add(new Stack('minecraft:oak_planks', 4));
    f.inventory.add(new Stack('minecraft:stick', 2));
    f.put({ x: 3, y: 64, z: 0 }, 'minecraft:crafting_table');
    for (const y of [64, 65, 66]) f.put({ x: 1, y, z: 0 }, 'minecraft:stone');
    assert.equal(f.ctx.body.production.craft('wooden_pickaxe', { x: 3, y: 64, z: 0 }).ok, false);
});
test('hunting does not target protected/named or baby animals', () => {
    const f = productionFixture(),
        c = new AutonomousController(f.ctx);
    c.start();
    f.animals.push(
        { id: 'pet', typeId: 'minecraft:cow', position: { x: 2, y: 64, z: 0 }, hp: 8, protected: true },
        { id: 'baby', typeId: 'minecraft:cow', position: { x: 2, y: 64, z: 1 }, hp: 8, baby: true },
    );
    for (f.snap.tick = 0; f.snap.tick < 30; f.snap.tick++) c.model.observe(f.ctx.world, f.snap);
    const nodes = reachable(c.model.view(f.snap.tick), f.snap.position);
    assert.equal(c.resolve({ kind: 'hunt' }, f.snap, nodes, { stations: {} }), undefined);
});
test('failed targets are temporarily blacklisted then eligible for re-observation', () => {
    const m = new Perception();
    m.reject('ore', 10, 'blocked');
    assert.equal(m.blocked('ore', 11), true);
    assert.equal(m.blocked('ore', 211), false);
    m.reject('ore', 211, 'blocked again');
    assert.equal(m.blocked('ore', 500), true);
    assert.equal(m.blocked('ore', 612), false);
});
test('unexpected placement without item consumption is not verified', () => {
    const f = productionFixture();
    f.ctx.body.production.enabled = true;
    f.inventory.add(new Stack('minecraft:furnace'));
    f.ctx.body.snapshot();
    const p = { x: 2, y: 64, z: 0 },
        a = new Action({ kind: 'place', item: 'minecraft:furnace', target: p }, f.snap);
    a.issued = true;
    a.lastAct = 0;
    f.put(p, 'minecraft:furnace');
    f.snap.tick = 41;
    assert.equal(a.tick(f.ctx, f.snap, new Perception()).status, 'failed');
    assert.equal(f.ctx.body.production.furnaces.size, 0);
});
test('automatic mode requires explicit command confirmation', async () => {
    const { parseCommand } = await import('../scripts/core/commands.js');
    assert.equal(parseCommand('!bot auto').command.dangerous, true);
    assert.equal(parseCommand('!bot auto give_diamonds').ok, false);
});

test('already-complete inventory does not trigger unnecessary workstation construction', () => {
    const { snap } = fixture({
        inventory: {
            'minecraft:iron_pickaxe': 1,
            'minecraft:iron_sword': 1,
            'minecraft:bucket': 1,
            'minecraft:flint_and_steel': 1,
            'minecraft:shield': 1,
            'minecraft:bread': 8,
        },
    });
    assert.equal(planNext(snap, { stations: {} }).kind, 'complete');
});

test('failed crafting transaction latches bridge fault and rejects subsequent recipes', () => {
    const f = productionFixture();
    f.inventory.add(new Stack('minecraft:oak_log', 2));
    f.ctx.body.production.enabled = true;
    f.inventory.failAlways = true;
    assert.equal(f.ctx.body.production.craft('oak_planks').fatal, true);
    f.inventory.failAlways = false;
    assert.equal(f.ctx.body.production.craft('oak_planks').fatal, true);
    assert.ok(f.ctx.body.production.fault);
});
