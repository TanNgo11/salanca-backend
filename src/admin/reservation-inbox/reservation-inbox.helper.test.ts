import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';
import {
  RESERVATION_ROW_ACTION_LIMIT,
  adminHref,
  contentManagerEditPath,
  formatInboxToastMessage,
  formatInboxVisitDateTime,
  inboxReducer,
  initialInboxState,
  mergeNewItems,
  nextBackoffMs,
  parseSseChunk,
  reservationStatusActions,
  reservationStatusTone,
} from './reservation-inbox.helper';

const buildItem = (overrides: Partial<ReservationInboxItem> = {}): ReservationInboxItem => ({
  documentId: 'doc123456789',
  fullName: 'Nguyen Van A',
  phone: '0901',
  guestCount: 4,
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  overlapCount: 0,
  createdAt: '2030-06-10T12:00:00.000Z',
  ...overrides,
});

describe('parseSseChunk', () => {
  it('parses a complete event and keeps the trailing partial frame in rest', () => {
    const parsed = parseSseChunk(
      'event: reservation.created\ndata: {"a":1}\n\ndata: partial',
    );

    expect(parsed.events).toEqual([{ name: 'reservation.created', data: '{"a":1}' }]);
    expect(parsed.rest).toBe('data: partial');
  });

  it('ignores comment lines and segments without data', () => {
    const parsed = parseSseChunk(': connected\n\n: ping\n\n');

    expect(parsed.events).toEqual([]);
    expect(parsed.rest).toBe('');
  });

  it('joins multi-line data payloads with a newline', () => {
    const parsed = parseSseChunk('data: line1\ndata: line2\n\n');

    expect(parsed.events).toEqual([{ name: 'message', data: 'line1\nline2' }]);
  });

  it('defaults the event name to message when no event line exists', () => {
    const parsed = parseSseChunk('data: {"b":2}\n\n');

    expect(parsed.events).toEqual([{ name: 'message', data: '{"b":2}' }]);
  });
});

describe('nextBackoffMs', () => {
  it('doubles from one second and caps at thirty seconds', () => {
    expect(nextBackoffMs(0)).toBe(1_000);
    expect(nextBackoffMs(1)).toBe(2_000);
    expect(nextBackoffMs(2)).toBe(4_000);
    expect(nextBackoffMs(3)).toBe(8_000);
    expect(nextBackoffMs(4)).toBe(16_000);
    expect(nextBackoffMs(5)).toBe(30_000);
    expect(nextBackoffMs(10)).toBe(30_000);
  });
});

describe('mergeNewItems', () => {
  it('prepends newer items and advances lastSeenAt', () => {
    const existing = [buildItem({ createdAt: '2030-06-10T10:00:00.000Z' })];
    const incoming = [buildItem({ documentId: 'doc000000002', createdAt: '2030-06-10T11:00:00.000Z' })];

    const merged = mergeNewItems(existing, incoming, '2030-06-10T10:00:00.000Z');

    expect(merged.items.map((item) => item.documentId)).toEqual([
      'doc000000002',
      'doc123456789',
    ]);
    expect(merged.added).toHaveLength(1);
    expect(merged.lastSeenAt).toBe('2030-06-10T11:00:00.000Z');
  });

  it('deduplicates by documentId against existing and repeated incoming entries', () => {
    const item = buildItem();
    const merged = mergeNewItems([item], [item, item], null);

    expect(merged.items).toHaveLength(1);
    expect(merged.added).toHaveLength(0);
  });

  it('rejects items at or before lastSeenAt', () => {
    const merged = mergeNewItems(
      [],
      [
        buildItem({ documentId: 'doc000000001', createdAt: '2030-06-10T10:00:00.000Z' }),
        buildItem({ documentId: 'doc000000002', createdAt: '2030-06-10T10:00:00.001Z' }),
      ],
      '2030-06-10T10:00:00.000Z',
    );

    expect(merged.added.map((item) => item.documentId)).toEqual(['doc000000002']);
    expect(merged.lastSeenAt).toBe('2030-06-10T10:00:00.001Z');
  });

  it('keeps lastSeenAt when nothing new arrives', () => {
    const merged = mergeNewItems([], [], '2030-06-10T10:00:00.000Z');

    expect(merged.items).toEqual([]);
    expect(merged.lastSeenAt).toBe('2030-06-10T10:00:00.000Z');
  });
});

describe('formatInboxToastMessage', () => {
  it('formats the Vietnamese toast with dd/MM date', () => {
    expect(formatInboxToastMessage(buildItem())).toBe(
      'Đặt bàn mới: Nguyen Van A · 4 khách · 19:00 15/06',
    );
  });
});

describe('formatInboxVisitDateTime', () => {
  it('formats the visit column as dd/MM/yyyy time', () => {
    expect(formatInboxVisitDateTime(buildItem())).toBe('15/06/2030 19:00');
  });
});

describe('contentManagerEditPath', () => {
  it('builds the Content Manager edit path', () => {
    expect(contentManagerEditPath('doc123456789')).toBe(
      '/content-manager/collection-types/api::reservation-request.reservation-request/doc123456789',
    );
  });
});

