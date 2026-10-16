import type { Core } from '@strapi/strapi';

import type adminOrdersFactory from '../services/admin-orders';
import type carrierAssignmentFactory from '../services/carrier-assignment';
import type { ReconcileOutcome } from '../services/carrier-assignment';
import type deliveryAssignmentFactory from '../services/delivery-assignment';
import type orderExportFactory from '../services/order-export';
import type manualPaymentFactory from '../services/manual-payment';
import type orderEditFactory from '../services/order-edit';
import type { EditInput } from '../services/order-edit';
import type paymentLinkFactory from '../services/payment-link';
import type orderingSettingsFactory from '../services/ordering-settings';
import { adminAction, positiveInt, text } from './http';

type AdminOrders = ReturnType<typeof adminOrdersFactory>;
type CarrierAssignment = ReturnType<typeof carrierAssignmentFactory>;
type Delivery = ReturnType<typeof deliveryAssignmentFactory>;
type OrderExport = ReturnType<typeof orderExportFactory>;
type Settings = ReturnType<typeof orderingSettingsFactory>;
type ManualPayment = ReturnType<typeof manualPaymentFactory>;
type PaymentLink = ReturnType<typeof paymentLinkFactory>;
type OrderEdit = ReturnType<typeof orderEditFactory>;

const body = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Passes the edit body through. The order-edit service checks every field. */
const parseEdit = (value: unknown): EditInput => {
  const input = body(value);
  const add = Array.isArray(input.add)
    ? input.add.map((row) => {
        const item = record(row) ?? {};
        const options = Array.isArray(item.options)
          ? item.options.flatMap((option) => {
              const picked = record(option);
              if (!picked || typeof picked.groupUid !== 'string' || typeof picked.optionUid !== 'string') return [];
              return [
                {
                  groupUid: picked.groupUid,
                  optionUid: picked.optionUid,
                  quantity: typeof picked.quantity === 'number' ? picked.quantity : 1,
                },
              ];
            })
          : undefined;
        return {
          sellableUid: typeof item.sellableUid === 'string' ? item.sellableUid : '',
          ...(typeof item.variantUid === 'string' && item.variantUid !== '' ? { variantUid: item.variantUid } : {}),
          ...(options && options.length > 0 ? { options } : {}),
          quantity: Number(item.quantity),
          ...(typeof item.note === 'string' ? { note: item.note } : {}),
        };
      })
    : undefined;
  const reduce = Array.isArray(input.reduce)
    ? input.reduce.map((row) => {
        const item = record(row) ?? {};
        return { lineId: Number(item.lineId), quantity: Number(item.quantity) };
      })
    : undefined;
  const timing = record(input.timing);
  const address = record(input.address);
  const addressFields = ['recipientName', 'phone', 'line1', 'wardCode', 'communeCode', 'note'] as const;
  return {
    revision: Number(input.revision),
    reason: typeof input.reason === 'string' ? input.reason : '',
    ...(add && add.length > 0 ? { add } : {}),
    ...(reduce && reduce.length > 0 ? { reduce } : {}),
    ...(timing?.kind === 'asap' ? { timing: { kind: 'asap' } } : {}),
    ...(timing?.kind === 'scheduled' ? { timing: { kind: 'scheduled', startsAt: String(timing.startsAt ?? '') } } : {}),
    ...(address
      ? {
          address: Object.fromEntries(
            addressFields.flatMap((key) => (typeof address[key] === 'string' ? [[key, address[key]]] : [])),
          ) as EditInput['address'],
        }
      : {}),
    ...(input.notifyCustomer !== undefined ? { notifyCustomer: input.notifyCustomer as boolean } : {}),
  };
};

/**
 * Order inbox and order actions (screens S1–S5). Each route's action is checked by its policy;
 * the service enforces the branch scope (404 out of scope).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('admin-orders') as AdminOrders;
  const delivery = () => strapi.plugin('ordering').service('delivery-assignment') as Delivery;
  const carriers = () =>
    strapi.plugin('ordering').service('carrier-assignment') as CarrierAssignment;
  const settings = () => strapi.plugin('ordering').service('ordering-settings') as Settings;
  const manual = () => strapi.plugin('ordering').service('manual-payment') as ManualPayment;
  const exporter = () => strapi.plugin('ordering').service('order-export') as OrderExport;
  const links = () => strapi.plugin('ordering').service('payment-link') as PaymentLink;
  const edits = () => strapi.plugin('ordering').service('order-edit') as OrderEdit;
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
          receive: text(ctx.query.receive),
          assignee: text(ctx.query.assignee),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),
    branches: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: await service().branchesForStaff(serviceCtx),
    })),
    deliveryStaff: adminAction(strapi, async (ctx, serviceCtx) => ({
      results: await delivery().assignableStaff(text(ctx.query.branch) ?? '', serviceCtx),
    })),
    summary: adminAction(strapi, async (ctx, serviceCtx) =>
      service().summary(text(ctx.query.since), serviceCtx),
    ),
    // CSV download (screens V5): binary body + attachment headers, errors stay JSON.
    exportOrders: adminAction(strapi, async (ctx, serviceCtx) => {
      const { csv, fileName } = await exporter().exportCsv(
        {
          from: text(ctx.query.from) ?? undefined,
          to: text(ctx.query.to) ?? undefined,
          branch: text(ctx.query.branch) ?? undefined,
        },
        serviceCtx,
      );
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = csv;
      return undefined;
    }),
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
          assigneeRef: optionalText(input.assigneeRef),
          tracking: input.tracking,
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
    // O13 carrier legs ("Gọi xe"): quote → book → cancel, all staff-initiated (order.process).
    carrierQuote: adminAction(strapi, async (ctx, serviceCtx) =>
      carriers().carrierQuote(
        id(ctx.params.id),
        { serviceId: optionalText(body(ctx.request.body).serviceId) },
        serviceCtx,
      ),
    ),
    carrierBook: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return carriers().carrierBook(
        id(ctx.params.id),
        {
          serviceId: optionalText(input.serviceId),
          note: optionalText(input.note),
          notifyCustomer: typeof input.notifyCustomer === 'boolean' ? input.notifyCustomer : undefined,
        },
        serviceCtx,
      );
    }),
    carrierReconcile: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return carriers().carrierReconcile(
        id(ctx.params.id),
        {
          operationKey: String(input.operationKey ?? ''),
          outcome: String(input.outcome ?? '') as ReconcileOutcome,
          carrierRef: optionalText(input.carrierRef),
          carrierStatus: optionalText(input.carrierStatus),
          reason: String(input.reason ?? ''),
        },
        serviceCtx,
      );
    }),
    carrierCancel: adminAction(strapi, async (ctx, serviceCtx) =>
      carriers().carrierCancel(
        id(ctx.params.id),
        { reason: optionalText(body(ctx.request.body).reason) },
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
    editPreview: adminAction(strapi, async (ctx, serviceCtx) =>
      edits().preview(id(ctx.params.id), parseEdit(ctx.request.body), serviceCtx),
    ),
    edit: adminAction(strapi, async (ctx, serviceCtx) => {
      const orderId = id(ctx.params.id);
      const preview = (await edits().edit(orderId, parseEdit(ctx.request.body), serviceCtx)).preview;
      return { preview, detail: await service().detail(orderId, serviceCtx) };
    }),
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
    paymentLink: adminAction(strapi, async (ctx, serviceCtx) =>
      links().issue(id(ctx.params.id), serviceCtx),
    ),
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
