// Compile the ordering server and browser-safe shared modules, then flatten the
// staging tree back to the plugin's established dist/server layout. The source
// tree has shared/ beside server/, so TypeScript needs the ordering directory as
// rootDir; flattening keeps the public plugin entry and existing script imports
// backwards-compatible.
import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const plugin = join(project, 'src/plugins/ordering');
const staging = join(plugin, 'dist/server-tmp');
const output = join(plugin, 'dist/server');

await rm(output, { recursive: true, force: true });
await rm(staging, { recursive: true, force: true });

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const code = await new Promise((done) => {
  const child = spawn(command, ['exec', 'tsc', '-p', 'src/plugins/ordering/server/tsconfig.json'], {
    cwd: project,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  child.on('error', () => done(1));
  child.on('exit', (exitCode) => done(exitCode ?? 1));
});
if (code !== 0) process.exit(code);

const serverSource = join(staging, 'server', 'src');
if (!existsSync(serverSource)) throw new Error(`Ordering server compiler output is missing: ${serverSource}`);
await mkdir(output, { recursive: true });
await cp(serverSource, output, { recursive: true });
const sharedSource = join(staging, 'shared');
if (existsSync(sharedSource)) await cp(sharedSource, join(output, 'shared'), { recursive: true });

// The source wrappers live four levels below ordering/, while flattened output
// lives two levels below dist/server/. Rewrite only those generated imports.
const { readdir, readFile, writeFile } = await import('node:fs/promises');
async function rewriteImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await rewriteImports(path);
    else if (entry.name.endsWith('.js')) {
      const source = await readFile(path, 'utf8');
      const rewritten = source.replaceAll("../../../../shared/catalog/", "../../shared/catalog/");
      if (rewritten !== source) await writeFile(path, rewritten);
    }
  }
}
await rewriteImports(output);
await rm(staging, { recursive: true, force: true });
