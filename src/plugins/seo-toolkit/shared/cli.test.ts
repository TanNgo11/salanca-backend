import { describe, expect, it } from 'vitest';

import { exitCodeFor, formatTable, parseFailOn } from './cli';
import type { AuditReport } from './audit/types';

const report = (over: Partial<AuditReport> = {}): AuditReport => ({
  generatedAt: '2026-10-16T00:00:00.000Z',
  scope: { status: 'published', locales: ['vi', 'en'], contentTypes: ['api::home-page.home-page'] },
  summary: { entries: 42, error: 0, warn: 0, notice: 0 },
  issues: [],
  ...over,
});

describe('parseFailOn', () => {
  it('accepts the four levels', () => {
    for (const value of ['error', 'warn', 'notice', 'never'] as const) {
      expect(parseFailOn(value)).toBe(value);
    }
  });

  it('rejects anything else', () => {
    expect(() => parseFailOn('loud')).toThrow(/fail-on/);
  });
});

describe('exitCodeFor', () => {
  it('never fails when fail-on is never', () => {
    expect(exitCodeFor(report({ summary: { entries: 1, error: 3, warn: 2, notice: 1 } }), 'never')).toBe(0);
  });

  it('fails only on errors at the error level', () => {
    expect(exitCodeFor(report({ summary: { entries: 1, error: 1, warn: 0, notice: 0 } }), 'error')).toBe(1);
    expect(exitCodeFor(report({ summary: { entries: 1, error: 0, warn: 1, notice: 0 } }), 'error')).toBe(0);
  });

  it('fails on errors or warnings at the warn level', () => {
    expect(exitCodeFor(report({ summary: { entries: 1, error: 0, warn: 1, notice: 0 } }), 'warn')).toBe(1);
    expect(exitCodeFor(report({ summary: { entries: 1, error: 0, warn: 0, notice: 1 } }), 'warn')).toBe(0);
  });

  it('fails on any issue at the notice level', () => {
    expect(exitCodeFor(report({ summary: { entries: 1, error: 0, warn: 0, notice: 1 } }), 'notice')).toBe(1);
    expect(exitCodeFor(report(), 'notice')).toBe(0);
  });
});

describe('formatTable', () => {
  it('renders a header, the issues and a summary line', () => {
    const table = formatTable(
      report({
        summary: { entries: 42, error: 0, warn: 1, notice: 0 },
        issues: [
          {
            code: 'seo.title-too-long',
            severity: 'warn',
            uid: 'api::home-page.home-page',
            documentId: 'abc',
            locale: 'vi',
            label: 'home',
            seoField: 'seo',
            field: 'metaTitle',
            params: { length: 65, limit: 60 },
          },
        ],
      }),
      'en',
    );
    const lines = table.split('\n');

    expect(lines[0]).toBe('SEO audit (status=published, locales=vi,en, entries=42)');
    expect(lines[1]).toBe(
      '[WARN] api::home-page.home-page  abc  vi  SEO title is 65 characters, over the 60 limit (home)  (seo.title-too-long)',
    );
    expect(lines[2]).toBe('error: 0  warn: 1  notice: 0');
  });

  it('reports a clean run in the requested language', () => {
    expect(formatTable(report(), 'en')).toContain('No issues.');
    expect(formatTable(report(), 'vi')).toContain('Không có lỗi.');
  });
});
