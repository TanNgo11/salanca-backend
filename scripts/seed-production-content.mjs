/** One backend command for the shipped owner-approved content and S3 images. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--preview')) throw new Error('Usage: node scripts/seed-production-content.mjs [--preview]');
const result = spawnSync(process.execPath, ['scripts/lib/content-release.mjs', 'seed', 'data/content-release', ...(args.includes('--preview') ? [] : ['--apply'])], { cwd: resolve(import.meta.dirname, '..'), env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
