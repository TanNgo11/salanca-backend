import type { Core } from '@strapi/strapi';

import type adminOrdersFactory from '../services/admin-orders';
import type manualPaymentFactory from '../services/manual-payment';
import type orderingSettingsFactory from '../services/ordering-settings';
import { adminAction, positiveInt, text } from './http';

type AdminOrders = ReturnType<typeof adminOrdersFactory>;
type Settings = ReturnType<typeof orderingSettingsFactory>;
type ManualPayment = ReturnType<typeof manualPaymentFactory>;

const body = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Order inbox and order actions (screens S1–S5). Each route's action is checked by its policy;
 * the service enforces the branch scope (404 out of scope).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('admin-orders') as AdminOrders;
  const settings = () => strapi.plugin('ordering').service('ordering-settings') as Settings;
  const manual = () => strapi.plugin('ordering').service('manual-payment') as ManualPayment;
  const id = (value: string | undefined) => positiveInt(value) ?? 0;

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      service().list(
        {
          tab: text(ctx.query.tab),
          branch: text(ctx.query.branch),
          businessDate: text(ctx.query.businessDate),
          q: text(ctx.query.q),
          payment: text(ctx.query.payment),
          origin: text(ctx.query.origin),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),
    branches: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: await service().branchesForStaff(serviceCtx),
    })),
    summary: adminAction(strapi, async (ctx, serviceCtx) =>
      service().summary(text(ctx.query.since), serviceCtx),
    ),
    detail: adminAction(strapi, async (ctx, serviceCtx) => service().detail(id(ctx.params.id), serviceCtx)),
    transition: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().transition(
        id(ctx.params.id),
        {
          to: String(input.to ?? ''),
          note: optionalText(input.note),
          notifyCustomer: typeof input.notifyCustomer === 'boolean' ? input.notifyCustomer : undefined,
          delayMinutes: typeof input.delayMinutes === 'number' ? input.delayMinutes : undefined,
          reasonCode: optionalText(input.reasonCode),
        },
        serviceCtx,
      );
    }),
    cashHandover: adminAction(strapi, async (ctx, serviceCtx) =>
      service().cashHandover(
        id(ctx.params.id),
        { method: optionalText(body(ctx.request.body).method) },
        serviceCtx,
      ),
    ),
    cancel: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().cancel(
        id(ctx.params.id),
        { reasonCode: optionalText(input.reasonCode), note: optionalText(input.note) },
        serviceCtx,
      );
    }),
    addNote: adminAction(strapi, async (ctx, serviceCtx) =>
      service().addNote(id(ctx.params.id), optionalText(body(ctx.request.body).text), serviceCtx),
    ),
    lineCancelPreview: adminAction(strapi, async (ctx, serviceCtx) =>
      service().lineCancelPreview(
        id(ctx.params.id),
        id(ctx.params.lineId),
        positiveInt(ctx.query.quantity) ?? 0,
        serviceCtx,
      ),
    ),
    cancelLine: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().cancelLine(
        id(ctx.params.id),
        id(ctx.params.lineId),
        { quantity: Number(input.quantity), reason: optionalText(input.reason) },
        serviceCtx,
      );
    }),
    refund: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().refundOrder(
        id(ctx.params.id),
        {
          method: input.method,
          amount: Number(input.amount),
          reason: optionalText(input.reason),
          idempotencyKey: optionalText(input.idempotencyKey),
        },
        serviceCtx,
      );
    }),
    settleRefund: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().settleRefund(
        id(ctx.params.id),
        { reference: input.reference, settledAt: input.settledAt },
        serviceCtx,
      );
    }),
    recordManual: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return manual().record(
        id(ctx.params.id),
        {
          reference: input.reference,
          amount: input.amount,
          transferredAt: input.transferredAt,
          note: input.note,
        },
        serviceCtx,
      );
    }),
    quoteDraft: adminAction(strapi, async (ctx, serviceCtx) => service().quoteDraft(ctx.request.body, serviceCtx)),
    createDraft: adminAction(strapi, async (ctx, serviceCtx) => service().createDraft(ctx.request.body, serviceCtx)),
    confirmDraft: adminAction(strapi, async (ctx, serviceCtx) =>
      service().confirmDraft(id(ctx.params.id), serviceCtx),
    ),
    deleteDraft: adminAction(strapi, async (ctx, serviceCtx) =>
      service().deleteDraft(id(ctx.params.id), serviceCtx),
    ),
    getSettings: adminAction(strapi, async () => ({ settings: await settings().get() })),
    putSettings: adminAction(strapi, async (ctx, serviceCtx) => ({
      settings: await settings().put(ctx.request.body ?? {}, serviceCtx),
    })),
  };
};
