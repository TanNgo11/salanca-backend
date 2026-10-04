import { describe, expect, it } from 'vitest';

import {
  buildLeadListUrl,
  buildUpcomingReservationsUrl,
  formatReservationDay,
  localDateKey,
  sumGuests,
  truncate,
} from './dashboard-widgets.helper';

const decode = (url: string) => decodeURIComponent(url);

describe('dashboard widget helpers', () => {
  it('builds a Content Manager list URL with $and filters', () => {
    const url = buildLeadListUrl('api::contact-message.contact-message', {
      filters: { status: { $eq: 'new' }, createdAt: { $gte: '2026-10-01' } },
      sort: 'createdAt:DESC',
      pageSize: 1,
    });

    expect(url.startsWith('/content-manager/collection-types/api::contact-message.contact-message?')).toBe(true);
    expect(decode(url)).toContain('filters[$and][0][status][$eq]=new');
    expect(decode(url)).toContain('filters[$and][1][createdAt][$gte]=2026-10-01');
    expect(decode(url)).toContain('pageSize=1');
  });

  it('asks for upcoming, non-archived reservations in date then time order', () => {
    const url = decode(buildUpcomingReservationsUrl(new Date(2026, 9, 4, 22, 30), 6));

    expect(url).toContain('[preferredDate][$gte]=2026-10-04');
    expect(url).toContain('[status][$ne]=archived');
    expect(url).toContain('sort=preferredDate:ASC,preferredTime:ASC');
  });

  it('uses the local calendar day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('labels reservation days relative to today', () => {
    const now = new Date(2026, 9, 4, 9);
    expect(formatReservationDay('2026-10-04', now)).toBe('Hôm nay');
    expect(formatReservationDay('2026-10-05', now)).toBe('Ngày mai');
    expect(formatReservationDay('2026-10-10', now)).toBe('T7 10/10');
    expect(formatReservationDay('2026-10-11', now)).toBe('CN 11/10');
  });

  it('sums guest counts and truncates long text', () => {
    expect(sumGuests([{ guestCount: 4 }, { guestCount: null }, { guestCount: 2 }])).toBe(6);
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
