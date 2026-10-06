import { describe, expect, it } from 'vitest';

import {
  buildMediaReconciliationReport,
  formatMediaReconciliationReport,
  formatOrphanDeletionPlan,
  parseProtectedKeys,
  parseReconcileArgs,
  selectOrphansForDeletion,
  stripTrailingSlashes,
  updateOrphanLedger,
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

describe('parseReconcileArgs', () => {
  it('is a read-only report by default', () => {
    expect(parseReconcileArgs([])).toEqual({ deleteOrphans: false, apply: false, minAgeDays: 7 });
  });

  it('reads the orphan deletion flags', () => {
    expect(parseReconcileArgs(['--delete-orphans', '--apply', '--min-age-days', '14'])).toEqual({
      deleteOrphans: true,
      apply: true,
      minAgeDays: 14,
    });
  });

  it('rejects --apply without --delete-orphans, bad ages and unknown flags', () => {
    expect(() => parseReconcileArgs(['--apply'])).toThrow('--apply only applies');
    expect(() => parseReconcileArgs(['--delete-orphans', '--min-age-days', '0'])).toThrow();
    expect(() => parseReconcileArgs(['--delete-orphans', '--min-age-days', 'x'])).toThrow();
    expect(() => parseReconcileArgs(['--force'])).toThrow('Unknown argument');
  });
});

describe('parseProtectedKeys', () => {
  it('ignores comments and blank lines', () => {
    expect(parseProtectedKeys('# note\r\n\nuploads/a.webp\n  uploads/b.webp  \n')).toEqual(
      new Set(['uploads/a.webp', 'uploads/b.webp']),
    );
  });
});

describe('updateOrphanLedger', () => {
  it('keeps first-seen dates, stamps new orphans and drops re-referenced keys', () => {
    const now = new Date('2026-10-20T00:00:00Z');

    expect(
      updateOrphanLedger(
        { 'uploads/a.webp': '2026-10-01T00:00:00.000Z', 'uploads/gone.webp': '2026-09-01T00:00:00.000Z' },
        ['uploads/a.webp', 'uploads/b.webp'],
        now,
      ),
    ).toEqual({
      'uploads/a.webp': '2026-10-01T00:00:00.000Z',
      'uploads/b.webp': '2026-10-20T00:00:00.000Z',
    });
    expect(updateOrphanLedger(null, ['uploads/a.webp'], now)).toEqual({
      'uploads/a.webp': '2026-10-20T00:00:00.000Z',
    });
  });
});

describe('selectOrphansForDeletion', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const firstSeen = {
    'uploads/old.webp': '2026-10-01T00:00:00.000Z',
    'uploads/just-replaced.webp': '2026-10-19T23:00:00.000Z',
    'uploads/protected.webp': '2026-01-01T00:00:00.000Z',
  };

  it('deletes only unprotected keys that stayed orphans for the grace period', () => {
    const plan = selectOrphansForDeletion(
      ['uploads/old.webp', 'uploads/just-replaced.webp', 'uploads/protected.webp', 'uploads/unseen.webp'],
      firstSeen,
      new Set(['uploads/protected.webp']),
      now,
      7,
    );

    expect(plan.deletable).toEqual(['uploads/old.webp']);
    expect(plan.kept).toEqual([
      { key: 'uploads/just-replaced.webp', reason: 'too-recent' },
      { key: 'uploads/protected.webp', reason: 'protected' },
      { key: 'uploads/unseen.webp', reason: 'too-recent' },
    ]);
  });

  it('formats a dry-run plan that asks for --apply', () => {
    const text = formatOrphanDeletionPlan(
      { deletable: ['uploads/old.webp'], kept: [] },
      { apply: false, minAgeDays: 7 },
    );

    expect(text).toContain('uploads/old.webp');
    expect(text).toContain('--apply');
  });
});
