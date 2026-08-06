import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryRateLimit } from '../rate-limit/in-memory-rate-limit';
import {
  handleReservationCreate,
  RESERVATION_REQUEST_UID,
  type ReservationCreateContext,
} from './handle-reservation-create';
import { ReservationRequestValidationErrorCode } from './reservation-request.validation';

type CreateCall = { data: Record<string, unknown> };

const validBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Nguyễn An',
  phone: '0900000000',
  preferredDate: '2999-12-31',
  preferredTime: '19:00',
  guestCount: 4,
  menuSelectionMode: 'later',
  sourceLocale: 'vi',
  ...overrides,
});

const createContext = (data: unknown, ip = '203.0.113.7'): ReservationCreateContext & {
  headers: Record<string, string>;
} => {
  const headers: Record<string, string> = {};
  return {
    headers,
    request: { body: { data }, ip },
    status: 200,
    body: undefined,
    set: (name: string, value: string) => {
      headers[name] = value;
    },
  };
};

const createStrapi = (options: {
  create?: (payload: CreateCall) => Record<string, unknown>;
  menuFindMany?: ReturnType<typeof vi.fn>;
  peerCount?: number;
}) => {
  const createSpy = vi.fn(async (payload: CreateCall) =>
    options.create
      ? options.create(payload)
      : { documentId: 'doc-1', status: 'new', overlapCount: payload.data.overlapCount },
  );
  const findMany = options.menuFindMany ?? vi.fn(async () => []);

  const strapi = {
    documents: (uid: string) =>
      uid === RESERVATION_REQUEST_UID ? { create: createSpy } : { findMany },
    db: {
      query: () => ({ count: async () => options.peerCount ?? 0 }),
    },
  } as unknown as Core.Strapi;

  return { strapi, createSpy, findMany };
};

describe('handleReservationCreate', () => {
  let limiter: InMemoryRateLimit;

  beforeEach(() => {
    limiter = new InMemoryRateLimit({ max: 2, windowMs: 60_000 });
  });

  it('creates a lead and echoes the stored overlap', async () => {
    const { strapi, createSpy } = createStrapi({ peerCount: 3 });
    const ctx = createContext(validBody());

    await handleReservationCreate(strapi, ctx, { rateLimit: limiter });

    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({
      data: { documentId: 'doc-1', status: 'new', overlapCount: 3, hasOverlap: true },
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a client-supplied status and always stores new', async () => {
    const { strapi, createSpy } = createStrapi({});
    const ctx = createContext(validBody({ status: 'archived' }));

    await handleReservationCreate(strapi, ctx, { rateLimit: limiter });

    expect(createSpy.mock.calls[0][0].data.status).toBe('new');
  });

  it('maps a validation failure to ApplicationError with the original code', async () => {
    const { strapi, createSpy } = createStrapi({});
    const ctx = createContext(validBody({ preferredTime: '7:00 PM' }));

    await expect(
      handleReservationCreate(strapi, ctx, { rateLimit: limiter }),
    ).rejects.toBeInstanceOf(errors.ApplicationError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns a 429 envelope with Retry-After once the quota is spent', async () => {
    const { strapi } = createStrapi({});

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await handleReservationCreate(strapi, createContext(validBody()), { rateLimit: limiter });
    }

    const ctx = createContext(validBody());
    await handleReservationCreate(strapi, ctx, { rateLimit: limiter });

    expect(ctx.status).toBe(429);
    expect(ctx.headers['Retry-After']).toBe('60');
    expect(ctx.body).toMatchObject({
      data: null,
      error: {
        status: 429,
        name: 'ApplicationError',
        details: { code: ReservationRequestValidationErrorCode.RateLimited },
      },
    });
  });

  it('keys the quota per client IP', async () => {
    const { strapi } = createStrapi({});

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await handleReservationCreate(strapi, createContext(validBody(), '198.51.100.1'), {
        rateLimit: limiter,
      });
    }

    const other = createContext(validBody(), '198.51.100.2');
    await handleReservationCreate(strapi, other, { rateLimit: limiter });

    expect(other.status).toBe(201);
  });

  it('resolves the menu in the submitter locale and surfaces invalid ids', async () => {
    const findMany = vi.fn(async () => []);
    const { strapi, createSpy } = createStrapi({ menuFindMany: findMany });
    const ctx = createContext(
      validBody({ menuSelectionMode: 'now', menuItems: ['abc'], sourceLocale: 'en' }),
    );

    await expect(
      handleReservationCreate(strapi, ctx, { rateLimit: limiter }),
    ).rejects.toMatchObject({
      details: { code: ReservationRequestValidationErrorCode.MenuIdsInvalid },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
    expect(createSpy).not.toHaveBeenCalled();
  });
});
