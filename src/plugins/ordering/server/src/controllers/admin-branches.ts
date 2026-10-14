import type { Core } from '@strapi/strapi';

import { RECEIVE_KINDS, type ReceiveKind } from '../domain/branch-settings';
import { OrderingError } from '../domain/errors';
import { addDays, localToUtc, toLocalParts } from '../domain/scheduling/zoned-time';
import type branchFactory from '../services/branch';
import type staffScopeFactory from '../services/staff-scope';
import { adminAction } from './http';

type BranchService = ReturnType<typeof branchFactory>;
type StaffScopeService = ReturnType<typeof staffScopeFactory>;

const parseKinds = (raw: unknown): ReceiveKind[] | undefined => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const kinds = raw.filter((item): item is ReceiveKind => RECEIVE_KINDS.includes(item as ReceiveKind));
  if (kinds.length === 0) {
    throw new OrderingError('VALIDATION_ERROR', 'kinds must be receive methods', {
      details: { field: 'kinds', allowed: RECEIVE_KINDS },
    });
  }
  return [...new Set(kinds)];
};

/** `until` (ISO) or `minutes` or `endOfDay` — the body picks one; endOfDay uses branch-local close. */
const parseUntil = async (
  service: BranchService,
  code: string,
  body: Record<string, unknown>,
): Promise<Date> => {
  if (body.endOfDay === true) {
    const branch = await service.findByCode(code);
    const timezone = branch?.timezone ?? 'Asia/Ho_Chi_Minh';
    const today = toLocalParts(new Date(), timezone).date;
    // Pause until the end of the next calendar day start — keeps the branch closed overnight.
    return localToUtc(addDays(today, 1), '00:00', timezone);
  }
  if (typeof body.until === 'string') {
    const until = new Date(body.until);
    if (Number.isFinite(until.getTime()) && until.getTime() > Date.now()) return until;
  }
  const minutes = Number(body.minutes);
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 4320) {
    return new Date(Date.now() + minutes * 60_000);
  }
  throw new OrderingError('VALIDATION_ERROR', 'give minutes, until, or endOfDay', {
    details: { field: 'until' },
  });
};

/**
 * "Chi nhánh" screen API (screens S7). Routes require `plugin::ordering.settings.manage`; the
 * service limits every call to the staff member's branch scope (out of scope = 404).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('branch') as BranchService;
  const staff = () => strapi.plugin('ordering').service('staff-scope') as StaffScopeService;

  return {
    list: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: await service().listForAdmin(serviceCtx),
      paymentProviders: service().enabledPaymentProviders().known,
    })),
    get: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().getForAdmin(ctx.params.code ?? '', serviceCtx),
    })),
    create: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().createBranch(ctx.request.body ?? {}, serviceCtx),
    })),
    update: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().updateBranch(ctx.params.code ?? '', ctx.request.body ?? {}, serviceCtx),
    })),
    deliveryQuote: adminAction(strapi, async (ctx, serviceCtx) =>
      service().deliveryQuote(ctx.params.code ?? '', ctx.request.body ?? {}, serviceCtx),
    ),
    // O12 pause/busy (screens N3): staff-level routes (`order.process`), deadlines auto-reopen.
    pause: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const code = ctx.params.code ?? '';
      return {
        item: await service().setPause(
          code,
          {
            kinds: parseKinds(body.kinds) ?? [...RECEIVE_KINDS],
            until: await parseUntil(service(), code, body),
            reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined,
          },
          serviceCtx,
        ),
      };
    }),
    resume: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      return {
        item: await service().clearPause(ctx.params.code ?? '', parseKinds(body.kinds), serviceCtx),
      };
    }),
    busy: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const extraMinutes = Number(body.extraMinutes);
      const minutes = Number(body.minutes);
      if (!Number.isInteger(extraMinutes) || extraMinutes < 1 || extraMinutes > 240) {
        throw new OrderingError('VALIDATION_ERROR', 'extraMinutes must be 1..240', {
          details: { field: 'extraMinutes' },
        });
      }
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        throw new OrderingError('VALIDATION_ERROR', 'minutes must be 1..1440', {
          details: { field: 'minutes' },
        });
      }
      return {
        item: await service().setBusy(
          ctx.params.code ?? '',
          { extraMinutes, until: new Date(Date.now() + minutes * 60_000) },
          serviceCtx,
        ),
      };
    }),
    clearBusy: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().clearBusy(ctx.params.code ?? '', serviceCtx),
    })),
    // "Nhân viên và chi nhánh" (screens S8).
    staffList: adminAction(strapi, async (_ctx, serviceCtx) => ({ results: await staff().list(serviceCtx) })),
    staffPut: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await staff().put(Number(ctx.params.adminUserId), (ctx.request.body ?? {}) as Record<string, unknown>, serviceCtx),
    })),
  };
};
