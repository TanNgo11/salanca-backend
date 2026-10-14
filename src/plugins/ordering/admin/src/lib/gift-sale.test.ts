import { describe, expect, it } from 'vitest';

import { giftSaleIssue, isGiftCardProduct, parseScannedCodes } from './gift-sale';

describe('parseScannedCodes', () => {
  it('splits on lines, spaces and commas, trims and upper-cases', () => {
    expect(parseScannedCodes('abcd-1111-2222-3333\n  efgh-4444-5555-6666 ,\n\nijkl-7777-8888-9999;')).toEqual([
      'ABCD-1111-2222-3333',
      'EFGH-4444-5555-6666',
      'IJKL-7777-8888-9999',
    ]);
    expect(parseScannedCodes('  \n ')).toEqual([]);
  });
});

describe('isGiftCardProduct', () => {
  it('is true only for digital-only products', () => {
    expect(isGiftCardProduct({ fulfillment: ['digital'] })).toBe(true);
    expect(isGiftCardProduct({ fulfillment: ['pickup', 'delivery'] })).toBe(false);
    expect(isGiftCardProduct({})).toBe(false);
  });
});

describe('giftSaleIssue', () => {
  const base = { codes: [], units: 2, recipientEmail: '', contactEmail: '' };
  it('needs a scan per card or a mailbox', () => {
    expect(giftSaleIssue(base)).toBe('no-delivery');
    expect(giftSaleIssue({ ...base, recipientEmail: 'lan@example.com' })).toBeNull();
    expect(giftSaleIssue({ ...base, contactEmail: 'mua@example.com' })).toBeNull();
    expect(giftSaleIssue({ ...base, codes: ['A', 'B'] })).toBeNull();
  });
  it('flags a scan count that differs from the cards sold and repeated scans', () => {
    expect(giftSaleIssue({ ...base, codes: ['A'] })).toBe('count-mismatch');
    expect(giftSaleIssue({ ...base, codes: ['A', 'A'] })).toBe('duplicate');
  });
  it('flags a malformed recipient email', () => {
    expect(giftSaleIssue({ ...base, recipientEmail: 'lan@', codes: ['A', 'B'] })).toBe('bad-email');
  });
});
