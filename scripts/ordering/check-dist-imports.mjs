// Every relative require/import in the compiled ordering server must resolve to a real
// file. Catches layout drift between server/src and shared/ before Strapi loads the
// plugin (a broken path only fails at runtime). Run after pnpm run build:ordering.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dist = join(project, 'src/plugins/ordering/dist');
const entry = join(dist, 'server/src/index.js');
if (!existsSync(entry)) {
  console.error(`[ordering-dist-imports] missing ${entry}; run pnpm run build:ordering`);
  process.exit(1);
}

const pattern = /(?:require\(|from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const broken = [];
let files = 0;

const resolves = (from, specifier) => {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.js`, `${base}.json`, join(base, 'index.js')].some((candidate) =>
    existsSync(candidate),
  );
};

async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (item.name.endsWith('.js')) {
      files += 1;
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(pattern)) {
        if (!resolves(path, match[1])) broken.push(`${path} -> ${match[1]}`);
      }
    }
  }
}

await scan(dist);
if (broken.length > 0) {
  console.error(`[ordering-dist-imports] ${broken.length} unresolved import(s)`);
  for (const line of broken) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`[ordering-dist-imports] PASS ${files} compiled file(s) checked`);
