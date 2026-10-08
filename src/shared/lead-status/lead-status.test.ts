import { describe, expect, it } from 'vitest';

import {
  CONTACT_LEAD_STATUSES,
  LEAD_STATUS_LABELS_VI,
  RESERVATION_LEAD_STATUSES,
} from './lead-status';

describe('lead statuses', () => {
  it('lists reservation statuses in workflow order', () => {
    expect(RESERVATION_LEAD_STATUSES).toEqual([
      'new',
      'read',
      'confirmed',
      'cancelled',
      'no_show',
      'archived',
    ]);
  });

  it('keeps contact messages on the original three statuses', () => {
    expect(CONTACT_LEAD_STATUSES).toEqual(['new', 'read', 'archived']);
  });

  it('labels every reservation status in Vietnamese', () => {
    expect(LEAD_STATUS_LABELS_VI).toEqual({
      new: 'Mới',
      read: 'Đã đọc',
      confirmed: 'Đã xác nhận',
      cancelled: 'Đã huỷ',
      no_show: 'Khách không đến',
      archived: 'Lưu trữ',
    });
  });
});
