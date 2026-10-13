import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
let failures = 0;
for (const path of [...files('scripts'), ...files('tests'), ...files('tools')].filter(p => /\.(m?js)$/.test(p))) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); failures++; }
    for (const [, specifier] of readFileSync(path, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        try { readFileSync(resolve(dirname(path), specifier)); } catch { console.error(`Missing import ${specifier} in ${path}`); failures++; }
    }
}
const manifest = JSON.parse(readFileSync('manifest.json'));
if (manifest.modules[0].entry !== 'scripts/main.js' || manifest.dependencies.length !== 2) failures++;
console.log(`Syntax, local imports and manifest: ${failures ? `${failures} failure(s)` : 'OK'}`);
process.exitCode = failures ? 1 : 0;
