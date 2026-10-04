import { describe, expect, it, vi } from 'vitest';

import { emitReservationCreated } from '../../domain/reservation-request/reservation-inbox-events';
import { createReservationInboxController } from './reservation-inbox.controller';

const buildStrapi = (documentsImpl: Record<string, unknown>) =>
  ({
    documents: vi.fn(() => documentsImpl),
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }) as never;

const buildContext = (overrides: Record<string, unknown> = {}) => ({
  badRequest: vi.fn(),
  body: undefined,
  internalServerError: vi.fn(),
  notFound: vi.fn(),
  params: {},
  query: {},
  req: { on: vi.fn() },
  res: { end: vi.fn(), on: vi.fn(), write: vi.fn(), writeHead: vi.fn() },
  respond: true,
  set: vi.fn(),
  state: {},
  ...overrides,
});

describe('reservation inbox controller summary', () => {
  it('rejects an invalid since with a Vietnamese bad request', async () => {
    const findMany = vi.fn();
    const strapi = buildStrapi({ findMany, count: vi.fn(async () => 0) });
    const controller = createReservationInboxController(strapi);
    const context = buildContext({ query: { since: 'not-a-date' } });

    await controller.summary(context as never);

    expect(context.badRequest).toHaveBeenCalledWith(
      'Tham số thời gian không hợp lệ. Vui lòng dùng định dạng ISO.',
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('accepts a valid ISO since and returns the summary body', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 2);
    const strapi = buildStrapi({ findMany, count });
    const controller = createReservationInboxController(strapi);
    const context = buildContext({ query: { since: '2030-06-01T00:00:00.000Z' } });

    await controller.summary(context as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { status: 'new', createdAt: { $gt: '2030-06-01T00:00:00.000Z' } },
      }),
    );
    expect(context.body).toEqual({ data: { items: [], unreadCount: 2 } });
  });
});

describe('reservation inbox controller markRead', () => {
  it('rejects a malformed documentId', async () => {
    const findOne = vi.fn();
    const strapi = buildStrapi({ findOne });
    const controller = createReservationInboxController(strapi);
    const context = buildContext({ params: { documentId: 'x' } });

    await controller.markRead(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Mã yêu cầu đặt bàn không hợp lệ.');
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the document does not exist', async () => {
    const findOne = vi.fn(async () => null);
    const strapi = buildStrapi({ findOne });
    const controller = createReservationInboxController(strapi);
    const context = buildContext({ params: { documentId: 'abc123def456' } });

    await controller.markRead(context as never);

    expect(context.notFound).toHaveBeenCalledWith('Không tìm thấy yêu cầu đặt bàn này.');
  });
});

describe('reservation inbox controller stream', () => {
  it('writes SSE headers, greeting frame, event frames, and cleans up on close', () => {
    const strapi = buildStrapi({});
    const controller = createReservationInboxController(strapi);
    const listeners: Record<string, () => void> = {};
    const context = buildContext({
      res: {
        end: vi.fn(),
        on: vi.fn((event: string, listener: () => void) => {
          listeners[event] = listener;
        }),
        write: vi.fn(),
        writeHead: vi.fn(),
      },
    });

    controller.stream(context as never);

    expect(context.respond).toBe(false);
    expect(context.res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      }),
    );
    expect(context.res.write).toHaveBeenCalledWith(': connected\n\n');

    emitReservationCreated({
      documentId: 'doc123456789',
      fullName: 'Nguyen Van A',
      phone: '0901',
      guestCount: 4,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      overlapCount: 0,
      createdAt: '2030-06-10T12:00:00.000Z',
    });

    const writes = context.res.write.mock.calls.map((call) => call[0]);
    expect(writes[writes.length - 1]).toBe(
      'event: reservation.created\n' +
        'data: {"documentId":"doc123456789","fullName":"Nguyen Van A","phone":"0901",' +
        '"guestCount":4,"preferredDate":"2030-06-15","preferredTime":"19:00",' +
        '"overlapCount":0,"createdAt":"2030-06-10T12:00:00.000Z"}\n\n',
    );

    expect(context.res.on).toHaveBeenCalledWith('close', expect.any(Function));

    listeners.close();
    expect(context.res.end).toHaveBeenCalledOnce();

    listeners.close();
    expect(context.res.end).toHaveBeenCalledOnce();

    const writesAfterClose = context.res.write.mock.calls.length;
    emitReservationCreated({
      documentId: 'doc987654321',
      fullName: 'Late',
      phone: '0902',
      guestCount: 1,
      preferredDate: '2030-06-15',
      preferredTime: '20:00',
      overlapCount: 0,
      createdAt: '2030-06-10T13:00:00.000Z',
    });
    expect(context.res.write.mock.calls.length).toBe(writesAfterClose);
  });
});

describe('reservation inbox controller list', () => {
  it('rejects an unknown status filter', async () => {
    const findMany = vi.fn();
    const controller = createReservationInboxController(buildStrapi({ findMany, count: vi.fn() }));
    const context = buildContext({ query: { status: 'deleted' } });

    await controller.list(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Trạng thái không hợp lệ.');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects a non-positive page', async () => {
    const controller = createReservationInboxController(
      buildStrapi({ findMany: vi.fn(), count: vi.fn() }),
    );
    const context = buildContext({ query: { page: '0' } });

    await controller.list(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Số trang không hợp lệ.');
  });

  it('trims search and defaults to page 1', async () => {
    const findMany = vi.fn(async () => []);
    const controller = createReservationInboxController(
      buildStrapi({ findMany, count: vi.fn(async () => 0) }),
    );
    const context = buildContext({ query: { status: 'new', search: '  09  ' } });

    await controller.list(context as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          status: 'new',
          $or: [{ fullName: { $containsi: '09' } }, { phone: { $containsi: '09' } }],
        },
        start: 0,
      }),
    );
  });
});

describe('reservation inbox controller setStatus', () => {
  it('rejects a status outside the allowed set', async () => {
    const findOne = vi.fn();
    const controller = createReservationInboxController(buildStrapi({ findOne }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { status: 'spam' } },
    });

    await controller.setStatus(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Trạng thái không hợp lệ.');
    expect(findOne).not.toHaveBeenCalled();
  });

  it('archives a request', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456', status: 'read' }));
    const update = vi.fn(async () => ({ documentId: 'abc123def456', status: 'archived' }));
    const controller = createReservationInboxController(buildStrapi({ findOne, update }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { status: 'archived' } },
    });

    await controller.setStatus(context as never);

    expect(context.body).toEqual({ data: { documentId: 'abc123def456', status: 'archived' } });
  });
});
