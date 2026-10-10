// Runs every ordering integration script in order as a child process and reports
// pass/fail + duration. Exit 1 when any script fails. Run: node scripts/ordering/run-all.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const scripts = [
  'schema.mjs',
  'disable-survives.mjs',
  'registry-boot.mjs',
  'idempotency.mjs',
  'create-order.mjs',
  'transition.mjs',
  'payment-refund.mjs',
  'outbox-two-process.mjs',
  'jobs.mjs',
  'scope.mjs',
  'review-additions.mjs',
];

const results = [];
let failures = 0;
for (const script of scripts) {
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], {
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
    child.on('error', () => resolve(1));
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = code === 0;
  if (!ok) failures += 1;
  results.push({ script, ok, seconds });
  console.log(`[check:ordering] ${ok ? 'PASS' : 'FAIL'} ${script} (${seconds}s)`);
}

console.log('\n[check:ordering] summary');
for (const result of results) {
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.script.padEnd(28)} ${result.seconds}s`);
}
if (failures > 0) {
  console.error(`[check:ordering] ${failures} script(s) failed`);
  process.exit(1);
}
console.log(`[check:ordering] all ${scripts.length} scripts passed`);
