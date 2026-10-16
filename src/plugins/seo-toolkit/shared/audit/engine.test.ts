import { describe, expect, it } from 'vitest';

import { runAudit } from './engine';
import type { AuditEntry, AuditOptions, AuditReport } from './types';

const baseSeo = () => ({
  title: 'Title',
  description: 'A unique description',
  image: undefined as { alternativeText: string | null } | null | undefined,
  noIndex: undefined as boolean | null | undefined,
});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  uid: 'api::widget.widget',
  documentId: 'doc',
  locale: null,
  localized: false,
  label: null,
  seoField: 'seo',
  seo: baseSeo(),
  ...over,
});

const options = (over: Partial<AuditOptions> = {}): AuditOptions => ({
  status: 'published',
  locales: ['vi', 'en'],
  limits: { title: 60, description: 160 },
  severities: {},
  fields: {
    title: 'metaTitle',
    description: 'metaDescription',
    image: 'shareImage',
    noIndex: 'noIndex',
  },
  ...over,
});

const run = (entries: AuditEntry[], over: Partial<AuditOptions> = {}): AuditReport =>
  runAudit(entries, options(over), {
    generatedAt: '2026-10-16T00:00:00.000Z',
    contentTypes: ['api::widget.widget'],
  });

const codes = (report: AuditReport): string[] => report.issues.map((issue) => issue.code);

