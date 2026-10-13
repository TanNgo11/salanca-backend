import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { resolvePrinting } from '../domain/branch-settings';
import { maskPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { resolveLocalizedText } from '../domain/catalog/localized-text';
import type adminOrdersFactory from './admin-orders';
import type branchFactory from './branch';
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
  };
};

export default print;
