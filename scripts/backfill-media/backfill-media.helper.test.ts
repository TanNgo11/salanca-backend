import { describe, expect, it } from 'vitest';

import {
  buildCopyObjectInput,
  encodeCopySource,
  fileObjects,
  formatBackfillReport,
  isBreakpointEligible,
  mapWithConcurrency,
  mergeFormats,
  missingBreakpoints,
  needsCacheControl,
  objectKeyFromUrl,
  parseBackfillArgs,
  planFormatBackfill,
  planHeaderBackfill,
  resolveProviderAcl,
  takeFiles,
  toStoredFormat,
} from './backfill-media.helper.mjs';

const breakpoints = { w640: 640, w960: 960, w1280: 1280, w1920: 1920 };
const baseUrl = 'https://media.example.com';
const cacheControl = 'public, max-age=31536000, immutable';

describe('parseBackfillArgs', () => {
  it('defaults to a dry run without a limit', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false, limit: null });
  });

  it('reads --apply and both --limit spellings', () => {
    expect(parseBackfillArgs(['--apply', '--limit', '5'])).toEqual({ apply: true, limit: 5 });
    expect(parseBackfillArgs(['--limit=12'])).toEqual({ apply: false, limit: 12 });
  });

  it('rejects bad limits and unknown flags', () => {
    expect(() => parseBackfillArgs(['--limit'])).toThrow('positive integer');
    expect(() => parseBackfillArgs(['--limit', '0'])).toThrow('positive integer');
    expect(() => parseBackfillArgs(['--limit', '-2'])).toThrow('positive integer');
    expect(() => parseBackfillArgs(['--force'])).toThrow('Unknown argument "--force"');
  });
});

describe('breakpoint eligibility', () => {
  it('mirrors Strapi: breakpoint smaller than width OR height', () => {
    expect(isBreakpointEligible(1920, { width: 2560, height: 1440 })).toBe(true);
    expect(isBreakpointEligible(1920, { width: 1920, height: 1080 })).toBe(false);
    expect(isBreakpointEligible(1280, { width: 800, height: 2000 })).toBe(true);
    expect(isBreakpointEligible(640, { width: null, height: null })).toBe(false);
  });

  it('lists only eligible breakpoints that have no format url yet', () => {
    const file = {
      mime: 'image/webp',
      width: 1500,
      height: 1000,
      formats: { w640: { url: `${baseUrl}/uploads/w640_a.webp` }, large: { url: 'x' } },
    };
    expect(missingBreakpoints(file, breakpoints)).toEqual(['w960', 'w1280']);
  });

  it('ignores mimes Strapi does not resize', () => {
    expect(
      missingBreakpoints({ mime: 'image/svg+xml', width: 4000, height: 4000 }, breakpoints),
    ).toEqual([]);
    expect(
      missingBreakpoints({ mime: 'image/avif', width: 4000, height: 4000 }, breakpoints),
    ).toEqual([]);
  });
});

describe('object keys', () => {
  it('derives the key from a url under the CDN base', () => {
    expect(objectKeyFromUrl(`${baseUrl}/uploads/hero_abc.webp`, baseUrl)).toBe('uploads/hero_abc.webp');
    expect(objectKeyFromUrl(`${baseUrl}/uploads/hero_abc.webp`, `${baseUrl}/`)).toBe('uploads/hero_abc.webp');
  });

  it('returns null for foreign or relative urls', () => {
    expect(objectKeyFromUrl('https://other.example.com/uploads/a.webp', baseUrl)).toBeNull();
    expect(objectKeyFromUrl('https://media.example.com.evil/uploads/a.webp', baseUrl)).toBeNull();
    expect(objectKeyFromUrl('/uploads/a.webp', baseUrl)).toBeNull();
    expect(objectKeyFromUrl(undefined, baseUrl)).toBeNull();
  });

  it('lists the original and every format', () => {
    expect(
      fileObjects(
        {
          url: `${baseUrl}/uploads/a.webp`,
          formats: { thumbnail: { url: `${baseUrl}/uploads/thumbnail_a.webp` }, broken: {} },
        },
        baseUrl,
      ),
    ).toEqual([
      { variant: 'original', url: `${baseUrl}/uploads/a.webp`, key: 'uploads/a.webp' },
      { variant: 'thumbnail', url: `${baseUrl}/uploads/thumbnail_a.webp`, key: 'uploads/thumbnail_a.webp' },
    ]);
  });
});

