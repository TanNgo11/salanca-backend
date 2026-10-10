// Keep browser Admin code independent from the Node-only ordering server.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const root = join(project, 'src/plugins/ordering/admin/src');
const violations = [];
let files = 0;

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files += 1;
      const source = await readFile(path, 'utf8');
      if (/from\s+['"][^'"]*(?:server\/|@strapi\/utils)/.test(source) || /import\s*\([^)]*(?:server\/|@strapi\/utils)/.test(source)) {
        violations.push(path);
      }
    }
  }
}

await scan(root);
if (violations.length > 0) {
  console.error(`[ordering-admin-imports] forbidden server imports in ${violations.length} file(s)`);
  for (const path of violations) console.error(`  ${path}`);
  process.exit(1);
}
console.log(`[ordering-admin-imports] PASS ${files} admin source file(s) scanned`);
