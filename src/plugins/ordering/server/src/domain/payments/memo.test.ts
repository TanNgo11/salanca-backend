import { describe, expect, it } from 'vitest';

import { extractOrderCode } from './memo';

describe('extractOrderCode', () => {
  const template = 'SLC{orderCode}';

  it('reads the code the QR memo was built from', () => {
    expect(extractOrderCode(template, 'SLCSLC-000124')).toBe('SLC-000124');
  });

  it('ignores words around the memo', () => {
    expect(extractOrderCode(template, 'CK SLCSLC-000124 cam on')).toBe('SLC-000124');
  });

  it('keeps a suffix that the template requires', () => {
    expect(extractOrderCode('CK {orderCode} END', 'CK SLC-000124 END')).toBe('SLC-000124');
  });

  it('returns null when the template or the text has no code', () => {
    expect(extractOrderCode('no token', 'SLCSLC-000124')).toBeNull();
    expect(extractOrderCode(template, 'chuyen tien')).toBeNull();
    expect(extractOrderCode(template, '')).toBeNull();
    expect(extractOrderCode(template, null)).toBeNull();
  });

  it('does not treat a bare order code as the prefixed memo', () => {
    expect(extractOrderCode(template, 'SLC-000124')).toBeNull();
  });
});
