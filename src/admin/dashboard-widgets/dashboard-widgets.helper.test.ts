import { describe, expect, it } from 'vitest';

import {
  buildLatestContactsUrl,
  buildLeadListUrl,
  buildLeadOverviewFilters,
  buildUpcomingReservationsUrl,
  leadStatusLabel,
  formatReservationDay,
  localDateKey,
  sumGuests,
  truncate,
} from './dashboard-widgets.helper';

const decode = (url: string) => decodeURIComponent(url);

describe('dashboard widget helpers', () => {
  it('builds a Content Manager list URL with $and filters', () => {
    const url = buildLeadListUrl('api::contact-message.contact-message', {
      filters: { leadStatus: { $eq: 'new' }, createdAt: { $gte: '2026-10-01' } },
      sort: 'createdAt:DESC',
      pageSize: 1,
    });

    expect(url.startsWith('/content-manager/collection-types/api::contact-message.contact-message?')).toBe(true);
    expect(decode(url)).toContain('filters[$and][0][leadStatus][$eq]=new');
    expect(decode(url)).toContain('filters[$and][1][createdAt][$gte]=2026-10-01');
    expect(decode(url)).toContain('pageSize=1');
  });

  it('asks for upcoming, still-open reservations in date then time order', () => {
    const url = decode(buildUpcomingReservationsUrl(new Date(2026, 9, 4, 22, 30), 6));

    expect(url).toContain('[preferredDate][$gte]=2026-10-04');
    expect(url).toContain('[leadStatus][$notIn][0]=archived');
    expect(url).toContain('[leadStatus][$notIn][1]=cancelled');
    expect(url).toContain('[leadStatus][$notIn][2]=no_show');
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

describe('closed reservations', () => {
  it('leaves cancelled, no-show and archived bookings out of today', () => {
    const filters = buildLeadOverviewFilters(new Date(2030, 5, 15, 9));
    expect(filters.today.leadStatus).toEqual({ $notIn: ['archived', 'cancelled', 'no_show'] });
  });

  it('serializes array filter values with indexes', () => {
    const url = buildLeadListUrl('api::x.x', {
      filters: { leadStatus: { $notIn: ['archived', 'cancelled'] } },
      pageSize: 1,
    });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('filters[$and][0][leadStatus][$notIn][0]')).toBe('archived');
    expect(params.get('filters[$and][0][leadStatus][$notIn][1]')).toBe('cancelled');
  });

  it('keeps contacts on the archived-only filter', () => {
    expect(decode(buildLatestContactsUrl(5))).toContain('[leadStatus][$ne]=archived');
  });

  it('labels the new statuses', () => {
    expect(leadStatusLabel.confirmed).toBe('Đã xác nhận');
    expect(leadStatusLabel.no_show).toBe('Khách không đến');
  });
});
