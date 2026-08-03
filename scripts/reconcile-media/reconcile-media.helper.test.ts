import { describe, expect, it } from 'vitest';

import {
  buildMediaReconciliationReport,
  formatMediaReconciliationReport,
  stripTrailingSlashes,
} from './reconcile-media.helper.mjs';

describe('stripTrailingSlashes', () => {
  it('trims trailing slashes without regex backtracking', () => {
    expect(stripTrailingSlashes('https://cdn.example.com/')).toBe('https://cdn.example.com');
    expect(stripTrailingSlashes('https://cdn.example.com///')).toBe('https://cdn.example.com');
    expect(stripTrailingSlashes('noslash')).toBe('noslash');
  });
});

describe('buildMediaReconciliationReport', () => {
  const baseUrl = 'https://cdn.example.com/media';

  it('reports missing objects and unmanaged urls', () => {
    const report = buildMediaReconciliationReport(
      [
        {
          id: 1,
          name: 'hero.png',
          url: 'https://cdn.example.com/media/hero.png',
          formats: {
            thumbnail: { url: 'https://cdn.example.com/media/thumb_hero.png' },
          },
        },
        {
          id: 2,
          name: 'local.png',
          url: '/uploads/local.png',
        },
      ],
      // Keys as stored in bucket (paths after CDN base URL)
      ['hero.png', 'orphan.png'],
      baseUrl,
    );

    expect(report.checkedFiles).toBe(2);
    expect(report.missingObjects).toEqual([
      {
        fileId: 1,
        fileName: 'hero.png',
        variant: 'thumbnail',
        key: 'thumb_hero.png',
      },
    ]);
    expect(report.orphanCandidates).toEqual(['orphan.png']);
    expect(report.unmanagedUrls).toEqual([
      {
        fileId: 2,
        fileName: 'local.png',
        variant: 'original',
        url: '/uploads/local.png',
      },
    ]);
  });
});

describe('formatMediaReconciliationReport', () => {
  it('includes summary counts', () => {
    const output = formatMediaReconciliationReport({
      checkedFiles: 1,
      expectedObjects: 1,
      bucketObjects: 1,
      missingObjects: [],
      orphanCandidates: [],
      unmanagedUrls: [],
    });
    expect(output).toContain('Số bản ghi kiểm tra: 1');
    expect(output).toContain('Không có gì bị xoá');
  });
});