describe('Cache-Control and copy input', () => {
  it('needs the header when absent or different', () => {
    expect(needsCacheControl({}, cacheControl)).toBe(true);
    expect(needsCacheControl({ CacheControl: 'max-age=60' }, cacheControl)).toBe(true);
    expect(needsCacheControl({ CacheControl: cacheControl }, cacheControl)).toBe(false);
  });

  it('resolves ACL like the aws-s3 provider', () => {
    expect(resolveProviderAcl({ Bucket: 'b', ACL: 'public-read' })).toBe('public-read');
    expect(resolveProviderAcl({ Bucket: 'b', ACL: undefined })).toBeUndefined();
    expect(resolveProviderAcl({ Bucket: 'b' })).toBe('public-read');
  });

  it('encodes the copy source per path segment', () => {
    expect(encodeCopySource('bucket', 'uploads/a b+c.webp')).toBe('bucket/uploads/a%20b%2Bc.webp');
  });

  it('re-sends content type, metadata and ACL with REPLACE', () => {
    expect(
      buildCopyObjectInput({
        bucket: 'bucket',
        key: 'uploads/a.webp',
        head: { ContentType: 'image/webp', Metadata: { owner: 'x' } },
        cacheControl,
        acl: 'public-read',
      }),
    ).toEqual({
      Bucket: 'bucket',
      Key: 'uploads/a.webp',
      CopySource: 'bucket/uploads/a.webp',
      MetadataDirective: 'REPLACE',
      CacheControl: cacheControl,
      ContentType: 'image/webp',
      Metadata: { owner: 'x' },
      ACL: 'public-read',
    });
  });

  it('omits ACL when the bucket disables ACLs', () => {
    const input = buildCopyObjectInput({
      bucket: 'bucket',
      key: 'k.webp',
      head: { ContentType: 'image/webp', Metadata: {} },
      cacheControl,
      acl: undefined,
    });
    expect(input).not.toHaveProperty('ACL');
    expect(input).not.toHaveProperty('Metadata');
  });
});

describe('format merge', () => {
  it('stores only serialisable Strapi format fields', () => {
    expect(
      toStoredFormat({
        name: 'w640_a.webp',
        hash: 'w640_a',
        ext: '.webp',
        mime: 'image/webp',
        path: null,
        width: 640,
        height: 427,
        size: 30.1,
        sizeInBytes: 30100,
        url: `${baseUrl}/uploads/w640_a.webp`,
        getStream: () => null,
        tmpWorkingDirectory: '/tmp/x',
      }),
    ).toEqual({
      name: 'w640_a.webp',
      hash: 'w640_a',
      ext: '.webp',
      mime: 'image/webp',
      path: null,
      width: 640,
      height: 427,
      size: 30.1,
      sizeInBytes: 30100,
      url: `${baseUrl}/uploads/w640_a.webp`,
    });
  });

  it('keeps existing keys and adds only new ones', () => {
    const existing = { large: { url: 'L' }, w640: { url: 'old' } };
    expect(mergeFormats(existing, { w640: { url: 'new' }, w960: { url: 'N' } })).toEqual({
      large: { url: 'L' },
      w640: { url: 'old' },
      w960: { url: 'N' },
    });
    expect(mergeFormats(null, { w960: { url: 'N' } })).toEqual({ w960: { url: 'N' } });
  });
});

