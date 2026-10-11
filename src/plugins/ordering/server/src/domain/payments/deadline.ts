type WindowEvent = {
  type?: string;
  occurredAt?: string | Date | null;
  payload?: { groupId?: unknown; to?: unknown } | null;
};

/**
 * When the payment clock started. Prepay is born in `awaiting-payment`, so the clock is
 * `placedAt`. Accept-then-pay enters that state later; the latest transition into it wins.
 */
export const paymentWindowStart = (input: {
  placedAt: Date;
  groupId: number;
  events: WindowEvent[];
}): Date => {
  let latest = Number.NEGATIVE_INFINITY;
  for (const event of input.events) {
    if (event.type !== 'fulfillment-group.transitioned') continue;
    if (event.payload?.to !== 'awaiting-payment') continue;
    if (Number(event.payload.groupId) !== input.groupId) continue;
    const at = new Date(event.occurredAt ?? '').getTime();
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return Number.isFinite(latest) ? new Date(latest) : input.placedAt;
};

export const paymentDeadline = (start: Date, timeoutMinutes: number): Date =>
  new Date(start.getTime() + timeoutMinutes * 60_000);

/** A staff payment link may push the window past the clock that started at placement. */
export const paymentDeadlineStoreKey = (orderId: number): string => `payment-deadline:${orderId}`;

/** Later of the computed window and a stored ISO extension. A bad stored value is ignored. */
export const laterDeadline = (computed: Date, stored: string | null | undefined): Date => {
  if (typeof stored !== 'string' || stored === '') return computed;
  const parsed = new Date(stored).getTime();
  if (!Number.isFinite(parsed) || parsed <= computed.getTime()) return computed;
  return new Date(parsed);
};