describe('runAudit', () => {
  it('reports only block-missing when the SEO block is null', () => {
    const report = run([entry({ seo: null, seoField: 'seo' })]);

    expect(codes(report)).toEqual(['seo.block-missing']);
    expect(report.issues[0].field).toBe('seo');
    expect(report.issues[0].severity).toBe('error');
  });

  it('reports title-missing for null/blank/empty titles', () => {
    for (const title of [null, '   ', '']) {
      const report = run([entry({ seo: { ...baseSeo(), title } })]);

      expect(codes(report)).toContain('seo.title-missing');
      expect(report.issues.find((issue) => issue.code === 'seo.title-missing')?.field).toBe(
        'metaTitle',
      );
    }
  });

  it('does not flag a title exactly at the limit', () => {
    const report = run([entry({ seo: { ...baseSeo(), title: 'a'.repeat(60) } })]);

    expect(codes(report)).not.toContain('seo.title-too-long');
  });

  it('flags a title one character over the limit with length/limit params', () => {
    const report = run([entry({ seo: { ...baseSeo(), title: 'a'.repeat(61) } })]);

    const issue = report.issues.find((entry) => entry.code === 'seo.title-too-long');
    expect(issue?.params).toEqual({ length: 61, limit: 60 });
  });

  it('counts code points, not UTF-16 units', () => {
    const report = run([entry({ seo: { ...baseSeo(), title: '😀'.repeat(30) } })], {
      limits: { title: 20, description: 160 },
    });

    const issue = report.issues.find((entry) => entry.code === 'seo.title-too-long');
    expect(issue?.params.length).toBe(30);
  });

  it('reports description-missing and description-too-long', () => {
    const missing = run([entry({ seo: { ...baseSeo(), description: null } })]);
    expect(codes(missing)).toContain('seo.description-missing');

    const tooLong = run([entry({ seo: { ...baseSeo(), description: 'b'.repeat(161) } })]);
    const issue = tooLong.issues.find((entry) => entry.code === 'seo.description-too-long');
    expect(issue?.params).toEqual({ length: 161, limit: 160 });
  });

  it('ignores image rules when the field is undefined', () => {
    const report = run([entry({ seo: { ...baseSeo(), image: undefined } })]);

    expect(codes(report)).not.toContain('media.share-image-missing');
    expect(codes(report)).not.toContain('media.share-image-alt-missing');
  });

  it('reports share-image-missing when the field exists but no image is set', () => {
    const report = run([entry({ seo: { ...baseSeo(), image: null } })]);

    const issue = report.issues.find((entry) => entry.code === 'media.share-image-missing');
    expect(issue?.severity).toBe('notice');
    expect(issue?.field).toBe('shareImage');
  });

  it('reports share-image-alt-missing for blank alt text', () => {
    const report = run([entry({ seo: { ...baseSeo(), image: { alternativeText: '  ' } } })]);

    expect(codes(report)).toContain('media.share-image-alt-missing');
  });

  it('accepts an image with alt text', () => {
    const report = run([entry({ seo: { ...baseSeo(), image: { alternativeText: 'x' } } })]);

    expect(codes(report)).not.toContain('media.share-image-alt-missing');
    expect(codes(report)).not.toContain('media.share-image-missing');
  });

  it('ignores noIndex when the field is undefined', () => {
    const report = run([entry({ seo: { ...baseSeo(), noIndex: undefined } })]);

    expect(codes(report)).not.toContain('seo.noindex-set');
  });

  it('reports noindex-set only when noIndex is true', () => {
    const on = run([entry({ seo: { ...baseSeo(), noIndex: true } })]);
    const issue = on.issues.find((entry) => entry.code === 'seo.noindex-set');
    expect(issue?.severity).toBe('warn');
    expect(issue?.field).toBe('noIndex');

    for (const noIndex of [false, null]) {
      const off = run([entry({ seo: { ...baseSeo(), noIndex } })]);
      expect(codes(off)).not.toContain('seo.noindex-set');
    }
  });

  it('flags duplicate titles across case and whitespace', () => {
    const report = run([
      entry({ documentId: 'a', seo: { ...baseSeo(), title: 'Hello World', description: 'desc a' } }),
      entry({
        documentId: 'b',
        seo: { ...baseSeo(), title: '  hello   world ', description: 'desc b' },
      }),
    ]);

    const duplicate = report.issues.filter((issue) => issue.code === 'seo.title-duplicate');
    expect(duplicate).toHaveLength(2);
    expect(duplicate[0].params.count).toBe(1);
    expect(duplicate[0].params.others).toEqual([
      { uid: 'api::widget.widget', documentId: 'b', locale: null, seoField: 'seo' },
    ]);
    expect(duplicate[1].params.others).toEqual([
      { uid: 'api::widget.widget', documentId: 'a', locale: null, seoField: 'seo' },
    ]);
  });

  it('names the seoField of the matching block so a document never points at itself', () => {
    const shared = { documentId: 'd1', locale: 'vi', localized: true };
    const report = run(
      [
        entry({ ...shared, seoField: 'seo', seo: { ...baseSeo(), title: 'Same' } }),
        entry({ ...shared, seoField: 'cateringSeo', seo: { ...baseSeo(), title: 'Same' } }),
      ],
      { locales: ['vi'] },
    );

    const duplicate = report.issues.filter((issue) => issue.code === 'seo.title-duplicate');
    expect(duplicate).toHaveLength(2);
    const seoIssue = duplicate.find((issue) => issue.seoField === 'seo');
    expect(seoIssue?.params.others).toEqual([
      { uid: 'api::widget.widget', documentId: 'd1', locale: 'vi', seoField: 'cateringSeo' },
    ]);
    const cateringIssue = duplicate.find((issue) => issue.seoField === 'cateringSeo');
    expect(cateringIssue?.params.others).toEqual([
      { uid: 'api::widget.widget', documentId: 'd1', locale: 'vi', seoField: 'seo' },
    ]);
  });

  it('does not treat the same title in different locales as duplicate', () => {
    const report = run([
      entry({ documentId: 'a', locale: 'vi', localized: true, seo: { ...baseSeo(), title: 'Same' } }),
      entry({ documentId: 'b', locale: 'en', localized: true, seo: { ...baseSeo(), title: 'Same' } }),
    ]);

    expect(codes(report)).not.toContain('seo.title-duplicate');
  });

  it('excludes noIndex entries from duplicate comparison', () => {
    const report = run([
      entry({ documentId: 'a', seo: { ...baseSeo(), title: 'Same' } }),
      entry({ documentId: 'b', seo: { ...baseSeo(), title: 'Same', noIndex: true } }),
    ]);

    expect(codes(report)).not.toContain('seo.title-duplicate');
  });

  it('does not flag duplicates for empty titles', () => {
    const report = run([
      entry({ documentId: 'a', seo: { ...baseSeo(), title: '' } }),
      entry({ documentId: 'b', seo: { ...baseSeo(), title: '   ' } }),
    ]);

    expect(codes(report)).not.toContain('seo.title-duplicate');
    expect(codes(report).filter((code) => code === 'seo.title-missing')).toHaveLength(2);
  });

  it('caps others at five entries and sorts them', () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry({ documentId: `d${index + 1}`, seo: { ...baseSeo(), title: 'Same' } }),
    );

    const report = run(entries);
    const duplicate = report.issues.filter((issue) => issue.code === 'seo.title-duplicate');
    expect(duplicate).toHaveLength(7);
    for (const issue of duplicate) {
      expect(issue.params.count).toBe(6);
      expect(issue.params.others).toHaveLength(5);
    }

    const first = duplicate.find((issue) => issue.documentId === 'd1')?.params.others as Array<{
      documentId: string;
    }>;
    expect(first.map((other) => other.documentId)).toEqual(['d2', 'd3', 'd4', 'd5', 'd6']);
  });

  it('reports a missing translation at the missing locale', () => {
    const report = run([entry({ documentId: 'a', locale: 'vi', localized: true })], {
      locales: ['vi', 'en'],
    });

    const issue = report.issues.find((entry) => entry.code === 'i18n.translation-missing');
    expect(issue?.locale).toBe('en');
    expect(issue?.params).toEqual({ locale: 'en', sourceLocales: ['vi'] });
    expect(issue?.field).toBeNull();
  });

  it('does not report a translation when both locales exist', () => {
    const report = run(
      [
        entry({ documentId: 'a', locale: 'vi', localized: true }),
        entry({ documentId: 'a', locale: 'en', localized: true }),
      ],
      { locales: ['vi', 'en'] },
    );

    expect(codes(report)).not.toContain('i18n.translation-missing');
  });

  it('never reports translation-missing for a non-localized content type', () => {
    const report = run([entry({ localized: false, locale: null })], { locales: ['vi', 'en'] });

    expect(codes(report)).not.toContain('i18n.translation-missing');
  });

  it('only considers configured locales in scope', () => {
    const report = run([entry({ documentId: 'a', locale: 'vi', localized: true })], {
      locales: ['vi'],
    });

    expect(codes(report)).not.toContain('i18n.translation-missing');
  });

  it('applies a configured severity and reflects it in the summary', () => {
    const report = run([entry({ seo: { ...baseSeo(), noIndex: true } })], {
      severities: { 'seo.noindex-set': 'notice' },
    });

    expect(report.issues.find((issue) => issue.code === 'seo.noindex-set')?.severity).toBe('notice');
    expect(report.summary.notice).toBe(1);
    expect(report.summary.warn).toBe(0);
  });

  it('drops a rule set to off from issues and summary', () => {
    const report = run([entry({ seo: { ...baseSeo(), title: 'a'.repeat(61) } })], {
      severities: { 'seo.title-too-long': 'off' },
    });

    expect(codes(report)).not.toContain('seo.title-too-long');
    expect(report.summary.warn).toBe(0);
  });

  it('sorts deterministically and is order-independent', () => {
    const entries = [
      entry({ uid: 'api::z.z', documentId: 'z1', seo: { ...baseSeo(), title: 'z', noIndex: true } }),
      entry({ uid: 'api::a.a', documentId: 'a1', seo: null }),
      entry({ uid: 'api::b.b', documentId: 'b1', seo: { ...baseSeo(), title: 'b', image: null } }),
    ];

    const report = run(entries);
    expect(codes(report)).toEqual([
      'seo.block-missing',
      'seo.noindex-set',
      'media.share-image-missing',
    ]);
    expect(run(entries)).toEqual(report);
    expect(run([entries[2], entries[0], entries[1]])).toEqual(report);
  });

  it('runs against a generic configuration with no Salanca names', () => {
    const report = run(
      [
        entry({
          uid: 'api::widget.widget',
          documentId: 'w1',
          locale: 'fr',
          localized: true,
          seo: { ...baseSeo(), title: null },
        }),
      ],
      {
        locales: ['fr', 'de'],
        fields: { title: 'heading', description: 'summary', image: null, noIndex: null },
      },
    );

    expect(report.issues.find((issue) => issue.code === 'seo.title-missing')?.field).toBe('heading');
    expect(report.issues.find((issue) => issue.code === 'i18n.translation-missing')?.locale).toBe(
      'de',
    );
  });

  it('counts every input entry in the summary', () => {
    const report = run(Array.from({ length: 5 }, (_, index) => entry({ documentId: `d${index}` })));

    expect(report.summary.entries).toBe(5);
  });

  it('echoes scope and generatedAt from meta and options', () => {
    const report = run([entry()]);

    expect(report.generatedAt).toBe('2026-10-16T00:00:00.000Z');
    expect(report.scope).toEqual({
      status: 'published',
      locales: ['vi', 'en'],
      contentTypes: ['api::widget.widget'],
    });
  });

  it('carries the seoField of the block that produced the issue', () => {
    const report = run([entry({ seoField: 'cateringSeo', seo: { ...baseSeo(), title: null } })]);

    expect(report.issues.find((issue) => issue.code === 'seo.title-missing')?.seoField).toBe(
      'cateringSeo',
    );
  });

  it('keeps two blocks of one document distinct and ordered by seoField', () => {
    const shared = { documentId: 'd1', locale: 'vi', localized: true };
    const report = run(
      [
        entry({ ...shared, seoField: 'seo', seo: { ...baseSeo(), title: null } }),
        entry({ ...shared, seoField: 'cateringSeo', seo: { ...baseSeo(), title: null } }),
      ],
      { locales: ['vi'] },
    );

    expect(
      report.issues.filter((issue) => issue.code === 'seo.title-missing').map((i) => i.seoField),
    ).toEqual(['cateringSeo', 'seo']);
  });

  it('leaves seoField null on document-level translation issues', () => {
    const report = run([entry({ documentId: 'a', locale: 'vi', localized: true })], {
      locales: ['vi', 'en'],
    });

    expect(
      report.issues.find((issue) => issue.code === 'i18n.translation-missing')?.seoField,
    ).toBeNull();
  });
});
