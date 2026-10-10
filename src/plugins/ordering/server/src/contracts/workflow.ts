/**
 * Fulfillment-group workflow definition (contracts doc §7). `cancelState` names the
 * canceled-terminal state staff and customer cancels transition to; it must exist in `states`
 * with `terminal: 'canceled'`.
 */
export type WorkflowState = {
  next: string[];
  terminal?: 'success' | 'canceled';
  isPublic: boolean;
  customerCancellable?: boolean;
  slaMinutes?: number;
};

export type WorkflowDefinition = {
  name: string;
  version: string;
  initial: string;
  cancelState: string;
  states: Record<string, WorkflowState>;
};
