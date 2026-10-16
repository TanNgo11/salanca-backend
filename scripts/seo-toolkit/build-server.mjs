// Compile the seo-toolkit server together with the browser-safe shared modules.
// tsc keeps the source layout (rootDir = the plugin directory), so the output is
// dist/server/src/** next to dist/shared/** and every relative import stays valid
// without post-processing. The plugin entry is dist/server/src/index.js.
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const output = join(project, 'src/plugins/seo-toolkit/dist');

await rm(output, { recursive: true, force: true });

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const code = await new Promise((done) => {
  const child = spawn(command, ['exec', 'tsc', '-p', 'src/plugins/seo-toolkit/server/tsconfig.json'], {
    cwd: project,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  child.on('error', () => done(1));
  child.on('exit', (exitCode) => done(exitCode ?? 1));
});
process.exit(code);
