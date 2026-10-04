import { describe, expect, it } from 'vitest';

import {
  buildReservationListQuery,
  initialListFilters,
  reservationStatusActions,
} from './reservation-inbox.helper';

describe('buildReservationListQuery', () => {
  it('defaults to the new queue on page 1', () => {
    expect(buildReservationListQuery(initialListFilters)).toBe('status=new&page=1');
  });

  it('omits status for "all" and trims the search', () => {
    expect(buildReservationListQuery({ status: 'all', search: '  Nguyễn  ', page: 3 })).toBe(
      'search=Nguy%E1%BB%85n&page=3',
    );
  });

  it('never sends a page below 1', () => {
    expect(buildReservationListQuery({ status: 'read', search: '', page: 0 })).toBe(
      'status=read&page=1',
    );
  });
});

describe('reservationStatusActions', () => {
  it('offers forward then side steps per status', () => {
    expect(reservationStatusActions('new').map((action) => action.target)).toEqual([
      'read',
      'archived',
    ]);
    expect(reservationStatusActions('read').map((action) => action.target)).toEqual([
      'archived',
      'new',
    ]);
    expect(reservationStatusActions('archived').map((action) => action.target)).toEqual(['read']);
  });
});
