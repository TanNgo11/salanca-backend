import type { Core } from '@strapi/strapi';

import {
  ORDER_EXPORT_MAX_DAYS,
  ORDER_EXPORT_MAX_ROWS,
} from '../../../shared/export-limits';
import { buildCsv } from '../domain/csv';
import { OrderingError } from '../domain/errors';
import type { BranchRow } from './branch';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import type scopeFactory from './scope';

/**
 * Order CSV export (O6 V5). The file carries customer names/phones/addresses — it is
 * produced only for the `export` action, limited to ORDER_EXPORT_MAX_DAYS days and
 * ORDER_EXPORT_MAX_ROWS rows, and logs counts only, never row content.
 */
type Services = {
  scope: ReturnType<typeof scopeFactory>;
  branch: ReturnType<typeof branchFactory>;
};

type OrderLineRow = {
  titleSnapshot?: string | null;
  quantity?: number | null;
  canceledQuantity?: number | null;
  selectedOptionsSnapshot?: unknown;
};

type OrderRow = {
  code: string;
  businessDate: string;
  placedAt: string | Date;
  locationRef: string;
  status: string;
  paymentStatus: string;
  receiveMethod: unknown;
  contactSnapshot: unknown;
  customerNote: string | null;
  subtotalAmount: string | number;
  adjustmentAmount: string | number;
  fulfillmentAmount: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
  origin: unknown;
  consentSnapshot: unknown;
  lines?: OrderLineRow[];
  payments?: Array<{ providerCode?: string; status?: string; capturedAmount?: string | number }>;
  refunds?: Array<{ status?: string; amount?: string | number }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const HEADERS = [
  'Mã đơn',
  'Ngày kinh doanh',
  'Đặt lúc',
  'Chi nhánh',
  'Trạng thái',
  'Thanh toán',
  'Cách nhận',
  'Giờ nhận/giao',
  'Tên khách',
  'Số điện thoại',
  'Email',
  'Địa chỉ giao',
  'Món',
  'Tạm tính',
  'Giảm/phụ phí',
  'Phí giao',
  'Thuế',
  'Tổng',
  'Đã thu',
  'Đã hoàn',
  'Cách trả',
  'Ghi chú khách',
  'Nguồn',
  'Đồng ý chính sách',
] as const;

const int = (value: string | number | null | undefined): number => Number(value ?? 0);

const dayOf = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, {
      details: { field },
    });
  }
  return value;
};

const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** dd/MM/yyyy HH:mm in the branch timezone — the way staff read the order in Admin. */
const branchTime = (instant: string | Date | undefined, timezone: string): string => {
  if (!instant) return '';
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: string) => parts.find((value) => value.type === name)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
};

const addressText = (receiveMethod: unknown): string => {
  const address = objectOf(objectOf(receiveMethod).address);
  if (Object.keys(address).length === 0) return '';
  const pieces = [address.line1, address.wardName, address.provinceName]
    .filter((piece): piece is string => typeof piece === 'string' && piece !== '');
  return pieces.join(', ');
};

const receiveAtText = (receiveMethod: unknown, timezone: string): string => {
  const timing = objectOf(objectOf(receiveMethod).timing);
  const startsAt = objectOf(timing.slot).startsAt;
  if (typeof startsAt === 'string' && startsAt !== '') {
    return branchTime(startsAt, timezone);
  }
  return 'ASAP';
};

