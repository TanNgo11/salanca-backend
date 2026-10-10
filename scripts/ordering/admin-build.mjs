// Regression gate: the Admin must build with the ordering plugin enabled.
import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const code = await new Promise((done) => {
  const child = spawn(command, ['exec', 'strapi', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, ORDERING_ENABLED: 'true' },
    shell: process.platform === 'win32',
  });
  child.on('error', () => done(1));
  child.on('exit', (exitCode) => done(exitCode ?? 1));
});
if (code !== 0) {
  console.error(`[ordering-admin-build] FAIL (exit ${code})`);
  process.exit(code);
}
console.log('[ordering-admin-build] PASS ORDERING_ENABLED=true strapi build');
