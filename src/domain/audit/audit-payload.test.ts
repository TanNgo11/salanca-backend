import { describe, expect, it } from 'vitest';

import {
  AuditPayloadRejectedError,
  maskAuditIdentifier,
  normalizeAuditPayload,
  readContentManagerChangedFields,
} from './audit-payload';

describe('normalizeAuditPayload', () => {
  it('sorts keys, bounds strings, and drops secret fields', () => {
    expect(
      normalizeAuditPayload({
        token: 'secret',
        label: 'Nhà đất',
        password: 'hunter2',
        nested: { phone: '0900000000', locale: 'vi' },
      }),
    ).toEqual({
      label: 'Nhà đất',
      nested: { locale: 'vi' },
    });
  });

  it('rejects recursive and oversized values', () => {
    expect(() =>
      normalizeAuditPayload({ a: { b: { c: { d: { e: 1 } } } } }),
    ).toThrow(AuditPayloadRejectedError);
    expect(() => normalizeAuditPayload({ values: new Array(21).fill(1) })).toThrow(
      AuditPayloadRejectedError,
    );
  });

  it('rejects functions, dates, and other unsupported shapes', () => {
    expect(() => normalizeAuditPayload({ when: new Date() })).toThrow(
      AuditPayloadRejectedError,
    );
  });
});

describe('readContentManagerChangedFields', () => {
  it('returns sorted top-level data keys from the reviewed request shape', () => {
    expect(
      readContentManagerChangedFields({
        data: {
          title: 'Tin mới',
          locale: 'vi',
          documentId: 'abc',
          summary: 'Mô tả',
        },
      }),
    ).toEqual(['summary', 'title']);
  });

  it('returns an empty summary when the request shape is not reviewed', () => {
    expect(readContentManagerChangedFields('not-an-object')).toEqual([]);
    expect(readContentManagerChangedFields(undefined)).toEqual([]);
  });
});

describe('maskAuditIdentifier', () => {
  it('masks email local-parts and trailing identifier digits', () => {
    expect(maskAuditIdentifier('nguyen.an@example.com')).toBe('n***@example.com');
    expect(maskAuditIdentifier('0901234567')).toBe('***67');
  });
});
