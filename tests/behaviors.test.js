import test from 'node:test';
import assert from 'node:assert/strict';
import { GatherBlocks } from '../scripts/behaviors/gatherBlocks.js';
import { Observe } from '../scripts/behaviors/observe.js';
import { Eat } from '../scripts/behaviors/eat.js';
import { Travel, PortalTravel } from '../scripts/behaviors/travel.js';
import { Brain } from '../scripts/speedrun/brain.js';
import { buildSpeedrunGraph } from '../scripts/speedrun/graph.js';
import { Telemetry } from '../scripts/core/telemetry.js';
import { observed } from '../scripts/core/types.js';
import { fixture, air, stone } from './helpers.js';
const brainFor = ctx => new Brain({ctx, graph:buildSpeedrunGraph(), telemetry:new Telemetry(), behaviors:[new GatherBlocks(),new Observe(),new PortalTravel()]});
test('gather validates input, tool tier and changed dimensions', () => {
    const {ctx, snap} = fixture(), b = new GatherBlocks();
    assert.throws(() => b.start(ctx,{resource:'wood',count:NaN}));
    b.start(ctx,{resource:'iron',count:1}); assert.match(b.tick(ctx).reason, /pickaxe/);
    snap.inventory['minecraft:stone_pickaxe'] = 1; snap.dimension = 'minecraft:nether'; assert.match(b.tick(ctx).reason, /dimension/);
});
test('gather total targets survive interruption without demanding six more logs', () => {
    const {ctx,snap} = fixture({inventory:{'minecraft:oak_log':4}}), b = new GatherBlocks();
    b.start(ctx,{resource:'wood',count:6,total:true}); b.cancel(ctx);
    snap.inventory['minecraft:oak_log'] = 6; b.start(ctx,{resource:'wood',count:6,total:true});
    assert.equal(b.tick(ctx).status,'succeeded');
});
test('gather breaks once continuously and only inventory evidence proves collection', () => {
    const {ctx,snap,calls} = fixture(), b = new GatherBlocks();
    const block = {x:2,y:64,z:0}; let broken = false;
    ctx.world.blockAt = p => p.x===2 && p.y===64 && p.z===0 && !broken ? {typeId:'minecraft:oak_log',solid:true} : air;
    b.start(ctx,{resource:'wood',count:1});
    for (snap.tick=0;snap.tick<40;snap.tick++) b.tick(ctx);
    assert.equal(calls.filter(c=>c==='breakBlock').length,1);
    broken=true; assert.equal(b.tick(ctx).status,'running');
    snap.inventory['minecraft:oak_log']=1; assert.equal(b.tick(ctx).status,'succeeded');
});
test('search respects per-tick probe budget and finishes when no resource exists', () => {
    const {ctx,snap} = fixture(), b = new GatherBlocks(); let probes=0;
    ctx.cfg.gather.searchRadius=4; ctx.cfg.gather.probesPerTick=10;
    ctx.world.blockAt=()=>{probes++; return air;}; b.start(ctx,{resource:'wood',count:1});
    assert.equal(b.tick(ctx).status,'running'); assert.equal(probes,10);
    let result;
    for (snap.tick=1;snap.tick<100;snap.tick++) { result=b.tick(ctx); if(result.status!=='running')break; }
    assert.equal(result.status,'failed'); assert.match(result.reason,/no reachable/);
});
test('eat uses inventory action and requires consumption evidence, not just accepted input', () => {
    const {ctx,snap,calls}=fixture({inventory:{'minecraft:bread':3},hunger:observed(12,0)}), eat=new Eat();
    eat.start(ctx); snap.tick=30; assert.equal(eat.tick(ctx).status,'running');
    snap.inventory['minecraft:bread']=2; assert.equal(eat.tick(ctx).status,'succeeded'); assert.ok(calls.includes('stopUsingItem'));
});
test('travel refuses unknown ground, cross-dimension paths and unobserved portals', () => {
    const {ctx,snap}=fixture(), b=new Travel();
    b.start(ctx,{target:{pos:{x:10,y:64,z:0},dimension:snap.dimension}});
    assert.equal(b.tick(ctx).status,'failed');
    ctx.world.blockAt=()=>stone;
    b.start(ctx,{target:{pos:{x:10,y:64,z:0},dimension:'minecraft:nether'}}); assert.match(b.tick(ctx).reason,/dimension/);
    assert.throws(()=>new PortalTravel().start(ctx,{waypoint:'overworld_portal',destination:'minecraft:nether'}));
});
test('portal success requires actual dimension transition', () => {
    const {ctx,snap}=fixture(), b=new Travel(); b.start(ctx,{target:{pos:snap.position,dimension:snap.dimension},destination:'minecraft:nether'});
    assert.equal(b.tick(ctx).status,'running'); snap.dimension='minecraft:nether'; assert.equal(b.tick(ctx).status,'succeeded');
});
test('brain rejects false executor success', () => {
    const {ctx}=fixture(), brain=brainFor(ctx);
    brain.byKind.set('gather_blocks',{start(){},cancel(){},tick(){return {status:'succeeded'};}});
    brain.resume(); brain.tick(); brain.tick();
    assert.equal(brain.d.graph.get('wood').status,'pending'); assert.match(brain.d.graph.get('wood').lastFailure,/without objective evidence/);
});
test('low health stops work instead of continuing to mine', () => {
    const {ctx,snap,messages}=fixture({health:observed(4,0)}), brain=brainFor(ctx);
    brain.resume(); brain.tick(); assert.equal(brain.base.type,'idle'); assert.ok(messages.some(m=>m.includes('Safety stop')));
});
test('food preempts gathering then resumes same route task', () => {
    const {ctx,snap}=fixture(), brain=brainFor(ctx); brain.resume(); brain.tick();
    snap.hunger=observed(10,1); snap.inventory['minecraft:bread']=2; snap.tick=1; brain.tick(); assert.equal(brain.active.label,'eat');
    snap.inventory['minecraft:bread']=1; snap.hunger=observed(15,40); snap.tick=40; brain.tick();
    snap.tick++; brain.tick(); assert.equal(brain.active.taskId,'wood'); assert.equal(brain.d.graph.get('wood').attempts,1);
});
test('failed terminal step is never presented as route complete', () => {
    const {ctx,messages}=fixture(), brain=brainFor(ctx);
    for (const t of brain.d.graph.all()) t.status='succeeded'; brain.d.graph.get('dragon').status='failed';
    brain.explainAutopilotStop(ctx.body.snapshot()); assert.ok(messages.at(-1).includes('paused')); assert.ok(!messages.at(-1).includes('complete'));
});
test('all 18 stages complete in a mocked co-op run only after supplies, portals and dragon event', () => {
    const {ctx,snap,messages}=fixture({inventory:{'minecraft:oak_log':6,'minecraft:wooden_pickaxe':1,'minecraft:stone_pickaxe':1,'minecraft:iron_pickaxe':1,'minecraft:cobblestone':64,'minecraft:bread':16,'minecraft:raw_iron':10,'minecraft:iron_ingot':10,'minecraft:water_bucket':1,'minecraft:flint_and_steel':1,'minecraft:blaze_rod':7,'minecraft:ender_pearl':14,'minecraft:ender_eye':14}});
    const brain=brainFor(ctx);
    for(const [name,dim] of [['overworld_portal','minecraft:overworld'],['nether_portal','minecraft:nether'],['end_portal','minecraft:overworld']])ctx.run.mark(name,snap.position,dim);
    ctx.world.blockAt=()=>({typeId:brain.d.graph.get('return').status==='succeeded'?'minecraft:end_portal':'minecraft:portal'});
    brain.resume();
    for(snap.tick=0;snap.tick<100;snap.tick++) {
        if(brain.active?.taskId==='nether')snap.dimension='minecraft:nether';
        if(brain.active?.taskId==='return')snap.dimension='minecraft:overworld';
        if(brain.active?.taskId==='end')snap.dimension='minecraft:the_end';
        brain.tick();
        if(brain.active?.taskId==='dragon')break;
    }
    assert.equal(brain.d.graph.all().filter(t=>t.status==='succeeded').length,17);
    for(let i=0;i<10;i++){snap.tick++;brain.tick();}
    assert.equal(brain.d.graph.get('dragon').status,'running');
    ctx.run.recordDragonDeath({typeId:'minecraft:ender_dragon',position:snap.position,dimension:snap.dimension},snap,true);
    snap.tick++;brain.tick();snap.tick++;brain.tick();
    assert.equal(brain.d.graph.all().filter(t=>t.status==='succeeded').length,18);
    assert.ok(messages.at(-1).includes('dragon death verified'));
});
test('portal travel does not stop one block before entering the portal', () => {
    const {ctx,snap}=fixture(), b=new Travel();let nav=0;
    ctx.world.blockAt=()=>stone;ctx.body.navigateTo=()=>{nav++;return 'full';};
    b.start(ctx,{target:{pos:{...snap.position,x:1},dimension:snap.dimension},destination:'minecraft:nether'});
    assert.equal(b.tick(ctx).status,'running');assert.equal(nav,1);
});
test('full inventory with a compatible partial stack can still gather', () => {
    const {ctx}=fixture({emptySlots:0,inventory:{'minecraft:oak_log':3}}), b=new GatherBlocks();
    ctx.body.canCollect=()=>true;b.start(ctx,{resource:'wood',count:1});
    assert.equal(b.tick(ctx).status,'running');
});
test('waypoint travel resumes after a food interruption', () => {
    const {ctx,snap}=fixture(), brain=brainFor(ctx);
    ctx.world.blockAt=()=>stone;ctx.run.mark('rally',{x:20,y:64,z:0},snap.dimension);
    brain.travel('rally');brain.tick();const task=brain.active.taskId;
    snap.tick++;snap.hunger=observed(10,1);snap.inventory['minecraft:bread']=2;brain.tick();assert.equal(brain.active.label,'eat');
    snap.tick+=40;snap.hunger=observed(20,41);brain.tick();snap.tick++;brain.tick();assert.equal(brain.active.taskId,task);
});
test('waiting on a handoff does not starve an independent resource retry', () => {
    const {ctx,snap}=fixture({inventory:{'minecraft:stone_pickaxe':1}}), brain=brainFor(ctx);
    for(const id of ['wood','wood_tools','stone','stone_tools'])brain.d.graph.get(id).status='succeeded';
    brain.d.graph.get('iron').availableAtTick=20;
    brain.resume();brain.tick();assert.equal(brain.active.taskId,'food');
    snap.tick=20;brain.tick();assert.equal(brain.active.taskId,'iron');
});
test('prototype names are not resources or waypoints', () => {
    const {ctx}=fixture(), brain=brainFor(ctx);
    assert.match(brain.gather('__proto__',1),/only gather/);
    assert.match(brain.travel('__proto__'),/No waypoint/);
});
