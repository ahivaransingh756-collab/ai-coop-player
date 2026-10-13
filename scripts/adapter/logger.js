export const consoleLogger = {
    info: (e, d) => console.log(JSON.stringify({ lvl: 'info', e, ...d })),
    warn: (e, d) => console.warn(JSON.stringify({ lvl: 'warn', e, ...d })),
    error: (e, d) => console.error(JSON.stringify({ lvl: 'error', e, ...d })),
};
