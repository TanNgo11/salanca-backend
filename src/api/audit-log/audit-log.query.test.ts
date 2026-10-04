import { describe, expect, it } from 'vitest';

import { AuditLogError } from './audit-log.error';
import {
  AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL,
  AUDIT_LOG_TARGET_LABEL_PREFIX_SQL,
  parseAuditLogExportQuery,
  parseAuditLogListQuery,
} from './audit-log.query';
import { AuditLogErrorCode } from './audit-log.types';

const validRange = {
  from: '2026-07-29T17:00:00.000Z',
  toExclusive: '2026-08-28T17:00:00.000Z',
};

describe('audit log prefix search SQL', () => {
  it('uses the same lower(column) expression as the prefix indexes', () => {
    expect(AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL).toBe(
      'lower(actor_label) LIKE ? ESCAPE ?',
    );
    expect(AUDIT_LOG_TARGET_LABEL_PREFIX_SQL).toBe(
      'lower(target_label) LIKE ? ESCAPE ?',
    );
    expect(AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL).not.toContain('coalesce');
    expect(AUDIT_LOG_TARGET_LABEL_PREFIX_SQL).not.toContain('coalesce');
  });
});

describe('parseAuditLogListQuery', () => {
  it('defaults page size to 25 and rejects values above 50', () => {
    expect(parseAuditLogListQuery({}).pageSize).toBe(25);
    expect(parseAuditLogListQuery({ pageSize: '50' }).pageSize).toBe(50);
    try {
      parseAuditLogListQuery({ pageSize: 51 });
      throw new Error('expected invalid pageSize');
    } catch (error) {
      expect(error).toBeInstanceOf(AuditLogError);
      expect((error as AuditLogError).code).toBe(AuditLogErrorCode.InvalidQuery);
    }
  });

  it('rejects search outside 2-100 characters and search without a date range', () => {
    expect(() => parseAuditLogListQuery({ search: 'a', ...validRange })).toThrow(
      AuditLogError,
    );
    expect(() => parseAuditLogListQuery({ search: 'ab' })).toThrow(AuditLogError);
    expect(parseAuditLogListQuery({ search: 'Nguyễn', ...validRange }).search).toBe(
      'Nguyễn',
    );
  });

  it('rejects a search window longer than 366 days', () => {
    expect(() =>
      parseAuditLogListQuery({
        search: 'Nguyễn',
        from: '2024-01-01T17:00:00.000Z',
        toExclusive: '2026-08-28T17:00:00.000Z',
      }),
    ).toThrow(/366/);
  });

  it('requires from < toExclusive', () => {
    expect(() =>
      parseAuditLogListQuery({
        from: '2026-08-28T17:00:00.000Z',
        toExclusive: '2026-08-28T17:00:00.000Z',
      }),
    ).toThrow(AuditLogError);
  });
});

describe('parseAuditLogExportQuery', () => {
  it('requires an explicit range of at most 31 days', () => {
    expect(() => parseAuditLogExportQuery({})).toThrow(AuditLogError);
    expect(() =>
      parseAuditLogExportQuery({
        from: '2026-07-01T17:00:00.000Z',
        toExclusive: '2026-08-28T17:00:00.000Z',
      }),
    ).toThrow(/31/);
    expect(
      parseAuditLogExportQuery({
        from: '2026-08-01T17:00:00.000Z',
        toExclusive: '2026-08-28T17:00:00.000Z',
      }).from,
    ).toBe('2026-08-01T17:00:00.000Z');
  });
});
