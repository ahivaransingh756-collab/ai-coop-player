import { GameMode, Player, system, world } from '@minecraft/server';
import { spawnSimulatedPlayer } from '@minecraft/server-gametest';
import { DEFAULT_CONFIG } from './config/index.js';
import { consoleLogger } from './adapter/logger.js';
import { ScriptBody } from './adapter/scriptBody.js';
import { ScriptWorld } from './adapter/scriptWorld.js';
import { ConfirmationGate, helpText, isBotMessage, parseCommand } from './core/commands.js';
import { WorldMemory } from './core/memory.js';
import { Telemetry } from './core/telemetry.js';
import { Brain } from './speedrun/brain.js';
import { buildSpeedrunGraph } from './speedrun/graph.js';
import { Observe } from './behaviors/observe.js';
import { PortalTravel } from './behaviors/travel.js';
import { RunState, MARKERS } from './speedrun/runState.js';
import { triangulate } from './core/triangulation.js';
import { safeSpawnNear } from './core/safety.js';
import { dist } from './core/vec.js';
import { GatherBlocks } from './behaviors/gatherBlocks.js';
const cfg = DEFAULT_CONFIG; // override with validateConfig({...}) here if desired
const MEMORY_KEY = 'speedrunbot:memory';
const RUN_KEY = 'speedrunbot:run:v2';
const BOT_TAG = 'speedrunbot:managed';
const gate = new ConfirmationGate();
let body;
let brain;
let owner;
let memory = new WorldMemory();
let consecutiveErrors = 0;
let initialized = false;
let chatEvents = 0;
const errText = (e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const tell = (p, msg) => p.sendMessage(`§b[${cfg.botName}]§r ${msg}`);
function saveMemory() {
    try {
        if (brain && owner) world.setDynamicProperty(RUN_KEY, brain.ctx.run.serialize(owner, brain.d.graph));
        const s = memory.serialize();
        if (s.length < 30000)
            world.setDynamicProperty(MEMORY_KEY, s);
    }
    catch (e) {
        consoleLogger.warn('memory.save_failed', { error: errText(e) });
    }
}
function spawn(p) {
    if (body) {
        tell(p, 'I am already in the world.');
        return;
    }
    try {
        if (world.getAllPlayers().some(player => player.hasTag(BOT_TAG))) {
            tell(p, 'A managed bot is still present after a reload. Reopen the world before spawning; always despawn before /reload.');
            return;
        }
        const l = safeSpawnNear(new ScriptWorld(() => p.dimension), p.location);
        if (!l) return tell(p, 'No safe spawn space nearby. Stand on a flat, solid surface with two clear air blocks.');
        const sim = spawnSimulatedPlayer({ dimension: p.dimension, ...l }, cfg.botName, GameMode.Survival);
        sim.addTag(BOT_TAG);
        owner = p.name;
        body = new ScriptBody(sim, () => owner, cfg);
        const ctx = { body, world: new ScriptWorld(() => (body?.player.isValid ? body.player.dimension : undefined)), memory, cfg, log: consoleLogger };
        const graph = buildSpeedrunGraph(cfg.riskProfile);
        ctx.run = RunState.restore(world.getDynamicProperty(RUN_KEY), owner, graph);
        brain = new Brain({ ctx, graph, telemetry: new Telemetry(), behaviors: [new GatherBlocks(), new Observe(), new PortalTravel()] });
        tell(p, 'Spawned safely paused (saved progress restored when available). !bot capabilities explains autonomy; !bot resume then !bot confirm starts the co-op route.');
    }
    catch (e) {
        try { body?.player.disconnect(); } catch { /* best effort cleanup */ }
        body = undefined;
        brain = undefined;
        owner = undefined;
        consoleLogger.error('spawn.failed', { error: errText(e) });
        tell(p, `§cSpawn failed: ${errText(e)}`);
        tell(p, 'Check: Beta APIs experiment is ON, pack is added to this world, and the content log for details.');
    }
}
function despawn(p) {
    if (!body) {
        tell(p, 'I am not in the world.');
        return;
    }
    brain?.stop();
    saveMemory();
    try {
        body.player.disconnect();
    }
    catch { /* already gone */ }
    body = undefined;
    brain = undefined;
    owner = undefined;
    tell(p, 'Despawned; route checkpoint saved, but inventory is NOT serialized. Retrieve supplies before despawning next time.');
}
function execute(p, c) {
    if (!c.implemented) {
        tell(p, `"${c.name}" is not implemented yet.`);
        return;
    }
    switch (c.name) {
        case 'spawn': return spawn(p);
        case 'despawn': return despawn(p);
        case 'help':
            for (const l of helpText())
                tell(p, l);
            return;
        case 'ping':
            tell(p, `pong. pack loaded, chat events seen: ${chatEvents}, bot in world: ${body ? 'yes' : 'no'}. Next: !bot spawn`);
            return;
        case 'cancel':
            tell(p, gate.cancel() ? 'Cancelled the pending action.' : 'Nothing pending.');
            return;
        default: break;
    }
    if (!brain) {
        tell(p, 'Spawn me first: !bot spawn');
        return;
    }
    switch (c.name) {
        case 'auto': return tell(p, brain.autonomous());
        case 'why': return brain.autonomy.why().forEach(l => tell(p, l));
        case 'surroundings': return brain.autonomy.surroundings(body.snapshot()).forEach(l => tell(p, l));
        case 'capabilities':
            tell(p, '!bot auto: autonomous local exploration, crafting, furnace operation, hunting and iron-kit preparation. MODDED crafting; not full Nether/dragon autonomy.');
            tell(p, 'Automatic: follow, basic defense, safe-food use, nearby wood/stone/ore gathering, marked portal traversal.');
            tell(p, 'Co-op route still uses handoffs. Auto mode consumes real ingredients through a scripted crafting bridge; other actions use actual survival inputs/furnaces. No /locate or fake victory.');
            tell(p, 'Beta API target: Bedrock 1.21.114. Not a leaderboard-legal autonomous runner; real-world testing is required.');
            return;
        case 'route': return brain.route().forEach(l => tell(p, l));
        case 'reset run':
            brain.stop();
            brain.ctx.run = new RunState();
            brain.d.graph = buildSpeedrunGraph(cfg.riskProfile);
            brain.d.telemetry = new Telemetry();
            saveMemory();
            return tell(p, 'Run checkpoints and waypoints reset. Inventory/world unchanged. Paused.');
        case 'mark': {
            const name = c.args[0];
            if (!Object.hasOwn(MARKERS, name)) return tell(p, `Choose: ${Object.keys(MARKERS).join(', ')}.`);
            let pos = p.location;
            if (MARKERS[name]) {
                const block = p.getBlockFromViewDirection({ maxDistance: 6, includePassableBlocks: true })?.block;
                if (block?.typeId !== MARKERS[name]) return tell(p, `Look directly at an active ${MARKERS[name]} block within 6 blocks.`);
                pos = { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
            }
            brain.ctx.run.mark(name, pos, p.dimension.id);
            saveMemory();
            return tell(p, `Marked ${name} in ${p.dimension.id}. This records a waypoint, not a completed task.`);
        }
        case 'go': return tell(p, brain.travel(c.args[0]));
        case 'drop': {
            const s = body.snapshot();
            if (p.dimension.id !== s.dimension || dist(p.location, s.position) > 6) return tell(p, 'Come within 6 blocks in my dimension first.');
            brain.stop();
            body.lookAt(p.location);
            const id = c.args[0].startsWith('minecraft:') ? c.args[0] : `minecraft:${c.args[0]}`;
            return tell(p, body.dropItem(id) ? `Dropped selected ${id}; pick it up. Repeat if more is needed, then resume when ready.` : `Could not drop ${id}; check my inventory.`);
        }
        case 'eye': {
            if (p.dimension.id !== 'minecraft:overworld') return tell(p, 'Record eye flights only in the Overworld.');
            const pos = p.location, dx = Number(c.args[0])-pos.x, dz = Number(c.args[1])-pos.z;
            if (Math.hypot(dx, dz) < 8) return tell(p, 'Record a flight endpoint at least 8 blocks from your unchanged throw position.');
            const rays = brain.ctx.run.bearings;
            if (rays.some(r => Math.hypot(r.x-pos.x, r.z-pos.z) < 16)) return tell(p, 'Move at least 16 blocks from previous throw positions (sideways is best).');
            rays.push({ x: pos.x, z: pos.z, dx, dz });
            if (rays.length > 8) rays.shift();
            return tell(p, `Recorded human-reported eye flight #${rays.length}. Use !bot stronghold for the geometric estimate.`);
        }
        case 'clear eyes': brain.ctx.run.bearings = []; return tell(p, 'Cleared eye-flight observations.');
        case 'stronghold': {
            const result = triangulate(brain.ctx.run.bearings);
            return tell(p, result.ok ? `Estimated eye-ray intersection: X ${Math.round(result.x)}, Z ${Math.round(result.z)}; residual ${result.residual.toFixed(1)} blocks. Not a verified structure/portal location. Re-throw near the estimate.` : result.reason);
        }
        case 'follow': return tell(p, brain.followHuman());
        case 'stop': return tell(p, brain.stop());
        case 'resume': return tell(p, brain.resume());
        case 'defend me': return tell(p, brain.defendMe());
        case 'gather': return tell(p, brain.gather(c.args[0] ?? '', Number(c.args[1] ?? 4)));
        case 'status':
            for (const l of brain.status())
                tell(p, l);
            return;
        default: tell(p, `"${c.name}" is not implemented yet.`);
    }
}
function handle(p, message) {
    try {
        const parsed = parseCommand(message);
        if (!parsed.ok) {
            tell(p, parsed.error);
            return;
        }
        const c = parsed.command;
        if (owner !== undefined && p.name !== owner && c.name !== 'help' && c.name !== 'ping') {
            tell(p, `Only ${owner} can command me.`);
            return;
        }
        if (['stop', 'despawn', 'reset run'].includes(c.name)) gate.cancel();
        if (c.name === 'confirm') {
            const pending = gate.confirm(p.name, system.currentTick);
            if (pending)
                execute(p, pending);
            else
                tell(p, 'Nothing to confirm (or it expired).');
            return;
        }
        if (c.dangerous && c.implemented) {
            gate.request(p.name, c, system.currentTick);
            if (c.name === 'auto') tell(p, 'Auto enables MODDED crafting/container automation, mines terrain, places stations and hunts adult food animals. It targets an Overworld iron kit, NOT a full dragon run. Confirm only in a backed-up test world.');
            tell(p, `"${c.name}" is risky. Say !bot confirm within 30s to proceed, or !bot cancel.`);
            return;
        }
        execute(p, c);
    }
    catch (e) {
        consoleLogger.error('command.failed', { message, error: errText(e) });
        tell(p, `§cCommand error: ${errText(e)}`);
    }
}
/** Everything that touches world state lives here, so it never runs during early execution. */
function init() {
    if (initialized)
        return;
    initialized = true;
    const raw = world.getDynamicProperty(MEMORY_KEY);
    memory = WorldMemory.deserialize(typeof raw === 'string' ? raw : undefined);
    system.runInterval(() => {
        if (!brain)
            return;
        try {
            brain.tick();
            consecutiveErrors = 0;
        }
        catch (e) {
            consoleLogger.error('main.tick_error', { error: errText(e) });
            if (++consecutiveErrors >= 20) {
                brain.stop();
                consecutiveErrors = 0;
                world.sendMessage(`§c[${cfg.botName}] Too many internal errors; stopped. Check the content log.`);
            }
        }
    }, 1);
    system.runInterval(saveMemory, 200);
    consoleLogger.info('speedrunbot.initialized');
}
// Event subscriptions are allowed during early execution, so register them immediately.
world.afterEvents.chatSend.subscribe((ev) => {
    chatEvents++;
    if (isBotMessage(ev.message))
        handle(ev.sender, ev.message);
});
world.afterEvents.playerLeave.subscribe((ev) => { if (ev.playerName === owner) {
    brain?.stop(); saveMemory(); gate.cancel();
} });
world.afterEvents.entityDie.subscribe(ev => {
    if (!brain || !body) return;
    try {
        const dead = ev.deadEntity;
        if (dead.typeId !== 'minecraft:ender_dragon') return;
        const running = brain.base.type === 'autopilot' && brain.d.graph.get('end')?.status === 'succeeded';
        if (brain.ctx.run.recordDragonDeath({ typeId: dead.typeId, position: dead.location, dimension: dead.dimension.id }, body.snapshot(), running)) {
            consoleLogger.info('run.dragon_death_observed');
            saveMemory();
        }
    } catch (e) { consoleLogger.warn('run.death_event_unreadable', { error: errText(e) }); }
});
// Fallback that does not depend on chat events: /scriptevent speedrunbot:cmd <command>   e.g. "spawn", "follow", "gather wood 6"
system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== 'speedrunbot:cmd')
        return;
    if (ev.sourceEntity instanceof Player)
        handle(ev.sourceEntity, `!bot ${ev.message}`);
    else
        consoleLogger.warn('scriptevent.no_player', { hint: 'run /scriptevent as a player, not from console or a command block' });
});
world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn)
        tell(ev.player, 'Speedrun bot pack loaded. Say !bot ping to test, then !bot spawn.');
});
world.afterEvents.worldLoad.subscribe(() => { try {
    init();
}
catch (e) {
    initialized = false;
    consoleLogger.error('init.failed', { error: errText(e) });
} });
// After /reload the world is already loaded and worldLoad will not fire again, so try now; during early execution this throws and we wait.
try {
    world.getDynamicProperty(MEMORY_KEY);
    init();
}
catch { /* early execution: init() runs on worldLoad */ }
