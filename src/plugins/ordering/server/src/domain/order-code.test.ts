import { describe, expect, it } from 'vitest';

import { isOrderingError } from './errors';
import { formatOrderCode } from './order-code';

describe('formatOrderCode', () => {
  it('renders the default template', () => {
    expect(formatOrderCode('{prefix}-{seq:6}', { prefix: 'SLC', seq: 123 })).toBe('SLC-000123');
    expect(formatOrderCode('{prefix}-{seq}', { prefix: 'ORD', seq: 42 })).toBe('ORD-42');
  });

  it('does not truncate a sequence wider than the pad', () => {
    expect(formatOrderCode('{prefix}-{seq:6}', { prefix: 'SLC', seq: 1234567 })).toBe(
      'SLC-1234567',
    );
  });

  it('renders date tokens in the given timezone', () => {
    // 2026-10-10 08:30 in Asia/Ho_Chi_Minh.
    const at = new Date('2026-10-10T01:30:00Z');
    expect(
      formatOrderCode('{yyyy}{mm}{dd}-{prefix}-{seq:4}', { prefix: 'SLC', seq: 7, at }),
    ).toBe('20261010-SLC-0007');
    expect(
      formatOrderCode('{yy}/{mm}/{dd} {seq}', { prefix: 'X', seq: 9, at }),
    ).toBe('26/10/10 9');
    // Same instant, different timezone → different local date.
    expect(formatOrderCode('{yyyy}-{mm}-{dd}', { prefix: 'X', seq: 1, at, timezone: 'UTC' })).toBe(
      '2026-10-10',
    );
  });

  it('rejects unknown tokens', () => {
    try {
      formatOrderCode('{prefix}-{bogus}', { prefix: 'SLC', seq: 1 });
      expect.unreachable();
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('VALIDATION_ERROR');
      expect((error as Error).message).toContain('bogus');
    }
  });

  it('rejects a bad sequence', () => {
    expect(() => formatOrderCode('{seq}', { prefix: 'X', seq: -1 })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => formatOrderCode('{seq}', { prefix: 'X', seq: 1.5 })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
