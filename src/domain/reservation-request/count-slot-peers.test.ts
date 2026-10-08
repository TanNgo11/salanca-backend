import { describe, expect, it, vi } from 'vitest';

import { countSlotPeers } from './count-slot-peers';

describe('countSlotPeers', () => {
  it('counts open and confirmed requests on the same slot', async () => {
    const count = vi.fn(async () => 2);
    const strapi = { db: { query: vi.fn(() => ({ count })) } } as never;

    await expect(countSlotPeers(strapi, '2030-06-15', '19:00')).resolves.toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: {
        preferredDate: '2030-06-15',
        preferredTime: '19:00',
        leadStatus: { $in: ['new', 'read', 'confirmed'] },
      },
    });
  });
});
