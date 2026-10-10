import type { JsonObject, SelectedOptionInput } from '../../contracts/common';
import type { Sellable } from '../../contracts/sellable';

/**
 * Resolves which bundle items a line contains (contracts §5 `componentsSnapshot`). The picks
 * come from the same `selected` option list the line carries — slot items live in option groups
 * whose uid is stored back into `metadata.bundleSlots[].optionGroupUid` by the adapter, so this
 * helper needs no uid-format knowledge. Unpicked slots fall back to their `isDefault` items,
 * which is exactly what a fixed combo ships.
 */
export function bundleComponentsFromSellable(
  sellable: Sellable,
  selected: SelectedOptionInput[],
): JsonObject[] | null {
  const slots = sellable.metadata?.bundleSlots;
  if (!Array.isArray(slots) || slots.length === 0) return null;
  const components: JsonObject[] = [];
  for (const slot of slots as JsonObject[]) {
    const items = Array.isArray(slot.items) ? (slot.items as JsonObject[]) : [];
    const picks = selected.filter((pick) => pick.groupUid === slot.optionGroupUid);
    const chosen = picks.length
      ? items.filter((item) => picks.some((pick) => pick.optionUid === item.optionUid))
      : items.filter((item) => item.isDefault === true);
    for (const item of chosen) {
      if (typeof item.variantRef !== 'string' || typeof item.productRef !== 'string') continue;
      const pickQuantity = picks.find((pick) => pick.optionUid === item.optionUid)?.quantity ?? 1;
      components.push({
        sellableRef: { uid: item.productRef, sourceDocumentId: item.productRef },
        variantUid: item.variantRef,
        requiredQuantity: (typeof item.quantity === 'number' ? item.quantity : 1) * pickQuantity,
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        ...(typeof item.sku === 'string' ? { sku: item.sku } : {}),
        slotKey: slot.key,
      });
    }
  }
  return components;
}
