import type { Sellable } from '../contracts';
import { businessDate } from './business-date';

export type DailyEntityType = 'product' | 'variant' | 'modifier';

/** Same key the daily-stock ledger uses: type, NUL, document id. */
export const dailyStockKey = (entityType: string, entityDocumentId: string): string =>
  `${entityType}\u0000${entityDocumentId}`;

/**
 * Ordering-catalog option uids are `mod:<documentId>`. The Availability page stores the
 * modifier document id, so the ledger uses that id. A test-catalog uid such as `lon` has
 * no prefix and is stored as itself.
 */
export const modifierDocumentId = (optionUid: string): string =>
  optionUid.startsWith('mod:') ? optionUid.slice('mod:'.length) : optionUid;

export type StockTarget = {
  entityType: DailyEntityType;
  entityDocumentId: string;
  quantity: number;
  sellableUid: string;
  variantUid?: string;
  modifierUid?: string;
};

export type StockLineInput = {
  sellableUid: string;
  sourceDocumentId?: string | null;
  variantUid?: string | null;
  selected?: Array<{ optionUid?: string; quantity?: number }>;
  quantity: number;
};

/**
 * Product, variant, and each selected option of one line. An option's portion count is
 * the line quantity times the option quantity. Callers skip entities that have no limit.
 */
export const stockTargetsForLine = (line: StockLineInput): StockTarget[] => {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return [];
  const sellableUid = line.sellableUid;
  const productId = line.sourceDocumentId || sellableUid;
  const targets: StockTarget[] = [
    { entityType: 'product', entityDocumentId: productId, quantity: line.quantity, sellableUid },
  ];
  if (line.variantUid) {
    targets.push({
      entityType: 'variant',
      entityDocumentId: line.variantUid,
      quantity: line.quantity,
      sellableUid,
      variantUid: line.variantUid,
    });
  }
  for (const option of line.selected ?? []) {
    const optionUid = option.optionUid;
    if (!optionUid) continue;
    const optionQuantity = option.quantity ?? 1;
    if (!Number.isSafeInteger(optionQuantity) || optionQuantity <= 0) continue;
    targets.push({
      entityType: 'modifier',
      entityDocumentId: modifierDocumentId(optionUid),
      quantity: line.quantity * optionQuantity,
      sellableUid,
      ...(line.variantUid ? { variantUid: line.variantUid } : {}),
      modifierUid: optionUid,
    });
  }
  return targets;
};

/** Sum portions that share an entity. The first line keeps the display ids on the error. */
export const sumStockTargets = (targets: StockTarget[]): StockTarget[] => {
  const grouped = new Map<string, StockTarget>();
  for (const target of targets) {
    const key = dailyStockKey(target.entityType, target.entityDocumentId);
    const existing = grouped.get(key);
    if (existing) existing.quantity += target.quantity;
    else grouped.set(key, { ...target });
  }
  return [...grouped.values()];
};

export const soldOutDetails = (
  target: StockTarget,
  remaining: number,
  businessDateValue: string,
  locationRef: string,
) => ({
  entityType: target.entityType,
  entityDocumentId: target.entityDocumentId,
  sellableUid: target.sellableUid,
  ...(target.variantUid ? { variantUid: target.variantUid } : {}),
  ...(target.modifierUid ? { modifierUid: target.modifierUid } : {}),
  locationRef,
  remaining,
  businessDate: businessDateValue,
});

/**
 * Business date of the receive moment. A scheduled slot wins over the moment the
 * order was placed; ASAP uses `placedAt`.
 */
export const receiveBusinessDate = (input: {
  placedAt: Date;
  timezone: string;
  cutoff: string;
  slotStartsAt?: string | null;
}): string => {
  const instant = input.slotStartsAt ? new Date(input.slotStartsAt) : input.placedAt;
  return businessDate(instant, input.timezone, input.cutoff);
};

/** Product, variant, and modifier refs a public catalog payload can overlay. */
export const catalogDailyRefs = (
  sellable: Sellable,
): Array<{ entityType: DailyEntityType; entityDocumentId: string }> => {
  const refs: Array<{ entityType: DailyEntityType; entityDocumentId: string }> = [
    {
      entityType: 'product',
      entityDocumentId: sellable.ref.sourceDocumentId || sellable.ref.uid,
    },
  ];
  const catalog = sellable.metadata?.catalog;
  const variants =
    catalog && typeof catalog === 'object' && !Array.isArray(catalog)
      ? (catalog as { variants?: unknown }).variants
      : undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) continue;
      const ref = (variant as { ref?: unknown }).ref;
      if (typeof ref === 'string' && ref.length > 0) {
        refs.push({ entityType: 'variant', entityDocumentId: ref });
      }
    }
  }
  for (const group of sellable.options ?? []) {
    for (const option of group.options) {
      refs.push({ entityType: 'modifier', entityDocumentId: modifierDocumentId(option.uid) });
    }
  }
  return refs;
};
