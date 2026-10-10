import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import { pickupPayOnPickupWorkflow } from './definitions';
import { assertTransition, canTransition, isPublicState, isTerminal } from './transition';

const def = pickupPayOnPickupWorkflow;

describe('canTransition / assertTransition', () => {
  it('allows declared edges only', () => {
    expect(canTransition(def, 'awaiting-acceptance', 'preparing')).toBe(true);
    expect(canTransition(def, 'awaiting-acceptance', 'delivered')).toBe(false);
    expect(canTransition(def, 'delivered', 'canceled')).toBe(false);
    expect(canTransition(def, 'ghost', 'preparing')).toBe(false);
  });

  it('assertTransition throws INVALID_TRANSITION with workflow and states', () => {
    expect(() => assertTransition(def, 'awaiting-acceptance', 'preparing')).not.toThrow();
    try {
      assertTransition(def, 'ready', 'awaiting-acceptance');
      expect.unreachable();
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
      const ordering = error as { code: string; status: number; details?: Record<string, unknown> };
      expect(ordering.code).toBe('INVALID_TRANSITION');
      expect(ordering.status).toBe(409);
      expect(ordering.details).toEqual({
        workflow: 'pickup-pay-on-pickup@1',
        from: 'ready',
        to: 'awaiting-acceptance',
      });
    }
  });
});

describe('isTerminal / isPublicState', () => {
  it('reports terminal kinds and null for moving or unknown states', () => {
    expect(isTerminal(def, 'delivered')).toBe('success');
    expect(isTerminal(def, 'canceled')).toBe('canceled');
    expect(isTerminal(def, 'preparing')).toBeNull();
    expect(isTerminal(def, 'ghost')).toBeNull();
  });

  it('reports public visibility', () => {
    expect(isPublicState(def, 'preparing')).toBe(true);
    expect(isPublicState(def, 'ghost')).toBe(false);
  });
});
