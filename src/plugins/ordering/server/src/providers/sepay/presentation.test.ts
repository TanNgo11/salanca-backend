import { describe, expect, it } from 'vitest';

import { parseSepaySettings } from './config';
import { buildSepayPresentation, renderMemo, sepayQrUrl } from './presentation';

const settings = parseSepaySettings({
  enabled: true,
  webhookSecret: 'test-webhook-secret-value',
  apiToken: 'test-api-token-value-xx',
  memoTemplate: 'SLC{orderCode}',
  accounts: {
    q1: {
      accountNumber: '0123456789',
      bankCode: 'MBBank',
      bankName: 'MB Bank',
      accountName: 'CONG TY SALANCA',
      locationRefs: ['Q1'],
    },
  },
})!;

describe('SePay presentation', () => {
  it('renders the memo and a VietQR URL with amount and description', () => {
    expect(renderMemo('SLC{orderCode}', 'SLC-000124')).toBe('SLCSLC-000124');
    const url = sepayQrUrl({
      baseUrl: 'https://qr.sepay.vn/img',
      accountNumber: '0123456789',
      bankCode: 'MBBank',
      amount: 175000,
      memo: 'SLC-000124',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://qr.sepay.vn/img');
    expect(parsed.searchParams.get('acc')).toBe('0123456789');
    expect(parsed.searchParams.get('bank')).toBe('MBBank');
    expect(parsed.searchParams.get('amount')).toBe('175000');
    expect(parsed.searchParams.get('des')).toBe('SLC-000124');
  });

  it('embeds the amount and memo in an SVG QR that does not call the network', () => {
    const presentation = buildSepayPresentation({
      settings,
      locationRef: 'Q1',
      orderCode: 'SLC-000124',
      amount: 175000,
      expiresAt: '2026-10-11T12:00:00.000Z',
      qr: 'svg',
    });
    expect(presentation.memo).toBe('SLCSLC-000124');
    expect(presentation.bankAccount).toEqual({
      bankCode: 'MBBank',
      bankName: 'MB Bank',
      accountNumber: '0123456789',
      accountName: 'CONG TY SALANCA',
    });
    expect(presentation.expiresAt).toBe('2026-10-11T12:00:00.000Z');
    expect(presentation.qr?.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(presentation.qr!.slice('data:image/svg+xml,'.length));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('175000');
    expect(svg).toContain('SLCSLC-000124');
    expect(svg).toContain('0123456789');
  });

  it('returns an empty presentation when the branch has no account', () => {
    const onlyQ1 = parseSepaySettings({
      enabled: true,
      webhookSecret: 'test-webhook-secret-value',
      apiToken: 'test-api-token-value-xx',
      accounts: {
        q1: {
          accountNumber: '0123456789',
          bankCode: 'MBBank',
          accountName: 'CONG TY SALANCA',
          locationRefs: ['Q1'],
        },
      },
    })!;
    expect(buildSepayPresentation({ settings: onlyQ1, locationRef: 'Q3', orderCode: 'SLC-1', amount: 1 })).toEqual({});
  });
});
