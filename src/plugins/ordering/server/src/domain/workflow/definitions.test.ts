import { describe, expect, it } from 'vitest';

import { foodProductType } from '../product-types/food';
import { validateWorkflowDefinition } from './definition';
import { builtinWorkflows } from './definitions';

describe('built-in pickup workflows', () => {
  it('are valid graphs with public steps and an SLA on awaiting-acceptance', () => {
    for (const workflow of builtinWorkflows) {
      expect(validateWorkflowDefinition(workflow), workflow.name).toEqual([]);
      for (const state of Object.values(workflow.states)) expect(state.isPublic).toBe(true);
    }
    for (const name of ['pickup-pay-on-pickup', 'pickup-prepay', 'pickup-accept-then-pay']) {
      const workflow = builtinWorkflows.find((candidate) => candidate.name === name);
      expect(workflow?.states['awaiting-acceptance'].slaMinutes, name).toBe(10);
    }
  });

  it('lets customers cancel only before the branch starts preparing', () => {
    for (const workflow of builtinWorkflows.filter((item) => item.name.startsWith('pickup-'))) {
      expect(workflow.states.preparing.customerCancellable ?? false).toBe(false);
      expect(workflow.states.ready.customerCancellable ?? false).toBe(false);
    }
  });
});

describe('food selectWorkflow', () => {
  const select = (paymentTiming?: string) =>
    foodProductType.selectWorkflow({
      lines: [],
      receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
      paymentTiming,
    });

  it('maps every paymentTiming to its pickup workflow', () => {
    expect(select('pay-on-pickup')).toEqual({ name: 'pickup-pay-on-pickup', version: '1' });
    expect(select('prepay')).toEqual({ name: 'pickup-prepay', version: '1' });
    expect(select('accept-then-pay')).toEqual({ name: 'pickup-accept-then-pay', version: '1' });
    expect(select(undefined)).toEqual({ name: 'pickup-pay-on-pickup', version: '1' });
  });
});
