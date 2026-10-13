import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { resolvePrinting } from '../domain/branch-settings';
import { maskPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { resolveLocalizedText } from '../domain/catalog/localized-text';
import type adminOrdersFactory from './admin-orders';
import type branchFactory from './branch';
import type scopeFactory from './scope';
import type { ServiceContext } from './context';

export type PrintDoc = 'kitchen' | 'receipt';

type OrderDetail = Awaited<ReturnType<ReturnType<typeof adminOrdersFactory>['detail']>>;

/**
 * Print payloads for the Admin print pages (O12 plan step 5, screens N1). Both docs reuse the
 * scope-checked `admin-orders.detail` projection, then strip by doc:
 * - `kitchen`: items + notes only — never prices, phone numbers, or addresses.
 * - `receipt`: provisional bill — phone is masked; pricing/payment breakdown included.
 */
const print = ({ strapi }: { strapi: Core.Strapi }) => {
  const adminOrders = () =>
    strapi.plugin('ordering').service('admin-orders') as ReturnType<typeof adminOrdersFactory>;
  const branches = () =>
    strapi.plugin('ordering').service('branch') as ReturnType<typeof branchFactory>;

  const maskedPhoneOf = (raw: string | undefined): string | null => {
    const national = normalizeVietnamesePhone(raw ?? '');
    return national.valid ? maskPhone(national.national) : null;
  };

  return {
    async forOrder(orderId: number, doc: string, ctx: ServiceContext) {
      if (doc !== 'kitchen' && doc !== 'receipt') {
        throw new OrderingError('VALIDATION_ERROR', 'doc must be kitchen or receipt', {
          details: { doc },
        });
      }
      const detail = await adminOrders().detail(orderId, ctx);
      const branch = await branches().findByCode(detail.order.locationRef);
      const printing = resolvePrinting(branch?.printing) ?? {
        width: 80 as const,
        autoKitchenTicket: false,
      };
      const locale = detail.order.placedLocale === 'en' ? 'en' : 'vi';
      const receive = (detail.order.receiveMethod ?? {}) as {
        kind?: string;
        timing?: { mode?: string; slot?: unknown };
      };
      const common = {
        doc: doc as PrintDoc,
        width: printing.width,
        header: printing.header ?? null,
        footer: printing.footer ?? null,
        autoKitchenTicket: printing.autoKitchenTicket,
        order: {
          code: detail.order.code,
          status: detail.order.status,
          placedAt: detail.order.placedAt,
          businessDate: detail.order.businessDate,
        },
        branch: {
          code: detail.order.locationRef,
          name:
            resolveLocalizedText(detail.order.branch?.name, locale, 'vi') ??
            detail.order.locationRef,
          phone: branch?.phone ?? null,
          timezone: detail.order.branch?.timezone ?? branch?.timezone ?? 'Asia/Ho_Chi_Minh',
        },
        receive: {
          kind: receive.kind ?? 'pickup',
          mode: receive.timing?.mode ?? null,
          promisedAt: detail.group?.estimatedReadyAt ?? null,
          slot: receive.timing?.slot ?? null,
        },
        lines: detail.lines.map((line) => ({
          title: line.title,
          sku: line.sku,
          quantity: line.quantity,
          canceledQuantity: line.canceledQuantity,
          options: line.options,
          note: line.note,
        })),
        customerNote: detail.order.customerNote ?? null,
      };
      if (doc === 'kitchen') {
        return common;
      }
      const contact = (detail.order.contact ?? {}) as { name?: string; phone?: string };
      return {
        ...common,
        contact: {
          name: contact.name ?? null,
          phoneMasked: maskedPhoneOf(contact.phone),
        },
        // The snapshot carries the recipient's raw phone — the receipt prints the masked
        // contact phone instead, so the address is stripped to the street lines.
        deliveryAddress: detail.delivery?.address
          ? (({ line1, wardName, provinceName, note }) => ({ line1, wardName, provinceName, note }))(
              detail.delivery.address as {
                line1?: string;
                wardName?: string;
                provinceName?: string;
                note?: string;
              },
            )
          : null,
        lines: detail.lines.map((line) => ({
          title: line.title,
          sku: line.sku,
          quantity: line.quantity,
          canceledQuantity: line.canceledQuantity,
          options: line.options,
          note: line.note,
          unitAmount: line.unitAmount,
          optionAmount: line.optionAmount,
          lineTotalAmount: line.lineTotalAmount,
        })),
        adjustments: detail.adjustments.map((adjustment) => ({
          kind: adjustment.kind,
          label: adjustment.label,
          amount: adjustment.amount,
        })),
        totals: detail.totals,
        payments: detail.payments.map((payment) => ({
          providerCode: payment.providerCode,
          status: payment.status,
          capturedAmount: payment.capturedAmount,
          capturedAt: payment.capturedAt,
        })),
      };
    },

    /**
     * "In hóa đơn bàn" (screen N7): every order of the session on one provisional bill.
     * Lines are merged by product; order codes stay listed so the table can cross-check.
     */
    async forSession(sessionId: number, ctx: ServiceContext) {
      const session = (await strapi.db.query('plugin::ordering.table-session').findOne({
        where: { id: sessionId },
        populate: {
          table: { select: ['id', 'code', 'name', 'area'] },
          orders: { select: ['id', 'code'], orderBy: { id: 'asc' } },
        },
      })) as {
        id: number;
        locationRef: string;
        openedAt: string;
        closedAt: string | null;
        businessDate: string;
        table: { id: number; code: string; name: string; area: string | null } | null;
        orders: Array<{ id: number; code: string }>;
      } | null;
      if (!session) {
        throw new OrderingError('TABLE_SESSION_NOT_FOUND', 'table session not found', {
          details: { sessionId },
        });
      }
      const scope = strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
      scope.assertLocationInScope(await scope.loadScope(ctx), session.locationRef);
      const branch = await branches().findByCode(session.locationRef);
      const printing = resolvePrinting(branch?.printing) ?? {
        width: 80 as const,
        autoKitchenTicket: false,
      };
      type ReceiptPayload = {
        order: { code: string };
        branch: { code: string; name: string; phone: string | null; timezone: string };
        totals: {
          currency: string;
          subtotal: number;
          adjustment: number;
          fulfillment: number;
          tax: number;
          total: number;
          paid: number;
          refunded: number;
          due: number;
        };
        lines: Array<{
          title: unknown;
          quantity: number;
          canceledQuantity: number;
          lineTotalAmount: number;
          unitAmount: number;
          optionAmount: number;
        }>;
        adjustments: Array<{ kind: unknown; label: unknown; amount: number }>;
        payments: Array<Record<string, unknown>>;
      };
      const receipts = [] as ReceiptPayload[];
      for (const order of session.orders ?? []) {
        receipts.push(
          (await this.forOrder(order.id, 'receipt', ctx)) as ReceiptPayload,
        );
      }
      // Merge lines across orders — same title+price collapses into one row.
      const lineMap = new Map<
        string,
        { title: unknown; quantity: number; canceledQuantity: number; lineTotalAmount: number }
      >();
      const adjustments = [] as Array<{ kind: unknown; label: unknown; amount: number; orders: string[] }>;
      const payments = [] as Array<Record<string, unknown>>;
      const totals = {
        currency: 'VND',
        subtotal: 0,
        adjustment: 0,
        fulfillment: 0,
        tax: 0,
        total: 0,
        paid: 0,
        refunded: 0,
        due: 0,
      };
      const orderCodes: string[] = [];
      for (const receipt of receipts) {
        orderCodes.push(receipt.order.code);
        const t = receipt.totals;
        totals.currency = t.currency;
        totals.subtotal += t.subtotal;
        totals.adjustment += t.adjustment;
        totals.fulfillment += t.fulfillment;
        totals.tax += t.tax;
        totals.total += t.total;
        totals.paid += t.paid;
        totals.refunded += t.refunded;
        totals.due += t.due;
        for (const line of receipt.lines) {
          const key = JSON.stringify([line.title, line.unitAmount, line.optionAmount]);
          const existing = lineMap.get(key);
          if (existing) {
            existing.quantity += line.quantity;
            existing.canceledQuantity += line.canceledQuantity;
            existing.lineTotalAmount += line.lineTotalAmount;
          } else {
            lineMap.set(key, {
              title: line.title,
              quantity: line.quantity,
              canceledQuantity: line.canceledQuantity,
              lineTotalAmount: line.lineTotalAmount,
            });
          }
        }
        for (const adjustment of receipt.adjustments) {
          const same = adjustments.find(
            (row) => row.kind === adjustment.kind && JSON.stringify(row.label) === JSON.stringify(adjustment.label),
          );
          if (same) {
            same.amount += adjustment.amount;
            same.orders.push(receipt.order.code);
          } else {
            adjustments.push({ ...adjustment, orders: [receipt.order.code] });
          }
        }
        payments.push(
          ...receipt.payments.map((payment) => ({ ...payment, orderCode: receipt.order.code })),
        );
      }
      return {
        doc: 'receipt' as const,
        session: {
          id: session.id,
          businessDate: session.businessDate,
          openedAt: session.openedAt,
          closedAt: session.closedAt,
          table: session.table
            ? { code: session.table.code, name: session.table.name, area: session.table.area }
            : null,
        },
        width: printing.width,
        header: printing.header ?? null,
        footer: printing.footer ?? null,
        branch: receipts[0]?.branch ?? {
          code: session.locationRef,
          name: session.locationRef,
          phone: branch?.phone ?? null,
          timezone: branch?.timezone ?? 'Asia/Ho_Chi_Minh',
        },
        orderCodes,
        lines: [...lineMap.values()],
        adjustments,
        totals,
        payments,
      };
    },
  };
};

export default print;
