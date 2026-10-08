import { describe, expect, it, vi } from 'vitest';

import { buildLeadExportFilters, createLeadExportService } from './lead-export.service';

const buildStrapi = (impl: Record<string, unknown>) =>
  ({ documents: vi.fn(() => impl) }) as never;

describe('lead export filters', () => {
  it('turns Vietnam calendar days into a UTC createdAt window', () => {
    expect(
      buildLeadExportFilters({ kind: 'reservations', from: '2030-06-01', to: '2030-06-30' }),
    ).toEqual({
      $and: [
        { createdAt: { $gte: '2030-05-31T17:00:00.000Z' } },
        { createdAt: { $lt: '2030-06-30T17:00:00.000Z' } },
      ],
    });
  });

  it('exports everything when no filter applies', () => {
    expect(buildLeadExportFilters({ kind: 'reservations' })).toEqual({});
  });

  it('splits newsletter sign-ups from contact messages', () => {
    expect(buildLeadExportFilters({ kind: 'newsletter' })).toEqual({
      $and: [{ topic: { $eq: 'newsletter' } }],
    });
    expect(buildLeadExportFilters({ kind: 'contacts' })).toEqual({
      $and: [{ $or: [{ topic: { $ne: 'newsletter' } }, { topic: { $null: true } }] }],
    });
  });
});

describe('lead export service', () => {
  it('refuses exports above the row cap', async () => {
    const findMany = vi.fn();
    const service = createLeadExportService(
      buildStrapi({ count: vi.fn(async () => 10_001), findMany }),
    );
    await expect(service.exportCsv({ kind: 'contacts' })).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries reservations oldest first with menu names', async () => {
    const findMany = vi.fn(async () => [{ fullName: 'An', leadStatus: 'new' }]);
    const service = createLeadExportService(
      buildStrapi({ count: vi.fn(async () => 1), findMany }),
    );
    const csv = await service.exportCsv({ kind: 'reservations' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'createdAt:asc',
        limit: 10_000,
        populate: { menuPackages: { fields: ['name'] }, menuItems: { fields: ['name'] } },
      }),
    );
    expect(csv.split('\r\n')[1]).toContain('"An"');
  });
});
