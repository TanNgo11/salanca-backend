import { describe, expect, it, vi } from 'vitest';

// The full @strapi/strapi runtime is not resolvable under vitest; only the
// factory wrapper is needed to reach the custom create handler.
vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController:
      (_uid: string, cfg: (args: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

vi.mock('@strapi/utils', () => ({
  errors: {
    ApplicationError: class ApplicationError extends Error {
      readonly details: unknown;
      constructor(message: string, details?: unknown) {
        super(message);
        this.name = 'ApplicationError';
        this.details = details;
      }
    },
  },
}));

import { subscribeReservationCreated } from '../../../domain/reservation-request/reservation-inbox-events';
import createController from './reservation-request';

const buildStrapi = () => {
  const create = vi.fn(async () => ({
    documentId: 'emitdoc123456',
    status: 'new',
    overlapCount: 0,
    createdAt: '2030-06-10T12:00:00.000Z',
  }));
  const count = vi.fn(async () => 0);
  return {
    strapi: {
      contentType: vi.fn(() => ({})),
      contentTypes: {},
      documents: vi.fn(() => ({ create })),
      db: { query: vi.fn(() => ({ count })) },
      log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      plugin: vi.fn(() => undefined),
    } as never,
    create,
  };
};

const buildContext = (data: Record<string, unknown>) => ({
  request: { body: { data }, ip: '10.10.10.99' },
  set: vi.fn(),
  status: 0,
  body: undefined as unknown,
});

const validPayload = {
  fullName: 'Emit Test',
  phone: '0901234567',
  preferredDate: '2030-06-15',
  preferredTime: '19:00-emit',
  guestCount: 4,
  menuSelectionMode: 'later',
  sourceLocale: 'vi',
  website: '',
};

describe('reservation-request controller emit', () => {
  it('emits the mapped inbox item after create and still returns 201', async () => {
    const { strapi } = buildStrapi();
    const controller = (createController as never as (args: { strapi: never }) => {
      create: (ctx: never) => Promise<void>;
    })({ strapi });
    const received: unknown[] = [];
    const unsubscribe = subscribeReservationCreated((item) => received.push(item));
    const context = buildContext(validPayload);

    try {
      await controller.create(context as never);
    } finally {
      unsubscribe();
    }

    expect(context.status).toBe(201);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      documentId: 'emitdoc123456',
      fullName: 'Emit Test',
      phone: '0901234567',
      guestCount: 4,
      preferredDate: '2030-06-15',
      preferredTime: '19:00-emit',
      overlapCount: 0,
      createdAt: '2030-06-10T12:00:00.000Z',
    });
  });
});
