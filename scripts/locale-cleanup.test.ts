import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Edit = { uid: string; locale: 'vi' | 'en'; match?: Record<string, string>; path: (string | number)[]; from: unknown; to: unknown };

const read = (file: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '..', file), 'utf8'));
const { edits } = read('scripts/locale-cleanup-2026-10-05.json') as { edits: Edit[] };
const { payload } = read('data/content-release/bundle.json');
const settings: Record<string, string> = {
  'api::global-setting.global-setting': 'globalSetting',
  'api::header-setting.header-setting': 'headerSetting',
  'api::footer-setting.footer-setting': 'footerSetting',
};

function bundleRow(edit: Edit) {
  if (settings[edit.uid]) return payload[settings[edit.uid]][edit.locale];
  if (payload.pages[edit.uid]) return payload.pages[edit.uid][edit.locale];
  const collection = payload.collections[edit.uid];
  if (!collection.entries) return collection[edit.locale];
  const [field, value] = Object.entries(edit.match ?? {})[0];
  return collection.entries.find((entry: Record<string, Record<string, unknown>>) => entry[edit.locale][field] === value)[edit.locale];
}

describe('locale cleanup seed', () => {
  it('writes exactly the values the shipped bundle holds', () => {
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      const value = edit.path.reduce<any>((node, key) => node?.[key], bundleRow(edit));
      expect(value ?? null, `${edit.uid}/${edit.locale} ${edit.path.join('.')}`).toBe(edit.to ?? null);
    }
  });
});
