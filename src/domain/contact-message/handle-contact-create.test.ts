import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryRateLimit } from '../rate-limit/in-memory-rate-limit';
import { ContactMessageValidationErrorCode } from './contact-message.validation';
import { handleContactCreate, type ContactCreateContext } from './handle-contact-create';

const validBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Trần Bình',
  email: 'binh@example.com',
  message: 'Xin chào, tôi muốn hỏi về đặt tiệc.',
  sourceLocale: 'vi',
  ...overrides,
});

const createContext = (data: unknown, ip = '203.0.113.7'): ContactCreateContext & {
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

const createStrapi = () => {
  const createSpy = vi.fn(async () => ({ documentId: 'doc-1', status: 'new' }));
  const strapi = { documents: () => ({ create: createSpy }) } as unknown as Core.Strapi;
  return { strapi, createSpy };
};

describe('handleContactCreate', () => {
  let limiter: InMemoryRateLimit;

  beforeEach(() => {
    limiter = new InMemoryRateLimit({ max: 2, windowMs: 60_000 });
  });

  it('creates a message and returns the minimal payload', async () => {
    const { strapi, createSpy } = createStrapi();
    const ctx = createContext(validBody());

    await handleContactCreate(strapi, ctx, { rateLimit: limiter });

    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ data: { documentId: 'doc-1', status: 'new' } });
    expect(createSpy.mock.calls[0][0].data.status).toBe('new');
  });

  it('ignores a client-supplied status', async () => {
    const { strapi, createSpy } = createStrapi();

    await handleContactCreate(strapi, createContext(validBody({ status: 'archived' })), {
      rateLimit: limiter,
    });

    expect(createSpy.mock.calls[0][0].data.status).toBe('new');
  });

  it('maps a validation failure to ApplicationError with the original code', async () => {
    const { strapi, createSpy } = createStrapi();
    const ctx = createContext(validBody({ email: undefined, phone: undefined }));

    await expect(handleContactCreate(strapi, ctx, { rateLimit: limiter })).rejects.toMatchObject({
      details: { code: ContactMessageValidationErrorCode.ContactRequired },
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects honeypot submissions without creating anything', async () => {
    const { strapi, createSpy } = createStrapi();
    const ctx = createContext(validBody({ website: 'http://spam.example' }));

    await expect(handleContactCreate(strapi, ctx, { rateLimit: limiter })).rejects.toBeInstanceOf(
      errors.ApplicationError,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns a 429 envelope with Retry-After once the quota is spent', async () => {
    const { strapi } = createStrapi();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await handleContactCreate(strapi, createContext(validBody()), { rateLimit: limiter });
    }

    const ctx = createContext(validBody());
    await handleContactCreate(strapi, ctx, { rateLimit: limiter });

    expect(ctx.status).toBe(429);
    expect(ctx.headers['Retry-After']).toBe('60');
    expect(ctx.body).toMatchObject({
      error: { details: { code: ContactMessageValidationErrorCode.RateLimited } },
    });
  });

  it('does not burn quota on invalid submissions', async () => {
    const { strapi } = createStrapi();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        handleContactCreate(strapi, createContext({ fullName: '' }), { rateLimit: limiter }),
      ).rejects.toBeInstanceOf(errors.ApplicationError);
    }

    const ctx = createContext(validBody());
    await handleContactCreate(strapi, ctx, { rateLimit: limiter });

    expect(ctx.status).toBe(201);
  });
});
