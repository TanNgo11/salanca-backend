import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  experienceFields,
  experienceMediaSources,
  stripIds,
  withoutDuplicateTitles,
  withoutRetiredMenuLinks,
  // @ts-expect-error Runtime ESM helper.
} from './lib/experience-update.helper.mjs';

const bundle = JSON.parse(readFileSync(resolve('data/content-release/bundle.json'), 'utf8'));

describe('seed-experience-update helpers', () => {
  it('drops only the Desserts submenu links', () => {
    const links = [
      { label: 'Buffet Churrascaria', url: '/vi/thuc-don#buffet' },
      { label: 'Tráng miệng', url: '/vi/thuc-don#trang-mieng' },
      { label: 'Desserts', url: '/en/menu/desserts' },
      { label: 'Catering', url: '/vi/thuc-don/catering' },
    ];
    expect(withoutRetiredMenuLinks(links)?.map((link: { label: string }) => link.label)).toEqual(['Buffet Churrascaria', 'Catering']);
    expect(withoutRetiredMenuLinks([links[0]])).toBeNull();
  });

  it('keeps the first of repeated included items', () => {
    const items = [{ title: 'CHURRASCARIA' }, { title: 'Churrascaria ' }, { title: 'SALAD' }];
    expect(withoutDuplicateTitles(items)).toEqual([{ title: 'CHURRASCARIA' }, { title: 'SALAD' }]);
    expect(withoutDuplicateTitles([{ title: 'CHURRASCARIA' }])).toBeNull();
  });

  it('strips component ids recursively', () => {
    expect(stripIds([{ id: 3, title: 'A', nested: { id: 4, x: 1 } }])).toEqual([{ title: 'A', nested: { x: 1 } }]);
  });

  it('resolves the four experience fields from the shipped bundle in both locales', () => {
    const sources: Map<string, string> = experienceMediaSources(bundle, ['vi', 'en']);
    expect([...new Set(sources.values())].sort()).toEqual([
      'pdf-heritage-en-bg.webp',
      'pdf-heritage-vi-bg.webp',
      'rodizio-signal-continue.webp',
      'rodizio-signal-pause.webp',
    ]);
    const ids = new Map([...sources.keys()].map((file, index) => [file, index + 1]));
    for (const locale of ['vi', 'en']) {
      const fields = experienceFields(bundle, locale, ids);
      expect(Object.keys(fields)).toEqual(['ritualContinueImage', 'ritualPauseImage', 'heritageBody', 'heritageImage']);
      expect(typeof fields.heritageImage.media).toBe('number');
      expect(JSON.stringify(fields.heritageBody)).toContain('Nova Group');
      expect(JSON.stringify(fields.heritageBody)).not.toContain('NoVaFood');
    }
  });
});
