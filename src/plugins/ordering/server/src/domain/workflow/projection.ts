import type { OrderFulfillmentStatus, OrderStatus } from '../../contracts/entities';

/**
 * A fulfillment group reduced to what the projections need: its current `status`, the
 * workflow's `initial` state name, and the terminal kind of the current state (from
 * `isTerminal`) or null while still moving.
 */
export type GroupProjectionInput = {
  status: string;
  initial: string;
  terminal: 'success' | 'canceled' | null;
};

/**
 * Order-level fulfillment status aggregated from its groups: empty or untouched →
 * `not-started`; fully canceled → `canceled`; fully terminal with a success → `done`; a mix of
 * finished and still-moving → `partially-done`; anything else → `in-progress`.
 */
export function projectFulfillmentStatus(groups: GroupProjectionInput[]): OrderFulfillmentStatus {
  if (groups.length === 0) return 'not-started';
  if (groups.every((group) => group.terminal === 'canceled')) return 'canceled';
  if (groups.every((group) => group.terminal !== null)) return 'done';
  if (groups.every((group) => group.status === group.initial)) return 'not-started';
  if (groups.some((group) => group.terminal === 'success')) return 'partially-done';
  return 'in-progress';
}

/**
 * Order status: unconfirmed staff drafts stay `draft`; fully canceled groups cancel the order;
 * `completed` needs every group terminal with at least one success and the gross captured
 * amount covering the total (refunds do not reopen a completed order — documented rule).
 */
export function projectOrderStatus(input: {
  originKind: 'storefront' | 'staff-draft' | 'import';
  draftConfirmed: boolean;
  groups: GroupProjectionInput[];
  totalAmount: number;
  capturedAmount: number;
}): OrderStatus {
  if (input.originKind === 'staff-draft' && !input.draftConfirmed) return 'draft';
  if (input.groups.length > 0 && input.groups.every((group) => group.terminal === 'canceled')) {
    return 'canceled';
  }
  const allTerminal =
    input.groups.length > 0 && input.groups.every((group) => group.terminal !== null);
  const anySuccess = input.groups.some((group) => group.terminal === 'success');
  if (allTerminal && anySuccess && input.capturedAmount >= input.totalAmount) return 'completed';
  return 'open';
}
