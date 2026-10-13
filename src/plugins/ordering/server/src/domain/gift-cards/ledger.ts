/**
 * Gift-card ledger vocabulary (O9 plan step 1). The ledger is append-only: every balance
 * change is a row with a signed `amount` and the resulting `balanceAfter`; a card's balance
 * is always Σ amount of its ledger rows (`sumLedgerAmounts`), asserted by scripts.
 */
export const GIFT_CARD_STATUSES = ['inactive', 'active', 'blocked', 'expired'] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

export const GIFT_CARD_SOURCES = ['sale', 'manual', 'batch'] as const;
export type GiftCardSource = (typeof GIFT_CARD_SOURCES)[number];

export const GIFT_CARD_LEDGER_KINDS = [
  'issue',
  'redeem',
  'refund',
  'adjust',
  'expire',
  'block',
  'unblock',
  'extend',
  'activate',
] as const;
export type GiftCardLedgerKind = (typeof GIFT_CARD_LEDGER_KINDS)[number];

/** Kinds that do not move money (amount must be 0). */
export const NON_MONEY_KINDS = new Set<GiftCardLedgerKind>(['block', 'unblock', 'extend']);

/** balance = Σ amount over the append-only ledger (the invariant scripts re-check). */
export function sumLedgerAmounts(entries: Array<{ amount: number | string }>): number {
  return entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
}