const lineText = (lines: OrderLineRow[]): string =>
  lines
    .map((line) => {
      const remaining = Number(line.quantity ?? 0) - Number(line.canceledQuantity ?? 0);
      if (remaining <= 0) return null;
      const options = Array.isArray(line.selectedOptionsSnapshot)
        ? (line.selectedOptionsSnapshot as Array<{ optionName?: unknown }>)
            .map((option) => (typeof option.optionName === 'string' ? option.optionName : ''))
            .filter(Boolean)
        : [];
      const suffix = options.length > 0 ? ` (${options.join(', ')})` : '';
      return `${remaining}× ${line.titleSnapshot ?? ''}${suffix}`.trim();
    })
    .filter((text): text is string => text !== null)
    .join('; ');

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => ({
    scope: strapi.plugin('ordering').service('scope') as Services['scope'],
    branch: strapi.plugin('ordering').service('branch') as Services['branch'],
  });
  const orders = () => strapi.db.query('plugin::ordering.order');

  const scopedLocations = async (
    branchCode: string | undefined,
    ctx: ServiceContext,
  ): Promise<string[] | null> => {
    const { scope, branch } = services();
    const staffScope = await scope.loadScope(ctx);
    if (staffScope === null) {
      throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    }
    if (branchCode !== undefined && branchCode !== '') {
      scope.assertLocationInScope(staffScope, branchCode);
      const row = await branch.findByCode(branchCode);
      if (!row) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found');
      }
      return [branchCode];
    }
    return staffScope.allLocations ? null : [...staffScope.locationRefs];
  };

  return {
    /**
     * CSV of every non-draft order whose business date falls inside the range, scoped to the
     * caller's branches. `maxRows` is injectable so the cap is testable without 10k fixtures.
     */
    async exportCsv(
      input: { from?: string; to?: string; branch?: string; maxRows?: number },
      ctx: ServiceContext,
    ): Promise<{ csv: string; rowCount: number; fileName: string }> {
      const from = dayOf(input.from, 'from');
      const to = dayOf(input.to, 'to');
      const span =
        Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
      if (from > to || span > ORDER_EXPORT_MAX_DAYS) {
        throw new OrderingError('VALIDATION_ERROR', 'export range is invalid (max 92 days)', {
          details: { field: 'to' },
        });
      }
      const maxRows = input.maxRows ?? ORDER_EXPORT_MAX_ROWS;
      const locations = await scopedLocations(input.branch, ctx);
      const where: Record<string, unknown> = {
        status: { $ne: 'draft' },
        businessDate: { $gte: from, $lte: to },
        ...(locations === null ? {} : { locationRef: { $in: locations } }),
      };
      const count = await orders().count({ where });
      if (count > maxRows) {
        throw new OrderingError('EXPORT_TOO_LARGE', 'export exceeds the row limit', {
          details: { rowCount: count, maxRows },
        });
      }
      const rows = (await orders().findMany({
        where,
        orderBy: { placedAt: 'asc' },
        limit: maxRows,
        populate: { lines: true, payments: true, refunds: true },
      })) as OrderRow[];

      const branches = new Map(
        ((await services().branch.list()) as BranchRow[]).map((row) => [row.code, row]),
      );
      const cells = rows.map((order) => {
        const branchRow = branches.get(order.locationRef);
        const timezone = branchRow?.timezone ?? 'Asia/Ho_Chi_Minh';
        const contact = objectOf(order.contactSnapshot);
        const consent = objectOf(order.consentSnapshot);
        const origin = objectOf(order.origin);
        const payments = order.payments ?? [];
        const refunds = order.refunds ?? [];
        const captured = payments
          .filter((payment) => payment.status === 'captured')
          .reduce((sum, payment) => sum + int(payment.capturedAmount), 0);
        const refunded = refunds
          .filter((refund) => refund.status === 'settled')
          .reduce((sum, refund) => sum + int(refund.amount), 0);
        const providers = [...new Set(
          payments
            .filter((payment) => payment.status === 'captured')
            .map((payment) => payment.providerCode)
            .filter((code): code is string => typeof code === 'string'),
        )];
        return [
          order.code,
          String(order.businessDate),
          branchTime(order.placedAt, timezone),
          order.locationRef,
          order.status,
          order.paymentStatus,
          objectOf(order.receiveMethod).kind as string ?? '',
          receiveAtText(order.receiveMethod, timezone),
          (contact.name as string) ?? '',
          (contact.phone as string) ?? '',
          (contact.email as string) ?? '',
          addressText(order.receiveMethod),
          lineText(order.lines ?? []),
          String(int(order.subtotalAmount)),
          String(int(order.adjustmentAmount)),
          String(int(order.fulfillmentAmount)),
          String(int(order.taxAmount)),
          String(int(order.totalAmount)),
          String(captured),
          String(refunded),
          providers.join(','),
          order.customerNote ?? '',
          (origin.kind as string) ?? '',
          (consent.policyVersion as string) ?? '',
        ];
      });

      strapi.log.info(`[ordering] order export rows=${rows.length} range=${from}..${to}`);
      return {
        csv: buildCsv(HEADERS, cells),
        rowCount: rows.length,
        fileName: `don-hang-${input.branch ?? 'tat-ca'}-${from}_${to}.csv`,
      };
    },
  };
};
