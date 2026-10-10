import { describe, expect, it } from 'vitest';

import { maskPayload } from './pii';

describe('maskPayload', () => {
  it('redacts sensitive keys at any depth', () => {
    expect(
      maskPayload({
        contact: { name: 'Lan', phone: '+84', email: 'a@b.c' },
        note: 'gift',
        nested: [{ password: 'x', secret: 'y', street: '1 Main', line1: '2', address: {}, token: 't', recipient: 'r' }],
      }),
    ).toEqual({
      contact: { name: '[redacted]', phone: '[redacted]', email: '[redacted]' },
      note: '[redacted]',
      nested: [
        {
          password: '[redacted]',
          secret: '[redacted]',
          street: '[redacted]',
          line1: '[redacted]',
          address: '[redacted]',
          token: '[redacted]',
          recipient: '[redacted]',
        },
      ],
    });
  });

  it('keeps allowlisted correlation keys', () => {
    expect(
      maskPayload({
        workflowName: 'pickup-prepay',
        jobName: 'outbox',
        typeName: 'x',
        eventName: 'y',
        locationRef: 'Q1',
        providerCode: 'test',
        providerReference: 'ref-1',
        providerTransactionId: 'txn-1',
        orderCode: 'SLC-000001',
        code: 'd',
        alertCode: 'a',
      }),
    ).toEqual({
      workflowName: 'pickup-prepay',
      jobName: 'outbox',
      typeName: 'x',
      eventName: 'y',
      locationRef: 'Q1',
      providerCode: 'test',
      providerReference: 'ref-1',
      providerTransactionId: 'txn-1',
      orderCode: 'SLC-000001',
      code: 'd',
      alertCode: 'a',
    });
  });

  it('passes primitives and arrays through unchanged', () => {
    expect(maskPayload([1, 'a', null, true])).toEqual([1, 'a', null, true]);
    expect(maskPayload(42)).toBe(42);
  });

  it('does not mutate the input and keeps non-sensitive keys', () => {
    const input = { amount: 100, status: 'ok', userName: 'x' };
    const masked = maskPayload(input);
    expect(masked).toEqual({ amount: 100, status: 'ok', userName: '[redacted]' });
    expect(input.userName).toBe('x');
  });
});
