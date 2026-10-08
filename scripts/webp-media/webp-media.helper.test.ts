import { describe, expect, it } from 'vitest';

import {
  buildWebpUpload,
  formatWebpReport,
  isWebpTarget,
  legacyFormatNames,
  planWebpConversion,
  replaceFormats,
} from './webp-media.helper.mjs';

const baseUrl = 'https://media.example.com';
const storage = { baseUrl, provider: 'aws-s3' };

const jpegFormat = (name: string, width: number, height: number) => ({
  name: `${name}_hero.jpg`,
  hash: `${name}_hero_abc`,
  ext: '.jpg',
  mime: 'image/jpeg',
  width,
  height,
  size: 90.5,
  sizeInBytes: 90500,
  url: `${baseUrl}/uploads/${name}_hero_abc.jpg`,
});

const jpegFile = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'hero.jpg',
  hash: 'hero_abc',
  ext: '.jpg',
  mime: 'image/jpeg',
  provider: 'aws-s3',
  url: `${baseUrl}/uploads/hero_abc.jpg`,
  formats: {
    w640: jpegFormat('w640', 640, 427),
    thumbnail: jpegFormat('thumbnail', 234, 156),
  },
  ...overrides,
});

describe('isWebpTarget', () => {
  it('targets JPEG uploads only', () => {
    expect(isWebpTarget({ mime: 'image/jpeg' })).toBe(true);
    expect(isWebpTarget({ mime: 'image/png' })).toBe(false);
    expect(isWebpTarget({ mime: 'image/webp' })).toBe(false);
    expect(isWebpTarget({ mime: 'application/pdf' })).toBe(false);
  });
});

describe('legacyFormatNames', () => {
  it('lists usable non-WebP derivatives, sorted', () => {
    expect(legacyFormatNames(jpegFile())).toEqual(['thumbnail', 'w640']);
  });

  it('skips derivatives that are already WebP or unusable', () => {
    const file = jpegFile({
      formats: {
        w640: { ...jpegFormat('w640', 640, 427), mime: 'image/webp' },
        w960: { ...jpegFormat('w960', 960, 640), url: '' },
        w1280: { ...jpegFormat('w1280', 1280, 853), width: 0 },
        large: jpegFormat('large', 1000, 667),
      },
    });
    expect(legacyFormatNames(file)).toEqual(['large']);
  });

  it('handles a file without formats', () => {
    expect(legacyFormatNames(jpegFile({ formats: null }))).toEqual([]);
  });
});

describe('planWebpConversion', () => {
  it('plans JPEG files that still have JPEG derivatives', () => {
    const files = [
      jpegFile(),
      jpegFile({ id: 2, mime: 'image/png' }),
      jpegFile({ id: 3, formats: { w640: { ...jpegFormat('w640', 640, 427), mime: 'image/webp' } } }),
    ];
    expect(planWebpConversion(files, storage)).toEqual({
      jpegFiles: 2,
      pending: [{ fileId: 1, names: ['thumbnail', 'w640'] }],
      skipped: [],
      formats: 2,
    });
  });

  it('skips files outside the configured bucket', () => {
    const plan = planWebpConversion(
      [jpegFile({ provider: 'local' }), jpegFile({ id: 2, url: 'https://other.example.com/x.jpg' })],
      storage,
    );
    expect(plan.pending).toEqual([]);
    expect(plan.skipped.map((entry) => entry.fileId)).toEqual([1, 2]);
  });
});

describe('buildWebpUpload', () => {
  it('keeps the derivative hash shape under a new .webp key', () => {
    const buffer = Buffer.alloc(41234);
    const upload = buildWebpUpload({
      name: 'w640',
      row: { name: 'hero.jpg', hash: 'hero_abc', path: null },
      buffer,
      width: 640,
      height: 427,
    });
    expect(upload).toEqual({
      name: 'w640_hero.webp',
      hash: 'w640_hero_abc',
      ext: '.webp',
      mime: 'image/webp',
      path: null,
      width: 640,
      height: 427,
      size: 41.23,
      sizeInBytes: 41234,
      buffer,
    });
  });
});

describe('replaceFormats', () => {
  it('overrides converted entries and keeps the rest', () => {
    const existing = { w640: jpegFormat('w640', 640, 427), thumbnail: jpegFormat('thumbnail', 234, 156) };
    const webp = { ...jpegFormat('w640', 640, 427), mime: 'image/webp' };
    expect(replaceFormats(existing, { w640: webp })).toEqual({ w640: webp, thumbnail: existing.thumbnail });
  });
});

describe('formatWebpReport', () => {
  it('reports counts and byte savings', () => {
    const report = formatWebpReport({
      label: 'after',
      plan: { jpegFiles: 3, pending: [{ fileId: 7, names: ['w640'] }], skipped: [], formats: 1 },
      bytes: { before: 4 * 1024 * 1024, after: 1024 * 1024 },
    });
    expect(report).toContain('JPEG files: 3');
    expect(report).toContain('Files with non-WebP derivatives: 1 (1 derivatives) (e.g. #7)');
    expect(report).toContain('4.00 MB -> 1.00 MB (-75%)');
  });
});
