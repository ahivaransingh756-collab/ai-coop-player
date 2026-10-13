export const COMMANDS = [
    { name: 'help', usage: '!bot help', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'ping', usage: '!bot ping', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'spawn', usage: '!bot spawn', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'despawn', usage: '!bot despawn', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'follow', usage: '!bot follow', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'stop', usage: '!bot stop', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'status', usage: '!bot status', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'resume', usage: '!bot resume', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'confirm', usage: '!bot confirm', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'cancel', usage: '!bot cancel', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'defend me', usage: '!bot defend me', dangerous: false, implemented: true, minArgs: 0, maxArgs: 0 },
    { name: 'gather', usage: '!bot gather <wood> [count]', dangerous: false, implemented: true, minArgs: 1, maxArgs: 2 },
    { name: 'get food', usage: '!bot get food', dangerous: false, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'share resources', usage: '!bot share resources', dangerous: false, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'make portal', usage: '!bot make portal', dangerous: true, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'find fortress', usage: '!bot find fortress', dangerous: true, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'get pearls', usage: '!bot get pearls', dangerous: true, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'find stronghold', usage: '!bot find stronghold', dangerous: false, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'prepare for end', usage: '!bot prepare for end', dangerous: false, implemented: false, minArgs: 0, maxArgs: 0 },
    { name: 'attack dragon', usage: '!bot attack dragon', dangerous: true, implemented: false, minArgs: 0, maxArgs: 0 },
];
export const PREFIX = '!bot';
export function isBotMessage(msg) {
    const t = msg.trim().toLowerCase();
    return t === PREFIX || t.startsWith(PREFIX + ' ');
}
export function parseCommand(message) {
    if (!isBotMessage(message))
        return { ok: false, error: 'not a bot command' };
    const words = message.trim().toLowerCase().split(/\s+/).slice(1);
    if (words.length === 0)
        return { ok: false, error: 'usage: !bot <command> — try !bot help' };
    // Longest-name-first so "get food" wins over a hypothetical "get".
    const spec = [...COMMANDS]
        .sort((a, b) => b.name.split(' ').length - a.name.split(' ').length)
        .find((c) => words.slice(0, c.name.split(' ').length).join(' ') === c.name);
    if (!spec)
        return { ok: false, error: `unknown command "${words.join(' ')}" — try !bot help` };
    const args = words.slice(spec.name.split(' ').length);
    if (args.length < spec.minArgs || args.length > spec.maxArgs)
        return { ok: false, error: `usage: ${spec.usage}` };
    if (spec.name === 'gather') {
        const count = args[1];
        if (count !== undefined && !(/^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= 64))
            return { ok: false, error: 'count must be an integer from 1 to 64' };
    }
    return { ok: true, command: { name: spec.name, args, dangerous: spec.dangerous, implemented: spec.implemented } };
}
/** Dangerous commands wait for "!bot confirm" from the same player within `ttlTicks`. */
export class ConfirmationGate {
    ttlTicks;
    pending;
    constructor(ttlTicks = 600) {
        this.ttlTicks = ttlTicks;
    }
    request(player, command, tick) {
        this.pending = { player, command, expires: tick + this.ttlTicks };
    }
    confirm(player, tick) {
        const p = this.pending;
        if (!p || p.player !== player || tick > p.expires) {
            this.pending = undefined;
            return undefined;
        }
        this.pending = undefined;
        return p.command;
    }
    cancel() { const had = this.pending !== undefined; this.pending = undefined; return had; }
    hasPending() { return this.pending !== undefined; }
}
export const helpText = () => COMMANDS.filter((c) => !['confirm', 'cancel'].includes(c.name)).map((c) => `${c.usage}${c.implemented ? '' : '  (not implemented yet)'}`);
