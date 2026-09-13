/**
 * One-command content deploy: regenerate the CMS payload from salanca-web (when
 * its source is reachable) and write it into Strapi/Postgres.
 *
 * Assumes env (DATABASE_URL, etc.) is already configured wherever this runs —
 * it does not touch .env.
 *
 * Usage:
 *   pnpm run deploy:content              # normal upsert
 *   pnpm run deploy:content -- --prune   # also deletes rows the payload no longer defines
 *
 * Env:
 *   SALANCA_WEB_DIR   path to the salanca-web checkout (default: ../salanca-web,
 *                     sibling repo layout). When it is not found — e.g. this
 *                     runs alone in a backend-only container — step 1 is
 *                     skipped and the data/salanca-content.json already
 *                     committed in this repo is used as-is.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const backendRoot = resolve(import.meta.dirname, '..');
const webDir = resolve(backendRoot, process.env.SALANCA_WEB_DIR ?? '../salanca-web');
const payloadPath = resolve(backendRoot, 'data/salanca-content.json');
const extraArgs = process.argv.slice(2);

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}  (cwd: ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\ndeploy:content failed at: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

const webAvailable = existsSync(resolve(webDir, 'package.json'));

if (webAvailable) {
  console.log(`==> [1/2] salanca-web found at ${webDir} — regenerating data/salanca-content.json`);
  run('pnpm', ['run', 'export:cms-seed'], webDir);
} else {
  console.log(`==> [1/2] salanca-web not found at ${webDir} — using data/salanca-content.json already in this repo`);
}

if (!existsSync(payloadPath)) {
  console.error(
    `\nERROR: ${payloadPath} is missing and salanca-web is not available to generate it.\n` +
      '        Set SALANCA_WEB_DIR to the salanca-web checkout, or commit an up-to-date data/salanca-content.json.',
  );
  process.exit(1);
}

console.log('==> [2/2] seeding CMS content into Strapi');
run('pnpm', ['run', 'seed:content', ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])], backendRoot);

console.log('\n==> deploy:content done');
