import { describe, expect, it } from 'vitest';

import { desiredSlugs, slugify } from './slug';

describe('slugify', () => {
  it('strips Vietnamese diacritics', () => {
    expect(slugify('Bún bò Huế')).toBe('bun-bo-hue');
    expect(slugify('Phở Đặc Biệt')).toBe('pho-dac-biet');
    expect(slugify('Trà đào cam sả')).toBe('tra-dao-cam-sa');
  });
  it('converts đ/Đ to d (no NFD decomposition)', () => {
    expect(slugify('Đà nẵng')).toBe('da-nang');
    expect(slugify('Đặc biệt')).toBe('dac-biet');
  });
  it('lowercases and hyphenates whitespace', () => {
    expect(slugify('Combo  Trưa')).toBe('combo-trua');
  });
  it('collapses punctuation into single hyphens', () => {
    expect(slugify('bún — bò (đặc biệt)!')).toBe('bun-bo-dac-biet');
  });
  it('trims leading/trailing hyphens', () => {
    expect(slugify('--bun bo--')).toBe('bun-bo');
    expect(slugify('  spaced  ')).toBe('spaced');
  });
  it('returns empty for script outside [a-z0-9]', () => {
    expect(slugify('河粉')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
  it('truncates at the slug length cap without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(300)}`);
    expect(slug.length).toBeLessThanOrEqual(200);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('desiredSlugs', () => {
  it('derives a row per locale present in name', () => {
    const d = desiredSlugs({ name: { vi: 'Bún bò', en: 'Beef noodle' } });
    expect(d.get('vi')).toBe('bun-bo');
    expect(d.get('en')).toBe('beef-noodle');
    expect(d.size).toBe(2);
  });
  it('prefers a provided slug over the derived one', () => {
    const d = desiredSlugs({ name: { vi: 'Bún bò' }, slug: { vi: 'Custom SLUG ' } });
    expect(d.get('vi')).toBe('custom-slug');
  });
  it('normalizes provided slugs through slugify', () => {
    const d = desiredSlugs({ slug: { vi: 'Bún Bò!!' } });
    expect(d.get('vi')).toBe('bun-bo');
  });
  it('keeps a slug row for a locale with slug but no name', () => {
    const d = desiredSlugs({ name: { vi: 'Bún bò' }, slug: { en: 'bb-hue' } });
    expect(d.get('en')).toBe('bb-hue');
    expect(d.get('vi')).toBe('bun-bo');
  });
  it('emits no row when a locale normalizes to empty', () => {
    const d = desiredSlugs({ name: { vi: 'Bún bò', en: '河粉' } });
    expect(d.has('en')).toBe(false);
  });
  it('emits no rows for empty/non-object input', () => {
    expect(desiredSlugs({}).size).toBe(0);
    expect(desiredSlugs({ name: 'not-a-map', slug: 5 }).size).toBe(0);
    expect(desiredSlugs({ name: { vi: '  ' }, slug: { vi: '' } }).size).toBe(0);
  });
  it('ignores a blank provided slug and falls back to the name', () => {
    const d = desiredSlugs({ name: { vi: 'Bún bò' }, slug: { vi: '   ' } });
    expect(d.get('vi')).toBe('bun-bo');
  });
});
