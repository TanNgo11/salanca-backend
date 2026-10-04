import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditAction, AuditActorType } from '../../domain/audit/audit-event.types';
import { writeAdminAuditEvent } from '../../domain/audit/admin-audit-writer';
import createAdminAuditHttpMiddleware from './index';

vi.mock('../../domain/audit/admin-audit-writer', () => ({
  writeAdminAuditEvent: vi.fn(async () => undefined),
}));

const writeMock = vi.mocked(writeAdminAuditEvent);

const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const createLoginContext = (overrides?: {
  next?: () => Promise<void>;
  status?: number;
  user?: { email?: string; firstname?: string; id?: number } | null;
}): {
  ctx: {
    method: string;
    path: string;
    request: { body: { email: string; password: string } };
    set: ReturnType<typeof vi.fn>;
    state: {
      requestId: string;
      user?: { email?: string; firstname?: string; id?: number };
    };
    status: number;
  };
  middleware: ReturnType<typeof createAdminAuditHttpMiddleware>;
  next: ReturnType<typeof vi.fn>;
} => {
  const ctx = {
    method: 'POST',
    path: '/admin/login',
    request: { body: { email: 'an@example.com', password: 'secret' } },
    set: vi.fn(),
    state: {
      requestId: REQUEST_ID,
      ...(overrides?.user === null
        ? {}
        : {
            user: overrides?.user ?? {
              id: 3,
              email: 'an@example.com',
              firstname: 'An',
            },
          }),
    },
    status: overrides?.status ?? 200,
  };
  const next =
    overrides?.next ??
    vi.fn(async () => {
      ctx.status = overrides?.status ?? 200;
    });
  const middleware = createAdminAuditHttpMiddleware(
    { identifierHashSecret: 'audit-test-secret' },
    {
      strapi: {
        log: { error: vi.fn() },
      } as never,
    },
  );

  return { ctx, middleware, next };
};

describe('admin audit HTTP middleware', () => {
  beforeEach(() => {
    writeMock.mockClear();
  });

  it('writes one login success after the handler returns 2xx', async () => {
    const { ctx, middleware, next } = createLoginContext();

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.AdminLoginSuccess,
        actor: expect.objectContaining({
          documentId: '3',
          type: AuditActorType.AdminUser,
        }),
        requestId: REQUEST_ID,
        statusCode: 200,
        success: true,
        targetDocumentId: '3',
        targetType: 'authentication',
      }),
    );
    expect(writeMock.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({ action: AuditAction.AdminLoginFailure }),
    );
  });

  it('writes one login failure when session creation returns 5xx after auth', async () => {
    const { ctx, middleware, next } = createLoginContext({ status: 500 });

    await middleware(ctx, next);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.AdminLoginFailure,
        actor: { type: AuditActorType.Anonymous },
        statusCode: 500,
        success: false,
      }),
    );
    expect(JSON.stringify(writeMock.mock.calls[0]?.[1])).not.toContain('secret');
  });

  it('writes one login failure when the handler throws', async () => {
    const error = Object.assign(new Error('Invalid credentials'), { status: 400 });
    const { ctx, middleware } = createLoginContext();
    const next = vi.fn(async () => {
      throw error;
    });

    await expect(middleware(ctx, next)).rejects.toBe(error);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.AdminLoginFailure,
        success: false,
        statusCode: 400,
        afterValues: { maskedIdentifier: 'a***@example.com' },
      }),
    );
  });

  it('records an unclassified downstream exception as a server failure', async () => {
    const error = new Error('Session store unavailable');
    const { ctx, middleware } = createLoginContext();
    const next = vi.fn(async () => {
      throw error;
    });

    await expect(middleware(ctx, next)).rejects.toBe(error);
    expect(writeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.AdminLoginFailure,
        statusCode: 500,
        success: false,
      }),
    );
  });

  it('does not write a token event when the mutation fails', async () => {
    const ctx = {
      method: 'POST',
      path: '/admin/api-tokens',
      request: { body: {} },
      set: vi.fn(),
      state: { requestId: REQUEST_ID, user: { id: 1, email: 'admin@example.com' } },
      status: 500,
    };
    const middleware = createAdminAuditHttpMiddleware(
      { identifierHashSecret: 'audit-test-secret' },
      { strapi: { log: { error: vi.fn() } } as never },
    );

    await middleware(ctx, vi.fn(async () => {
      ctx.status = 500;
    }));

    expect(writeMock).not.toHaveBeenCalled();
  });
});
