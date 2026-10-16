import { describe, expect, it } from 'vitest';

import { RBAC_KITCHEN } from './permissions';

describe('menu gates follow the server route permission', () => {
  it('kitchen: every /kitchen route needs kitchen.read, so order.process alone must not open the screen', () => {
    expect(RBAC_KITCHEN).toEqual([{ action: 'plugin::ordering.kitchen.read', subject: null }]);
  });
});
