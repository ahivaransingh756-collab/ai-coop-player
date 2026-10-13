import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, ConfirmationGate } from '../scripts/core/commands.js';
import { TaskGraph } from '../scripts/core/taskGraph.js';
import { buildSpeedrunGraph } from '../scripts/speedrun/graph.js';
import { triangulate } from '../scripts/core/triangulation.js';
import { RunState } from '../scripts/speedrun/runState.js';
import { canExcavate, foodPoints, pickaxeTier } from '../scripts/core/safety.js';
import { pickThreats } from '../scripts/core/combat.js';
import { validateConfig } from '../scripts/config/index.js';
import { fixture, air } from './helpers.js';
const spec = (id, dependsOn = []) => ({ id, dependsOn, preconditions: [], requires: [], estimatedSeconds: 10, risk: 0, maxRetries: 2, timeoutTicks: 100 });
test('commands validate counts and finite coordinates and require confirmation for travel/run', () => {
    for (const cmd of ['!bot gather iron 0', '!bot gather wood 1.5', '!bot gather wood 65', '!bot eye NaN 3', '!bot eye 1 Infinity', '!bot drop @a', '!bot nope']) assert.equal(parseCommand(cmd).ok, false, cmd);
    for (const cmd of ['!bot gather iron 10', '!bot eye -134.2 240', '!bot drop minecraft:raw_iron', '!bot route']) assert.equal(parseCommand(cmd).ok, true, cmd);
    for (const cmd of ['!bot resume', '!bot go rally', '!bot reset run']) assert.equal(parseCommand(cmd).command.dangerous, true);
});
test('confirmation cannot be stolen/cancelled by another player and expires', () => {
    const gate = new ConfirmationGate(10), cmd = { name: 'resume' };
    gate.request('owner', cmd, 0);
    assert.equal(gate.confirm('other', 1), undefined);
    assert.deepEqual(gate.confirm('owner', 2), cmd);
    assert.equal(gate.confirm('owner', 3), undefined);
    gate.request('owner', cmd, 3);
    assert.equal(gate.confirm('owner', 14), undefined);
});
test('graph enforces dependencies and exponential retry backoff', () => {
    const g = new TaskGraph(); g.add(spec('a')); g.add(spec('b', ['a']));
    assert.equal(g.next({ tick: 0, inventory: {} }).spec.id, 'a');
    for (let i = 0; i < 3; i++) {
        g.start('a', i * 100);
        assert.equal(g.fail('a', 'no path', i * 100), i < 2 ? 'retry' : 'failed');
        assert.equal(g.next({ tick: i*100+1, inventory: {} }), undefined);
    }
    assert.equal(g.deadlocked()[0].spec.id, 'b');
    g.reopen('b'); assert.equal(g.get('a').status, 'pending');
});
test('progress rejects invalid statuses, negative attempts and impossible success chains', () => {
    const g = new TaskGraph(); g.add(spec('a')); g.add(spec('b', ['a']));
    for (const input of [null, [], 'invalid', { a: null }, { a: { status: 'succeeded', attempts: -1 } }]) g.importProgress(input);
    assert.equal(g.get('a').status, 'pending');
    g.importProgress({ b: { status: 'succeeded', attempts: 1 } }); assert.equal(g.get('b').status, 'pending');
    g.importProgress({ a: { status: 'succeeded', attempts: 1 }, b: { status: 'running', attempts: 1 } });
    assert.equal(g.get('a').status, 'succeeded'); assert.equal(g.get('b').status, 'pending');
});
test('run checkpoints are owner/version scoped and restore paused progress only', () => {
    const g = buildSpeedrunGraph(), run = new RunState();
    g.start('wood', 0); g.succeed('wood', 50); run.elapsedTicks = 50; run.split('wood');
    run.mark('rally', { x: 3, y: 64, z: 0 }, 'minecraft:overworld');
    const raw = run.serialize('owner', g), restoredGraph = buildSpeedrunGraph();
    const restored = RunState.restore(raw, 'owner', restoredGraph);
    assert.equal(restored.elapsedTicks, 50); assert.equal(restoredGraph.get('wood').status, 'succeeded');
    assert.equal(restored.waypoints.rally.pos.x, 3);
    const other = buildSpeedrunGraph(); RunState.restore(raw, 'other', other); assert.equal(other.get('wood').status, 'pending');
    assert.equal(RunState.restore('{bad', 'owner', other).elapsedTicks, 0);
});
test('waypoints and portal observations are dimension/range/live-block checked', () => {
    const { ctx, snap } = fixture();
    assert.throws(() => ctx.run.mark('nether_portal', snap.position, snap.dimension));
    assert.throws(() => ctx.run.mark('__proto__', snap.position, snap.dimension));
    ctx.run.mark('overworld_portal', snap.position, snap.dimension);
    assert.equal(ctx.run.verifyPortal('overworld_portal', snap, ctx.world), false);
    ctx.world.blockAt = () => ({ typeId: 'minecraft:portal' });
    assert.ok(ctx.run.verifyPortal('overworld_portal', snap, ctx.world));
    snap.position = { x: 100, y: 64, z: 0 }; assert.equal(ctx.run.verifyPortal('overworld_portal', snap, ctx.world), false);
});
test('dragon absence or unrelated deaths never prove victory', () => {
    const { ctx, snap } = fixture({ dimension: 'minecraft:the_end' });
    const event = { typeId: 'minecraft:ender_dragon', position: snap.position, dimension: snap.dimension };
    assert.equal(ctx.run.dragonDeath, undefined);
    assert.equal(ctx.run.recordDragonDeath(event, snap, false), false);
    assert.equal(ctx.run.recordDragonDeath({ ...event, typeId: 'minecraft:zombie' }, snap, true), false);
    assert.equal(ctx.run.recordDragonDeath({ ...event, position: { x: 999, y: 64, z: 0 } }, snap, true), false);
    assert.equal(ctx.run.recordDragonDeath(event, snap, true), true);
});
test('triangulation solves intersecting forward rays with residual', () => {
    const r = triangulate([{ x: 0, z: 0, dx: 1, dz: 1 }, { x: 100, z: 0, dx: -1, dz: 1 }]);
    assert.equal(r.ok, true); assert.ok(Math.abs(r.x-50) < 1e-8); assert.ok(Math.abs(r.z-50) < 1e-8); assert.ok(r.residual < 1e-8);
});
test('triangulation rejects insufficient, parallel, backwards, zero and nonfinite rays', () => {
    for (const r of [[], [{x:0,z:0,dx:1,dz:0},{x:0,z:50,dx:1,dz:0}], [{x:0,z:0,dx:-1,dz:-1},{x:100,z:0,dx:1,dz:-1}], [{x:0,z:0,dx:0,dz:0},{x:0,z:1,dx:1,dz:1}], [{x:NaN,z:0,dx:1,dz:1},{x:0,z:1,dx:1,dz:1}]]) assert.equal(triangulate(r).ok, false);
});
test('excavation rejects support column, unknown neighbors, lava and falling gravel', () => {
    const b = { x: 2, y: 64, z: 0 }, feet = { x: 0, y: 64, z: 0 };
    assert.equal(canExcavate({blockAt: () => air}, b, feet), true);
    assert.equal(canExcavate({blockAt: () => air}, {x:0,y:63,z:0}, feet), false);
    for (const hazard of [undefined, {typeId:'minecraft:lava',liquid:true}, {typeId:'minecraft:gravel'}]) assert.equal(canExcavate({blockAt: () => hazard}, b, feet), false);
});
test('gold cannot mine iron; unsafe foods and neutral mobs excluded', () => {
    assert.equal(pickaxeTier('minecraft:golden_pickaxe'), 1);
    assert.equal(pickaxeTier('minecraft:stone_pickaxe'), 2);
    assert.equal(foodPoints({'minecraft:bread':8,'minecraft:rotten_flesh':64}), 40);
    const position = {x:0,y:0,z:0};
    assert.equal(pickThreats(['enderman','piglin','ender_dragon'].map(type => ({typeId:`minecraft:${type}`,position})), position, undefined, 12).length, 0);
});
test('configuration rejects unknown knobs and invalid scan budgets', () => {
    assert.throws(() => validateConfig({ gather: { probesPerTick: Infinity } }));
    assert.throws(() => validateConfig({ inventItems: true }));
    assert.equal(validateConfig({ gather: { searchRadius: 8 } }).gather.searchRadius, 8);
});
test('saving a running task does not spend a retry on reload', () => {
    const g=new TaskGraph();g.add(spec('a'));g.start('a',0);
    const p=g.exportProgress();assert.equal(p.a.status,'pending');assert.equal(p.a.attempts,0);
});
test('ad-hoc task history is bounded', () => {
    const g=new TaskGraph();for(let n=0;n<1000;n++)g.add(spec(`adhoc-${n}`));assert.equal(g.all().length,64);
});
test('spawn selection rejects lava, unknown blocks and occupied head space', async () => {
    const {safeSpawnNear}=await import('../scripts/core/safety.js');
    const p={x:0,y:64,z:0};
    assert.equal(safeSpawnNear({blockAt:()=>undefined},p),undefined);
    assert.equal(safeSpawnNear({blockAt:()=>({typeId:'minecraft:lava',solid:true})},p),undefined);
    assert.equal(safeSpawnNear({blockAt:q=>q.y===63?{typeId:'minecraft:stone',solid:true}:air},p).y,64);
});