describe('adminHref', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['https://quanly.example.com/admin', '/admin/content-manager'],
    ['/admin/', '/admin/content-manager'],
    ['', '/content-manager'],
  ])('prefixes the admin base path from ADMIN_PATH %j', (adminPath, expected) => {
    vi.stubEnv('ADMIN_PATH', adminPath);
    vi.stubGlobal('window', { location: { origin: 'https://quanly.example.com' } });
    expect(adminHref('/content-manager')).toBe(expected);
  });
});

describe('inboxReducer', () => {
  const first = buildItem({ createdAt: '2030-06-10T10:00:00.000Z' });
  const second = buildItem({
    documentId: 'doc000000002',
    createdAt: '2030-06-10T11:00:00.000Z',
  });

  it('refreshed replaces items and unread count and sets lastSeenAt to the newest item', () => {
    const state = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [second, first],
      unreadCount: 2,
    });

    expect(state.items).toEqual([second, first]);
    expect(state.unreadCount).toBe(2);
    expect(state.lastSeenAt).toBe('2030-06-10T11:00:00.000Z');
  });

  it('refreshed keeps lastSeenAt when the refreshed list is empty', () => {
    const seeded = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [first],
      unreadCount: 1,
    });
    const state = inboxReducer(seeded, { type: 'refreshed', items: [], unreadCount: 0 });

    expect(state.lastSeenAt).toBe('2030-06-10T10:00:00.000Z');
  });

  it('itemsArrived merges new items and bumps the unread count when no count is given', () => {
    const seeded = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [first],
      unreadCount: 1,
    });
    const state = inboxReducer(seeded, { type: 'itemsArrived', items: [second, first] });

    expect(state.items.map((item) => item.documentId)).toEqual([
      'doc000000002',
      'doc123456789',
    ]);
    expect(state.unreadCount).toBe(2);
    expect(state.lastSeenAt).toBe('2030-06-10T11:00:00.000Z');
  });

  it('itemsArrived trusts a provided unreadCount and ignores stale items', () => {
    const seeded = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [first],
      unreadCount: 1,
    });
    const state = inboxReducer(seeded, {
      type: 'itemsArrived',
      items: [second, first],
      unreadCount: 9,
    });

    expect(state.unreadCount).toBe(9);
  });

  it('itemsArrived returns the same state when nothing changed', () => {
    const seeded = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [first],
      unreadCount: 1,
    });
    const state = inboxReducer(seeded, {
      type: 'itemsArrived',
      items: [first],
      unreadCount: 1,
    });

    expect(state).toBe(seeded);
  });

  it('streamOpened and streamClosed toggle the mode', () => {
    const opened = inboxReducer(initialInboxState, { type: 'streamOpened' });
    expect(opened.mode).toBe('stream');

    const closed = inboxReducer(opened, { type: 'streamClosed' });
    expect(closed.mode).toBe('polling');
  });

  it('markedRead removes the item and decrements the count without going below zero', () => {
    const seeded = inboxReducer(initialInboxState, {
      type: 'refreshed',
      items: [first],
      unreadCount: 1,
    });
    const read = inboxReducer(seeded, { type: 'markedRead', documentId: first.documentId });

    expect(read.items).toEqual([]);
    expect(read.unreadCount).toBe(0);

    const floored = inboxReducer(read, { type: 'markedRead', documentId: 'other' });
    expect(floored.unreadCount).toBe(0);
  });
});

describe('reservation workflow actions', () => {
  const targets = (status: Parameters<typeof reservationStatusActions>[0]) =>
    reservationStatusActions(status).map((action) => action.target);

  it('offers confirm first on a new request', () => {
    expect(targets('new')).toEqual(['confirmed', 'cancelled', 'read']);
  });

  it('moves a confirmed request to no-show, cancel or archive', () => {
    expect(targets('confirmed')).toEqual(['no_show', 'cancelled', 'archived']);
  });

  it('lets staff restore closed requests', () => {
    expect(targets('cancelled')).toEqual(['archived', 'read']);
    expect(targets('no_show')).toEqual(['archived', 'confirmed']);
    expect(targets('archived')).toEqual(['read']);
  });

  it('never offers the current status', () => {
    for (const status of ['new', 'read', 'confirmed', 'cancelled', 'no_show', 'archived'] as const) {
      expect(targets(status)).not.toContain(status);
    }
  });

  it('shows two actions per table row', () => {
    expect(RESERVATION_ROW_ACTION_LIMIT).toBe(2);
  });

  it('colours statuses by outcome', () => {
    expect(reservationStatusTone('new')).toBe(InformationStatusChipTone.Info);
    expect(reservationStatusTone('confirmed')).toBe(InformationStatusChipTone.Published);
    expect(reservationStatusTone('cancelled')).toBe(InformationStatusChipTone.Warning);
    expect(reservationStatusTone('no_show')).toBe(InformationStatusChipTone.Warning);
    expect(reservationStatusTone('archived')).toBe(InformationStatusChipTone.Neutral);
  });
});
