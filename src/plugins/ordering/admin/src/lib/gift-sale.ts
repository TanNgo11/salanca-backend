/**
 * Pure helpers for the counter sale of gift cards on "Tạo đơn hộ" (screens S6). The server stays
 * the authority — it re-checks every scan (stock, denomination, reservation) at create — these only
 * keep the staff member from submitting an obviously unfinishable sale.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Scanner/keyboard input → one code per entry (one per line; spaces, commas and semicolons also split). */
export const parseScannedCodes = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '');

/** A product sold as a gift card is delivered digitally (the catalog lists `fulfillment: ['digital']`). */
export const isGiftCardProduct = (product: { fulfillment?: string[] }): boolean =>
  (product.fulfillment ?? []).includes('digital') && !(product.fulfillment ?? []).includes('pickup');

export type GiftSaleIssue = 'duplicate' | 'count-mismatch' | 'bad-email' | 'no-delivery';

/**
 * `units` is the number of cards sold (sum of line quantities). Either every card is scanned
 * (printed stock handed over) or none is and an email receives the digital cards.
 */
export const giftSaleIssue = ({
  codes,
  units,
  recipientEmail,
  contactEmail,
}: {
  codes: string[];
  units: number;
  recipientEmail: string;
  contactEmail: string;
}): GiftSaleIssue | null => {
  if (new Set(codes).size !== codes.length) return 'duplicate';
  if (codes.length > 0 && codes.length !== units) return 'count-mismatch';
  const recipient = recipientEmail.trim();
  if (recipient !== '' && !EMAIL.test(recipient)) return 'bad-email';
  if (codes.length === 0 && recipient === '' && contactEmail.trim() === '') return 'no-delivery';
  return null;
};
