import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Admin renders its own translated line for a validation issue from `code` (see
 * `admin/src/lib/validation.ts`); an issue without one falls back to a generic "not valid" line.
 * Every `{ path, message }` literal the server hand-writes must therefore carry a `code`.
 */
const ROOT = path.resolve(__dirname);

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });

describe('hand-written validation issues', () => {
  it('always carry a code', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      // `${...}` interpolations hold braces of their own; blank them so literals can be matched flat.
      const text = readFileSync(file, 'utf8').replace(/\$\{[^}]*\}/g, '${}');
      for (const match of text.matchAll(/\{[^{}]*\}/g)) {
        const literal = match[0];
        if (!/\bpath\b/.test(literal) || !/\bmessage\b/.test(literal)) continue;
        if (/\bcode\b/.test(literal) || /\.\.\.\w*[iI]ssue/.test(literal)) continue;
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(ROOT, file)}:${line} ${literal.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
