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
import { GatherBlocks } from './behaviors/gatherBlocks.js';
const cfg = DEFAULT_CONFIG; // override with validateConfig({...}) here if desired
const MEMORY_KEY = 'speedrunbot:memory';
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
        const l = p.location;
        const sim = spawnSimulatedPlayer({ dimension: p.dimension, x: l.x + 2, y: l.y, z: l.z }, cfg.botName, GameMode.Survival);
        owner = p.name;
        body = new ScriptBody(sim, () => owner, cfg);
        const ctx = { body, world: new ScriptWorld(() => (body?.player.isValid ? body.player.dimension : undefined)), memory, cfg, log: consoleLogger };
        brain = new Brain({ ctx, graph: buildSpeedrunGraph(cfg.riskProfile), telemetry: new Telemetry(), behaviors: [new GatherBlocks()] });
        tell(p, 'Spawned. Try !bot follow, !bot gather wood 6, !bot status, !bot help.');
    }
    catch (e) {
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
    tell(p, 'Despawned.');
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
    system.runInterval(saveMemory, 1200);
    consoleLogger.info('speedrunbot.initialized');
}
// Event subscriptions are allowed during early execution, so register them immediately.
world.afterEvents.chatSend.subscribe((ev) => {
    chatEvents++;
    if (isBotMessage(ev.message))
        handle(ev.sender, ev.message);
});
world.afterEvents.playerLeave.subscribe((ev) => { if (ev.playerName === owner)
    brain?.stop(); });
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
