import type { WorkflowDefinition } from '../../contracts/workflow';

/**
 * Built-in workflow definitions (contracts §19.6). The three pickup workflows are production code:
 * `pay-on-pickup` runs end to end in O3; `prepay` and `accept-then-pay` stop at
 * `awaiting-payment` until an online provider exists (O4). The three `delivery-*` workflows (O5)
 * share the same payment heads and end in the self-delivery leg of contracts §19.8:
 * `ready` → `out-for-delivery` → `delivered` | `failed`, and `failed` retries through `ready`
 * (which clears the assignee) or cancels. `test-service` exists for the integration fixtures.
 * Registered unconditionally — product types select them by `{ name, version }`. A branch's
 * `slaMinutes` setting overrides the state default for alerts.
 */
export const pickupPayOnPickupWorkflow: WorkflowDefinition = {
  name: 'pickup-pay-on-pickup',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['delivered', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const pickupPrepayWorkflow: WorkflowDefinition = {
  name: 'pickup-prepay',
  version: '1',
  initial: 'awaiting-payment',
  cancelState: 'canceled',
  states: {
    'awaiting-payment': {
      next: ['awaiting-acceptance', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['delivered', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

/** Branch accepts first, then the customer pays from the QR/link (O4) before cooking starts. */
export const pickupAcceptThenPayWorkflow: WorkflowDefinition = {
  name: 'pickup-accept-then-pay',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['awaiting-payment', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    'awaiting-payment': {
      next: ['preparing', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['delivered', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

/**
 * O5 delivery legs (contracts §19.8): the same three payment timings as pickup, with the pickup
 * `ready → delivered` edge replaced by `ready → out-for-delivery → delivered | failed`.
 */
export const deliveryPayOnDeliveryWorkflow: WorkflowDefinition = {
  name: 'delivery-pay-on-delivery',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['out-for-delivery', 'canceled'], isPublic: true },
    'out-for-delivery': { next: ['delivered', 'failed', 'canceled'], isPublic: true },
    failed: { next: ['ready', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const deliveryPrepayWorkflow: WorkflowDefinition = {
  name: 'delivery-prepay',
  version: '1',
  initial: 'awaiting-payment',
  cancelState: 'canceled',
  states: {
    'awaiting-payment': {
      next: ['awaiting-acceptance', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['out-for-delivery', 'canceled'], isPublic: true },
    'out-for-delivery': { next: ['delivered', 'failed', 'canceled'], isPublic: true },
    failed: { next: ['ready', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const deliveryAcceptThenPayWorkflow: WorkflowDefinition = {
  name: 'delivery-accept-then-pay',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['awaiting-payment', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    'awaiting-payment': {
      next: ['preparing', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['out-for-delivery', 'canceled'], isPublic: true },
    'out-for-delivery': { next: ['delivered', 'failed', 'canceled'], isPublic: true },
    failed: { next: ['ready', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

/**
 * O12 dine-in (at-table) workflows (plan step 7). The tail differs from pickup: the kitchen's
 * `ready` becomes `served` when dishes hit the table (staff transition), and `served` waits —
 * success-pending — until the table session closes, which pays the balance and moves the group
 * to `completed`. `pay-later` covers "Thu tiền khi đóng bàn"; `prepay` and `accept-then-pay`
 * mirror the pickup payment heads for branches that collect before cooking.
 */
export const dineInPayLaterWorkflow: WorkflowDefinition = {
  name: 'dine-in-pay-later',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['served', 'canceled'], isPublic: true },
    served: { next: ['completed', 'canceled'], isPublic: true },
    completed: { next: [], terminal: 'success', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const dineInPrepayWorkflow: WorkflowDefinition = {
  name: 'dine-in-prepay',
  version: '1',
  initial: 'awaiting-payment',
  cancelState: 'canceled',
  states: {
    'awaiting-payment': {
      next: ['awaiting-acceptance', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    'awaiting-acceptance': {
      next: ['preparing', 'rejected', 'canceled'],
      isPublic: true,
      slaMinutes: 10,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['served', 'canceled'], isPublic: true },
    served: { next: ['completed', 'canceled'], isPublic: true },
    completed: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const dineInAcceptThenPayWorkflow: WorkflowDefinition = {
  name: 'dine-in-accept-then-pay',
  version: '1',
  initial: 'awaiting-acceptance',
  cancelState: 'canceled',
  states: {
    'awaiting-acceptance': {
      next: ['awaiting-payment', 'rejected', 'canceled'],
      isPublic: true,
      customerCancellable: true,
      slaMinutes: 10,
    },
    'awaiting-payment': {
      next: ['preparing', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['served', 'canceled'], isPublic: true },
    served: { next: ['completed', 'canceled'], isPublic: true },
    completed: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

/**
 * O9 gift-card sale (plan step 3): a digital order pays first, then the outbox consumer issues
 * one card per line unit. `awaiting-payment` ends at `issued` on capture — the only success
 * terminal — and the payment-expiry job (or a staff cancel) lands on `expired`/`canceled`.
 */
export const giftCardWorkflow: WorkflowDefinition = {
  name: 'gift-card',
  version: '1',
  initial: 'awaiting-payment',
  cancelState: 'canceled',
  states: {
    'awaiting-payment': {
      next: ['issued', 'expired', 'canceled'],
      isPublic: true,
      customerCancellable: true,
    },
    issued: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const testServiceWorkflow: WorkflowDefinition = {
  name: 'test-service',
  version: '1',
  initial: 'scheduled',
  cancelState: 'canceled',
  states: {
    scheduled: { next: ['in-service', 'canceled'], isPublic: true },
    'in-service': { next: ['done', 'canceled'], isPublic: true },
    done: { next: [], terminal: 'success', isPublic: true },
    canceled: { next: [], terminal: 'canceled', isPublic: true },
  },
};

export const builtinWorkflows: WorkflowDefinition[] = [
  pickupPayOnPickupWorkflow,
  pickupPrepayWorkflow,
  pickupAcceptThenPayWorkflow,
  deliveryPayOnDeliveryWorkflow,
  deliveryPrepayWorkflow,
  deliveryAcceptThenPayWorkflow,
  dineInPayLaterWorkflow,
  dineInPrepayWorkflow,
  dineInAcceptThenPayWorkflow,
  giftCardWorkflow,
  testServiceWorkflow,
];
