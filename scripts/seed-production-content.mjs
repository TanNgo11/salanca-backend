/** Backend-only owner release: no sibling checkout, SFTP or external tools. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some(arg => !['--preview', '--restore-experience-space', '--restore-marketing-pages'].includes(arg))) throw new Error('Usage: node scripts/seed-production-content.mjs [--preview] [--restore-experience-space | --restore-marketing-pages]');
const result = spawnSync(process.execPath, ['scripts/content-bundle.mjs', 'seed', 'data/content-release', ...(args.includes('--preview') ? [] : ['--apply']), ...args.filter(arg => arg.startsWith('--restore-'))], {
  cwd: resolve(import.meta.dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
