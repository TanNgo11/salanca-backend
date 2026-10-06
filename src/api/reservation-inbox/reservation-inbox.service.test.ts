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
        filters: { $or: [{ leadStatus: 'new' }, { leadStatus: { $null: true } }] },
        sort: 'createdAt:desc',
        limit: 20,
      }),
    );
    expect(findMany.mock.calls[0][0].fields).toEqual(
      expect.arrayContaining(['documentId', 'fullName', 'createdAt']),
    );
    expect(findMany.mock.calls[0][0].fields).not.toContain('note');
    expect(findMany.mock.calls[0][0].fields).not.toContain('email');
    expect(count).toHaveBeenCalledWith({ filters: { $or: [{ leadStatus: 'new' }, { leadStatus: { $null: true } }] } });
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
        filters: {
          $or: [{ leadStatus: 'new' }, { leadStatus: { $null: true } }],
          createdAt: { $gt: '2030-06-01T00:00:00.000Z' },
        },
      }),
    );
    expect(count).toHaveBeenCalledWith({ filters: { $or: [{ leadStatus: 'new' }, { leadStatus: { $null: true } }] } });
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
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456', leadStatus: 'new' }));
    const update = vi.fn(async () => ({ documentId: 'abc123def456', leadStatus: 'read' }));
    const strapi = buildStrapi({ findOne, update });
    const service = createReservationInboxService(strapi);

    const result = await service.markRead('abc123def456');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'abc123def456',
        data: { leadStatus: 'read' },
      }),
    );
    expect(result).toEqual({ documentId: 'abc123def456', status: 'read' });
  });
});

describe('createReservationInboxService.list', () => {
  const row = {
    documentId: 'doc1',
    fullName: 'Nguyen Van A',
    phone: '0901',
    guestCount: 4,
    preferredDate: '2030-06-15',
    preferredTime: '19:00',
    overlapCount: 0,
    createdAt: '2030-06-10T12:00:00.000Z',
    leadStatus: 'archived',
  };

  it('applies status and name/phone search, paginates, and returns per-status counts', async () => {
    const findMany = vi.fn(async () => [row]);
    const count = vi.fn(async ({ filters }: { filters: Record<string, unknown> }) => {
      if (filters.$and) return 45;
      if (filters.$or) return 3;
      if (filters.leadStatus === 'read') return 10;
      return 32;
    });
    const service = createReservationInboxService(buildStrapi({ findMany, count }));

    const result = await service.list({ status: 'archived', search: 'nguyen', page: 2 });

    const expectedFilters = {
      $and: [
        { leadStatus: 'archived' },
        {
          $or: [{ fullName: { $containsi: 'nguyen' } }, { phone: { $containsi: 'nguyen' } }],
        },
      ],
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expectedFilters,
        sort: 'createdAt:desc',
        limit: 20,
        start: 20,
      }),
    );
    expect(result.items[0]).toMatchObject({ documentId: 'doc1', status: 'archived' });
    expect(result.total).toBe(45);
    expect(result.pageCount).toBe(3);
    expect(result.counts).toEqual({ new: 3, read: 10, archived: 32 });
  });

  it('lists every status when no filters are set', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const service = createReservationInboxService(buildStrapi({ findMany, count }));

    const result = await service.list({ page: 1 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ filters: {}, start: 0 }));
    expect(result.pageCount).toBe(1);
  });

  // Rows saved before the status column existed hold NULL; they are unhandled
  // requests, so the "new" tab and count must include them.
  it('treats legacy rows with a NULL status as new', async () => {
    const findMany = vi.fn(async () => [{ ...row, leadStatus: null }]);
    const count = vi.fn(async () => 1);
    const service = createReservationInboxService(buildStrapi({ findMany, count }));

    const result = await service.list({ status: 'new', page: 1 });

    const newFilter = { $or: [{ leadStatus: 'new' }, { leadStatus: { $null: true } }] };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { $and: [newFilter] } }),
    );
    expect(count).toHaveBeenCalledWith({ filters: newFilter });
    expect(result.items[0]).toMatchObject({ status: 'new' });
  });
});

describe('createReservationInboxService.setStatus', () => {
  it('can move a request back to new or to archived', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456', leadStatus: 'read' }));
    const update = vi.fn(async ({ data }: { data: { leadStatus: string } }) => ({
      documentId: 'abc123def456',
      leadStatus: data.leadStatus,
    }));
    const service = createReservationInboxService(buildStrapi({ findOne, update }));

    await expect(service.setStatus('abc123def456', 'archived')).resolves.toEqual({
      documentId: 'abc123def456',
      status: 'archived',
    });
    await expect(service.setStatus('abc123def456', 'new')).resolves.toEqual({
      documentId: 'abc123def456',
      status: 'new',
    });
  });
});

describe('createReservationInboxService.detail', () => {
  it('returns every field the detail modal shows, with selected menu names', async () => {
    const findOne = vi.fn(async () => ({
      documentId: 'doc1',
      fullName: 'Nguyen Van A',
      phone: '0901',
      email: 'a@example.com',
      guestCount: 4,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      occasion: '  ',
      note: 'Gần cửa sổ',
      menuSelectionMode: 'now',
      menuPackages: [{ name: 'Buffet trưa' }, { name: '' }],
      menuItems: [{ name: 'Picanha' }],
      sourceLocale: 'vi',
      sourcePath: '/vi/dat-ban',
      leadStatus: null,
      overlapCount: 2,
      createdAt: new Date('2030-06-10T12:00:00.000Z'),
    }));
    const service = createReservationInboxService(buildStrapi({ findOne }));

    const result = await service.detail('doc1');

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc1',
        populate: {
          menuPackages: { fields: ['name'] },
          menuItems: { fields: ['name'] },
        },
      }),
    );
    expect(result).toEqual({
      documentId: 'doc1',
      fullName: 'Nguyen Van A',
      phone: '0901',
      email: 'a@example.com',
      guestCount: 4,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      occasion: null,
      note: 'Gần cửa sổ',
      menuSelectionMode: 'now',
      menuPackageNames: ['Buffet trưa'],
      menuItemNames: ['Picanha'],
      sourceLocale: 'vi',
      sourcePath: '/vi/dat-ban',
      status: 'new',
      overlapCount: 2,
      createdAt: '2030-06-10T12:00:00.000Z',
    });
  });

  it('throws NotFound when the document does not exist', async () => {
    const service = createReservationInboxService(
      buildStrapi({ findOne: vi.fn(async () => null) }),
    );

    await expect(service.detail('missing')).rejects.toMatchObject({
      code: ReservationInboxErrorCode.NotFound,
    });
  });
});
