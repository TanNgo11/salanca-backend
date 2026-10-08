import { describe, expect, it, vi } from 'vitest';

import { createLeadExportController } from './lead-export.controller';

const buildContext = (params: Record<string, unknown>, query: Record<string, unknown> = {}) => ({
  params,
  query,
  body: undefined as unknown,
  set: vi.fn(),
  badRequest: vi.fn(),
  internalServerError: vi.fn(),
});

const strapi = (count = 0) =>
  ({
    documents: vi.fn(() => ({ count: vi.fn(async () => count), findMany: vi.fn(async () => []) })),
    log: { error: vi.fn() },
  }) as never;

describe('lead export controller', () => {
  it('rejects an unknown kind', async () => {
    const context = buildContext({ kind: 'users' });
    await createLeadExportController(strapi()).exportCsv(context as never);
    expect(context.badRequest).toHaveBeenCalledWith('Loại dữ liệu không hợp lệ.');
  });

  it('rejects a malformed date and a reversed range', async () => {
    const bad = buildContext({ kind: 'contacts' }, { from: '15/06/2030' });
    await createLeadExportController(strapi()).exportCsv(bad as never);
    expect(bad.badRequest).toHaveBeenCalledWith('Ngày không hợp lệ. Dùng định dạng YYYY-MM-DD.');

    const reversed = buildContext({ kind: 'contacts' }, { from: '2030-06-30', to: '2030-06-01' });
    await createLeadExportController(strapi()).exportCsv(reversed as never);
    expect(reversed.badRequest).toHaveBeenCalledWith('Ngày bắt đầu phải trước ngày kết thúc.');
  });

  it('sends a named CSV attachment', async () => {
    const context = buildContext(
      { kind: 'reservations' },
      { from: '2030-06-01', to: '2030-06-30' },
    );
    await createLeadExportController(strapi()).exportCsv(context as never);
    expect(context.set).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(context.set).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="dat-ban-2030-06-01_2030-06-30.csv"',
    );
    expect(String(context.body).startsWith('﻿')).toBe(true);
  });

  it('maps the row cap to a Vietnamese bad request', async () => {
    const context = buildContext({ kind: 'contacts' });
    await createLeadExportController(strapi(10_001)).exportCsv(context as never);
    expect(context.badRequest).toHaveBeenCalledWith(expect.stringContaining('Kết quả vượt quá'));
  });
});