describe('planning and report', () => {
  const files = [
    {
      id: 1,
      mime: 'image/webp',
      provider: 'aws-s3',
      width: 2560,
      height: 1440,
      url: `${baseUrl}/uploads/a.webp`,
      formats: { large: { url: `${baseUrl}/uploads/large_a.webp` } },
    },
    {
      id: 2,
      mime: 'image/webp',
      provider: 'aws-s3',
      width: 500,
      height: 300,
      url: `${baseUrl}/uploads/b.webp`,
      formats: null,
    },
    {
      id: 3,
      mime: 'image/jpeg',
      provider: 'local',
      width: 3000,
      height: 2000,
      url: '/uploads/c.jpg',
      formats: null,
    },
    { id: 4, mime: 'application/pdf', provider: 'aws-s3', url: `${baseUrl}/uploads/d.pdf` },
  ];

  it('plans format backfill only for bucket-stored eligible images', () => {
    const plan = planFormatBackfill(files, { breakpoints, baseUrl, provider: 'aws-s3' });
    expect(plan.imageFiles).toBe(3);
    expect(plan.pending).toEqual([{ fileId: 1, missing: ['w640', 'w960', 'w1280', 'w1920'] }]);
    expect(plan.skipped.map((entry: { fileId: number }) => entry.fileId)).toEqual([3]);
  });

  it('reports 0 pending once every format exists (idempotent re-run)', () => {
    const done = {
      ...files[0],
      formats: Object.fromEntries(Object.keys(breakpoints).map((name) => [name, { url: `${baseUrl}/uploads/${name}_a.webp` }])),
    };
    expect(planFormatBackfill([done], { breakpoints, baseUrl, provider: 'aws-s3' }).pending).toEqual([]);
  });

  it('plans header backfill per object and flags missing objects', () => {
    const heads = new Map<string, unknown>([
      ['uploads/a.webp', { CacheControl: cacheControl }],
      ['uploads/large_a.webp', {}],
      ['uploads/b.webp', { CacheControl: 'no-cache' }],
      ['uploads/d.pdf', null],
    ]);
    const plan = planHeaderBackfill(files, heads, { baseUrl, cacheControl });
    expect(plan.checkedObjects).toBe(4);
    expect(plan.pending).toEqual([
      { fileId: 1, variant: 'large', key: 'uploads/large_a.webp', current: null },
      { fileId: 2, variant: 'original', key: 'uploads/b.webp', current: 'no-cache' },
    ]);
    expect(plan.missingObjects).toEqual([{ fileId: 4, variant: 'original', key: 'uploads/d.pdf' }]);
    expect(plan.unmanaged).toEqual([{ fileId: 3, variant: 'original', url: '/uploads/c.jpg' }]);
  });

  it('formats counts and caps example ids', () => {
    const text = formatBackfillReport(
      {
        label: 'dry-run',
        formats: {
          imageFiles: 3,
          pending: [{ fileId: 1 }, { fileId: 2 }, { fileId: 5 }],
          skipped: [],
        },
        headers: {
          checkedObjects: 4,
          pending: [{ fileId: 1 }, { fileId: 1 }],
          missingObjects: [],
          unmanaged: [],
        },
      },
      2,
    );
    expect(text).toContain('Media backfill report — dry-run');
    expect(text).toContain('Image files (plugin::upload.file, image/*): 3');
    expect(text).toContain('Files missing an eligible breakpoint format: 3 (e.g. #1, #2, … (+1))');
    expect(text).toContain('Objects without the expected Cache-Control: 2 in 1 files (e.g. #1)');
    expect(text).not.toContain('missing in the bucket');
  });

  it('groups pending work by file and applies the limit', () => {
    const entries = [
      { fileId: 1, key: 'a' },
      { fileId: 2, key: 'b' },
      { fileId: 1, key: 'c' },
      { fileId: 3, key: 'd' },
    ];
    expect(takeFiles(entries, 2)).toEqual([
      { fileId: 1, items: [entries[0], entries[2]] },
      { fileId: 2, items: [entries[1]] },
    ]);
    expect(takeFiles(entries, null)).toHaveLength(3);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps order and never exceeds the concurrency', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});
