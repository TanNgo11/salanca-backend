import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALERT_CODES, alertLabel } from './alert-codes';

const ADMIN = join(__dirname, '..', '..', '..', 'admin', 'src');

/** Admin never imports server code, so its alert-code list is a copy; this keeps the copy honest. */
describe('alert codes in Admin', () => {
  it('Settings lists every server alert code, so each one has an editable rule', () => {
    const source = readFileSync(join(ADMIN, 'pages', 'Settings', 'index.tsx'), 'utf8');
    const block = /const ALERT_CODES = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? '';
    const listed = [...block.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
    expect([...listed].sort()).toEqual([...ALERT_CODES].sort());
  });

  it('every code has a vi and en label on the server and an Admin translation', () => {
    const translations = [
      'o3.ts',
      'o6.ts',
      'o8.ts',
      'o9.ts',
      'o10.ts',
      'o13.ts',
    ]
      .map((file) => readFileSync(join(ADMIN, 'translations', file), 'utf8'))
      .join('\n');
    for (const code of ALERT_CODES) {
      expect(alertLabel(code, 'vi'), code).not.toBe(code);
      expect(alertLabel(code, 'en'), code).not.toBe(code);
      expect(translations, `Admin label for ${code}`).toContain(`'alert.code.${code}'`);
    }
  });
});
