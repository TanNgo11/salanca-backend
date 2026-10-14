import type { Core } from '@strapi/strapi';

import { isOrderingError, OrderingError } from '../domain/errors';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type scopeFactory from '../services/scope';
import type tableFactory from '../services/table';
import { rateLimited } from './storefront-guard';

interface AdminCtx {
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  state: { user?: { id?: number; roles?: { code?: string }[] } };
  request: { body?: unknown };
  status: number;
  body: unknown;
  set?: (name: string, value: string) => void;
  type?: string;
}

/** Query names the table secret must never travel in (same list as the storefront guard). */
const TOKEN_QUERY_KEYS = ['token', 't', 'orderToken', 'order_token', 'publicToken'];

/**
 * O12 step 7: table management (screens N6) and table sessions (screens N7), plus the public
 * `POST /tables/resolve` the scanned QR's page calls. Admin routes are guarded by `table.manage` (the
 * session close also requires `payment.record-cash` — it collects money); the service layers
 * the caller's location scope on top. `resolve` is public: it answers with the least data the
 * menu needs (branch, table code/name, menu URL, open/dining-closed status).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const tables = () =>
    strapi.plugin('ordering').service('table') as ReturnType<typeof tableFactory>;
  const actorCtx = async (ctx: AdminCtx): Promise<ServiceContext> => {
    const scope = strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
    return { actor: await scope.actorFromAdminUser(ctx.state.user ?? {}) };
  };
  const fail = (ctx: AdminCtx, error: unknown) => {
    if (isOrderingError(error)) {
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message, details: error.details } };
      return true;
    }
    return false;
  };
  const idOf = (ctx: AdminCtx): number => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new OrderingError('TABLE_NOT_FOUND', 'table not found');
    }
    return id;
  };

  return {
    /** GET /tables?branch= — every table the caller can see, optionally one branch. */
    async list(ctx: AdminCtx) {
      try {
        const branch = typeof ctx.query.branch === 'string' ? ctx.query.branch : undefined;
        ctx.body = await tables().list(await actorCtx(ctx), branch);
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** POST /tables — one table, or `{ bulk: { from, to, prefix?, area?, seats? } }`. */
    async create(ctx: AdminCtx) {
      try {
        const body = (ctx.request.body ?? {}) as Record<string, unknown>;
        const actor = await actorCtx(ctx);
        ctx.body =
          body.bulk !== undefined
            ? await tables().createMany({ ...(body.bulk as Record<string, unknown>), locationRef: body.locationRef }, actor)
            : await tables().create(body, actor);
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** PUT /tables/:id — name, area, seats, code, active flag. */
    async update(ctx: AdminCtx) {
      try {
        ctx.body = await tables().update(
          idOf(ctx),
          (ctx.request.body ?? {}) as Record<string, unknown>,
          await actorCtx(ctx),
        );
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** POST /tables/:id/rotate-qr — new secret; the old QR stops resolving at once. */
    async rotateQr(ctx: AdminCtx) {
      try {
        ctx.body = await tables().rotateQr(idOf(ctx), await actorCtx(ctx));
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** GET /tables/:id/qr.svg — the stored menu URL as a QR SVG (built-in encoder). */
    async qr(ctx: AdminCtx) {
      try {
        const { svg } = await tables().qrSvg(idOf(ctx), await actorCtx(ctx));
        ctx.status = 200;
        ctx.type = 'image/svg+xml';
        ctx.set?.('Cache-Control', 'no-store');
        ctx.body = svg;
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** GET /table-sessions?branch=&status= — the N7 board payload. */
    async sessions(ctx: AdminCtx) {
      try {
        const branch = typeof ctx.query.branch === 'string' ? ctx.query.branch : undefined;
        const status = typeof ctx.query.status === 'string' ? ctx.query.status : undefined;
        ctx.body = await tables().listSessions({ branch, status }, await actorCtx(ctx));
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /** POST /table-sessions/:id/close — collect outstanding + complete groups + close. */
    async closeSession(ctx: AdminCtx) {
      try {
        ctx.body = await tables().closeSession(
          idOf(ctx),
          (ctx.request.body ?? {}) as { method?: unknown; reference?: unknown },
          await actorCtx(ctx),
        );
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    /**
     * POST /api/v1/ordering/tables/resolve — public, body `{ token }`. The QR secret resolves to
     * the branch + table the menu should open on; unknown/disabled secrets are a plain 404 so
     * probing a hash learns nothing. The secret travels in the body, never the path or query, so
     * access logs (which record the URL) never see it.
     */
    async resolve(ctx: AdminCtx) {
      if (rateLimited(strapi, ctx as never, 'read')) return;
      try {
        ctx.set?.('Cache-Control', 'no-store');
        if (TOKEN_QUERY_KEYS.some((key) => ctx.query[key] !== undefined)) {
          throw new OrderingError(
            'VALIDATION_ERROR',
            'send the table token in the request body, never in the URL',
            { details: { field: 'token' } },
          );
        }
        const raw = (ctx.request.body as { token?: unknown } | undefined)?.token;
        const token = typeof raw === 'string' ? raw.trim() : '';
        const table = token ? await tables().resolveByToken(token) : null;
        if (!table) {
          ctx.status = 404;
          ctx.body = { error: { code: 'TABLE_NOT_FOUND', message: 'table not found' } };
          return;
        }
        const branch = await (
          strapi.plugin('ordering').service('branch') as ReturnType<typeof branchFactory>
        ).findByCode(table.locationRef);
        const openSession = (await strapi.db.query('plugin::ordering.table-session').findOne({
          where: { table: table.id, status: 'open' },
          select: ['id'],
        })) as { id: number } | null;
        ctx.body = {
          item: {
            branch: table.locationRef,
            branchName: branch?.name ?? null,
            table: { code: table.code, name: table.name, area: table.area, seats: table.seats },
            menuUrl: table.qrUrl,
            status: openSession ? 'open' : 'available',
          },
        };
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },
  };
};
