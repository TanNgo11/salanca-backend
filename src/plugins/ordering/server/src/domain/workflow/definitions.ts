import type { WorkflowDefinition } from '../../contracts/workflow';

/**
 * Built-in workflow definitions. The pickup pair is production code (O3 uses it); `test-service`
 * exists for the integration fixtures. Registered unconditionally — product types select them
 * by `{ name, version }`.
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
    'awaiting-acceptance': { next: ['preparing', 'rejected', 'canceled'], isPublic: true },
    preparing: { next: ['ready', 'canceled'], isPublic: true },
    ready: { next: ['delivered', 'canceled'], isPublic: true },
    delivered: { next: [], terminal: 'success', isPublic: true },
    expired: { next: [], terminal: 'canceled', isPublic: true },
    rejected: { next: [], terminal: 'canceled', isPublic: true },
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
  testServiceWorkflow,
];
