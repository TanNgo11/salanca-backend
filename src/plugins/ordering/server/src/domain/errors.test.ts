import { describe, expect, it } from 'vitest';

import { OrderingError, isOrderingError } from './errors';

describe('OrderingError', () => {
  it('derives the default status from the code table', () => {
    expect(new OrderingError('ORDER_NOT_FOUND', 'missing').status).toBe(404);
    expect(new OrderingError('HOLD_NOT_FOUND', 'missing').status).toBe(404);
    expect(new OrderingError('VALIDATION_ERROR', 'bad input').status).toBe(400);
    expect(new OrderingError('CONSENT_REQUIRED', 'no consent').status).toBe(400);
    expect(new OrderingError('SCOPE_REQUIRED', 'no scope').status).toBe(403);
    expect(new OrderingError('PRICE_CHANGED', 'stale quote').status).toBe(409);
    expect(new OrderingError('INVALID_TRANSITION', 'bad step').status).toBe(409);
    expect(new OrderingError('IDEMPOTENCY_IN_PROGRESS', 'retry later').status).toBe(409);
    expect(new OrderingError('TOTALS_MISMATCH', 'broken math').status).toBe(500);
    expect(new OrderingError('WORKFLOW_INVALID', 'bad graph').status).toBe(500);
    expect(new OrderingError('INTERNAL', 'boom').status).toBe(500);
    expect(new OrderingError('INTERNAL', 'boom', { status: 502 }).status).toBe(502);
  });

  it('serializes to the API error shape with the request id', () => {
    const error = new OrderingError('LINE_INVALID', 'bad line', {
      details: { lineId: 'l1' },
    });
    expect(error.name).toBe('OrderingError');
    expect(error.toApiError('req-1')).toEqual({
      code: 'LINE_INVALID',
      message: 'bad line',
      details: { lineId: 'l1' },
      requestId: 'req-1',
    });
    expect(new OrderingError('ORDER_NOT_FOUND', 'missing').toApiError('req-2')).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'missing',
      requestId: 'req-2',
    });
  });

  it('is detected by isOrderingError and keeps its cause', () => {
    const cause = new Error('db gone');
    const error = new OrderingError('INTERNAL', 'wrapped', { cause });
    expect(isOrderingError(error)).toBe(true);
    expect(error.cause).toBe(cause);
    expect(isOrderingError(new Error('plain'))).toBe(false);
    expect(isOrderingError({ code: 'ORDER_NOT_FOUND' })).toBe(false);
    expect(isOrderingError(null)).toBe(false);
  });
});
