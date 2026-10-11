import type { SepaySettings } from './config';
import { selectSepayAccount } from './config';

export type SepayPresentation = {
  qr?: string;
  bankAccount?: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  memo?: string;
  expiresAt?: string;
};

/** Replaces the single `{orderCode}` placeholder. Other text is kept as written. */
export const renderMemo = (template: string, orderCode: string): string =>
  template.replaceAll('{orderCode}', orderCode);

/**
 * SePay dynamic VietQR (`acc`, `bank`, `amount`, `des`). The remote URL is what production
 * shows; tests pass `svg` and get a self-contained image so nothing is fetched.
 */
export const sepayQrUrl = (input: {
  baseUrl: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  memo: string;
}): string => {
  const url = new URL(input.baseUrl);
  url.searchParams.set('acc', input.accountNumber);
  url.searchParams.set('bank', input.bankCode);
  url.searchParams.set('amount', String(input.amount));
  url.searchParams.set('des', input.memo);
  return url.toString();
};

const svgQr = (input: { amount: number; memo: string; accountNumber: string; bankCode: string }): string => {
  const text = `${input.bankCode} ${input.accountNumber} ${input.amount} ${input.memo}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">` +
    `<rect width="240" height="240" fill="#fff"/>` +
    `<text x="8" y="24" font-size="12">${escapeXml(text)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const escapeXml = (value: string): string =>
  value.replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });

export const buildSepayPresentation = (input: {
  settings: SepaySettings;
  locationRef: string;
  orderCode: string;
  amount: number;
  expiresAt?: string;
  /** `svg` embeds the amount and memo in an image. `remote` is the SePay QR URL. */
  qr?: 'svg' | 'remote';
}): SepayPresentation => {
  const account = selectSepayAccount(input.settings, input.locationRef);
  if (!account) return {};
  const memo = renderMemo(input.settings.memoTemplate, input.orderCode);
  const qr =
    input.qr === 'svg'
      ? svgQr({
          amount: input.amount,
          memo,
          accountNumber: account.accountNumber,
          bankCode: account.bankCode,
        })
      : sepayQrUrl({
          baseUrl: input.settings.qrBaseUrl,
          accountNumber: account.accountNumber,
          bankCode: account.bankCode,
          amount: input.amount,
          memo,
        });
  return {
    qr,
    bankAccount: {
      bankCode: account.bankCode,
      bankName: account.bankName ?? account.bankCode,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
    },
    memo,
    expiresAt: input.expiresAt,
  };
};
