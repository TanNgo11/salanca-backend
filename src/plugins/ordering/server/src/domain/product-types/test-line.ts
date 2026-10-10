import type { LineConfiguration, LinePriceResult, ValidationResult } from '../../contracts';

const invalid = (message: string): ValidationResult => ({
  valid: false,
  code: 'LINE_INVALID',
  message,
});

/**
 * Shared line validation for the test product types: integer quantity at or above
 * `max(1, sellable.minQuantity)`, every selected option existing and active in its group, group
 * totals within min/max, and required groups satisfied either by selection or defaults.
 */
export function validateTestLine(input: LineConfiguration): ValidationResult {
  const { sellable, selected, quantity } = input;
  const minimum = Math.max(1, sellable.minQuantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < minimum) {
    return invalid(`quantity must be an integer >= ${minimum}`);
  }
  const groupUids = new Set(sellable.options.map((group) => group.uid));
  for (const pick of selected) {
    if (!groupUids.has(pick.groupUid)) {
      return invalid(`unknown option group "${pick.groupUid}"`);
    }
  }
  for (const group of sellable.options) {
    const picks = selected.filter((pick) => pick.groupUid === group.uid);
    if (picks.length === 0) {
      if (group.required && group.defaultOptionUids.length === 0) {
        return invalid(`option group "${group.uid}" requires a selection`);
      }
      continue;
    }
    let groupQuantity = 0;
    for (const pick of picks) {
      const option = group.options.find((candidate) => candidate.uid === pick.optionUid);
      if (!option || !option.isActive) {
        return invalid(`unknown option "${pick.optionUid}" in group "${group.uid}"`);
      }
      if (!Number.isInteger(pick.quantity) || pick.quantity <= 0) {
        return invalid(`option "${pick.optionUid}" quantity must be a positive integer`);
      }
      groupQuantity += pick.quantity;
    }
    if (groupQuantity < group.minQuantity || groupQuantity > group.maxQuantity) {
      return invalid(
        `option group "${group.uid}" quantity ${groupQuantity} outside ${group.minQuantity}..${group.maxQuantity}`,
      );
    }
  }
  return { valid: true };
}

/**
 * Shared line quote for the test product types. O1 charges every selected option quantity;
 * `freeQuantity` on groups is ignored until the pricing pipeline (Step 5) takes over quoting.
 */
export async function quoteTestLine(input: LineConfiguration): Promise<LinePriceResult> {
  const optionAmount = input.selected.reduce((total, pick) => {
    const group = input.sellable.options.find((candidate) => candidate.uid === pick.groupUid);
    const option = group?.options.find((candidate) => candidate.uid === pick.optionUid);
    return total + (option?.unitPriceDelta.amount ?? 0) * pick.quantity;
  }, 0);
  return {
    unitAmount: input.sellable.listPrice.amount,
    optionAmount,
    currency: input.sellable.listPrice.currency,
    taxGroupRef: input.sellable.taxGroupRef,
  };
}
