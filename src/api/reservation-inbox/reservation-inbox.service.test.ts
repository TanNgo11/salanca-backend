import { describe, expect, it, vi } from 'vitest';

import { createReservationInboxService } from './reservation-inbox.service';
import { ReservationInboxErrorCode } from './reservation-inbox.types';

const buildStrapi = (documentsImpl: Record<string, unknown>) =>
  ({
    documents: vi.fn(() => documentsImpl),
  }) as never;

describe('createReservationInboxService.summary', () => {
  it('queries status=new newest-first with the fixed limit and counts the full backlog', async () => {
    const findMany = vi.fn(async () => [
      {
        documentId: 'doc1',
        fullName: 'Nguyen Van A',
        phone: '0901',
        guestCount: 4,
        preferredDate: '2030-06-15',
        preferredTime: '19:00',
        overlapCount: 1,
        createdAt: '2030-06-10T12:00:00.000Z',
      },
    ]);
    const count = vi.fn(async () => 7);
    const strapi = buildStrapi({ findMany, count });
    const service = createReservationInboxService(strapi);

    const result = await service.summary({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { status: 'new' },
        sort: 'createdAt:desc',
        limit: 20,
      }),
    );
    expect(findMany.mock.calls[0][0].fields).toEqual(
      expect.arrayContaining(['documentId', 'fullName', 'createdAt']),
    );
    expect(findMany.mock.calls[0][0].fields).not.toContain('note');
    expect(findMany.mock.calls[0][0].fields).not.toContain('email');
    expect(count).toHaveBeenCalledWith({ filters: { status: 'new' } });
    expect(result.unreadCount).toBe(7);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      documentId: 'doc1',
      fullName: 'Nguyen Van A',
      phone: '0901',
      guestCount: 4,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      overlapCount: 1,
      createdAt: '2030-06-10T12:00:00.000Z',
    });
  });

  it('adds a createdAt > since filter without narrowing unreadCount', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 3);
    const strapi = buildStrapi({ findMany, count });
    const service = createReservationInboxService(strapi);

    const result = await service.summary({ since: '2030-06-01T00:00:00.000Z' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { status: 'new', createdAt: { $gt: '2030-06-01T00:00:00.000Z' } },
      }),
    );
    expect(count).toHaveBeenCalledWith({ filters: { status: 'new' } });
    expect(result.unreadCount).toBe(3);
  });
});

describe('createReservationInboxService.markRead', () => {
  it('throws NotFound when the document does not exist', async () => {
    const findOne = vi.fn(async () => null);
    const update = vi.fn();
    const strapi = buildStrapi({ findOne, update });
    const service = createReservationInboxService(strapi);

    await expect(service.markRead('abc123def456')).rejects.toMatchObject({
      name: 'ReservationInboxError',
      code: ReservationInboxErrorCode.NotFound,
      vietnameseMessage: 'Không tìm thấy yêu cầu đặt bàn này.',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates status to read and returns the documentId and status', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456', status: 'new' }));
    const update = vi.fn(async () => ({ documentId: 'abc123def456', status: 'read' }));
    const strapi = buildStrapi({ findOne, update });
    const service = createReservationInboxService(strapi);

    const result = await service.markRead('abc123def456');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'abc123def456',
        data: { status: 'read' },
      }),
    );
    expect(result).toEqual({ documentId: 'abc123def456', status: 'read' });
  });
});
