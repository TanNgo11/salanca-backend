import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Edit = { uid: string; locale: 'vi' | 'en'; match?: Record<string, string>; path: (string | number)[]; from: unknown; to: unknown };

const read = (file: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '..', file), 'utf8'));
const edits = readdirSync(resolve(import.meta.dirname, 'content-fixes'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap((name) => (read(`scripts/content-fixes/${name}`) as { edits: Edit[] }).edits);
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

describe('content fixes seed', () => {
  it('writes exactly the values the shipped bundle holds', () => {
    expect(edits.length).toBeGreaterThan(0);
    // Files apply in name order, so a later fix may chain from an earlier one's
    // value; only the last edit per field has to match the bundle.
    const last = new Map(edits.map((edit) => [JSON.stringify([edit.uid, edit.locale, edit.match ?? null, edit.path]), edit]));
    for (const edit of last.values()) {
      const value = edit.path.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], bundleRow(edit));
      expect(value ?? null, `${edit.uid}/${edit.locale} ${edit.path.join('.')}`).toEqual(edit.to ?? null);
    }
  });

  it('chains each repeated field from the value the previous fix wrote', () => {
    const seen = new Map<string, Edit>();
    for (const edit of edits) {
      const key = JSON.stringify([edit.uid, edit.locale, edit.match ?? null, edit.path]);
      const previous = seen.get(key);
      if (previous) expect(edit.from, key).toEqual(previous.to);
      seen.set(key, edit);
    }
  });
});
