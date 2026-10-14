import type { SelectedOptionInput, Sellable } from '../../contracts';
import type { WorkflowDefinition } from '../../contracts/workflow';
import type { OrderAggregate } from '../../repositories/types';
import { amountOwed } from '../payable';
import { isTerminal } from '../workflow/transition';

/**
 * Storefront serializers (contracts §11, §21.2). Allowlists only: anything not listed here never
 * leaves the API. The token view is for the customer holding the order link; the lookup view
 * (code + phone) is status-only and carries no name, phone, email, address or note.
 */
export type SelectedOptionSnapshot = SelectedOptionInput & {
  groupName?: string;
  optionName?: string;
  unitPriceDelta?: number;
};

/** Selected options with the names and price deltas at placement (line snapshot, §5). */
export function describeSelectedOptions(
  sellable: Sellable,
  selected: SelectedOptionInput[],
): SelectedOptionSnapshot[] {
  return selected.map((pick) => {
    const group = sellable.options.find((candidate) => candidate.uid === pick.groupUid);
    const option = group?.options.find((candidate) => candidate.uid === pick.optionUid);
    return {
      ...pick,
      ...(group ? { groupName: group.name } : {}),
      ...(option ? { optionName: option.name, unitPriceDelta: option.unitPriceDelta.amount } : {}),
    };
  });
}

type PublicEvent = { type: string; payload: Record<string, unknown> | null; occurredAt: string };

type Resolve = (name: string, version: string) => WorkflowDefinition;

const timingOf = (aggregate: OrderAggregate) => {
  const receive = aggregate.order.receiveMethod as {
    kind?: string;
    timing?: { mode?: string; slot?: { startsAt: string; endsAt: string }; requestedReadyAt?: string };
  };
  const group = aggregate.groups[0];
  return {
    kind: receive.kind ?? 'pickup',
    mode: receive.timing?.mode ?? null,
    slot: receive.timing?.slot ?? null,
    estimatedReadyAt: group?.estimatedReadyAt ?? receive.timing?.requestedReadyAt ?? null,
  };
};

export function paidAmounts(aggregate: OrderAggregate) {
  const captured = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
  const refunded = aggregate.payments.reduce((sum, payment) => sum + payment.refundedAmount, 0);
  return {
    captured,
    refunded,
    due: amountOwed(aggregate.order, captured),
  };
}

/** True while every live group sits on a customer-cancellable state (contracts §21.9). */
export function customerCancellableNow(aggregate: OrderAggregate, resolve: Resolve): boolean {
  const live = aggregate.groups.filter(
    (group) => isTerminal(resolve(group.workflowName, group.workflowVersion), group.status) === null,
  );
  return (
    live.length > 0 &&
    live.every(
      (group) =>
        resolve(group.workflowName, group.workflowVersion).states[group.status]?.customerCancellable ===
        true,
    )
  );
}

const steps = (aggregate: OrderAggregate, events: PublicEvent[]) => ({
  current: aggregate.groups[0]?.status ?? null,
  history: events
    .filter((event) => event.type === 'order.placed' || event.type === 'fulfillment-group.transitioned')
    .map((event) => ({
      status:
        event.type === 'order.placed'
          ? 'placed'
          : String((event.payload as { to?: string } | null)?.to ?? ''),
      at: event.occurredAt,
    })),
});

const branchOf = (aggregate: OrderAggregate) => {
  const snapshot = (aggregate.order.branchSnapshot ?? {}) as { code?: string; name?: unknown };
  return { code: snapshot.code ?? aggregate.order.locationRef, name: snapshot.name ?? null };
};

/** Customer view behind `X-Order-Token`. */
export function tokenOrderView(
  aggregate: OrderAggregate,
  events: PublicEvent[],
  resolve: Resolve,
  extra: { cancellable: boolean; branchContact?: { phone: string | null; address: unknown } },
) {
  const { order } = aggregate;
  const contact = order.contactSnapshot as { name?: string };
  const money = paidAmounts(aggregate);
  return {
    code: order.code,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    placedAt: order.placedAt,
    businessDate: order.businessDate,
    locale: order.placedLocale ?? null,
    branch: { ...branchOf(aggregate), ...(extra.branchContact ?? {}) },
    receive: timingOf(aggregate),
    contact: { name: contact.name ?? null },
    customerNote: order.customerNote ?? null,
    lines: aggregate.lines.map((line) => ({
      title: line.titleSnapshot,
      quantity: line.quantity,
      canceledQuantity: line.canceledQuantity,
      options: ((line.selectedOptionsSnapshot as SelectedOptionSnapshot[] | null) ?? []).map(
        (option) => ({ name: option.optionName ?? option.optionUid, quantity: option.quantity }),
      ),
      note: line.note ?? null,
      lineTotalAmount: line.lineTotalAmount,
    })),
    totals: {
      currency: order.currency,
      subtotal: order.subtotalAmount,
      adjustment: order.adjustmentAmount,
      fulfillment: order.fulfillmentAmount,
      tax: order.taxAmount,
      total: order.totalAmount,
      paid: money.captured,
      refunded: money.refunded,
      due: money.due,
    },
    // O9: card co-payments shown as "thẻ •••1234" — the reference carries last4 only,
    // never the code.
    giftCards: aggregate.payments
      .filter((payment) => payment.providerCode === 'gift-card')
      .map((payment) => ({
        last4: String(payment.providerReference ?? '').replace(/^gift-card:/, '') || null,
        paid: payment.capturedAmount,
        refunded: payment.refundedAmount,
      })),
    steps: steps(aggregate, events),
    canCancel: extra.cancellable && customerCancellableNow(aggregate, resolve),
  };
}

/** Status-only view for code + phone lookup (§21.2): no PII, no actions. */
export function lookupOrderView(aggregate: OrderAggregate, events: PublicEvent[]) {
  const { order } = aggregate;
  return {
    code: order.code,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    placedAt: order.placedAt,
    branch: branchOf(aggregate),
    receive: timingOf(aggregate),
    totals: { currency: order.currency, total: order.totalAmount },
    steps: steps(aggregate, events),
  };
}
