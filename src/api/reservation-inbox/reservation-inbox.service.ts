import type { Core } from '@strapi/strapi';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import { ReservationInboxError } from './reservation-inbox.error';
import {
  ReservationInboxErrorCode,
  RESERVATION_INBOX_PAGE_SIZE,
  RESERVATION_INBOX_SUMMARY_LIMIT,
  RESERVATION_MENU_SELECTION_MODES,
  RESERVATION_STATUSES,
  type ReservationInboxDetail,
  type ReservationStatus,
} from './reservation-inbox.types';

const UID = 'api::reservation-request.reservation-request' as const;

const ITEM_FIELDS = [
  'documentId',
  'fullName',
  'phone',
  'guestCount',
  'preferredDate',
  'preferredTime',
  'overlapCount',
  'createdAt',
] as const;

const LIST_FIELDS = [...ITEM_FIELDS, 'leadStatus'] as const;

export interface ReservationInboxListQuery {
  /** Omitted = every status. */
  status?: ReservationStatus;
  /** Free text matched against customer name and phone. */
  search?: string;
  page: number;
}

export interface ReservationInboxListItem extends ReservationInboxItem {
  status: ReservationStatus;
}

export interface ReservationInboxListResult {
  items: ReservationInboxListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Per-status totals, independent of the active filters. */
  counts: Record<ReservationStatus, number>;
}

export interface ReservationInboxSummaryQuery {
  /** ISO-8601 lower bound (exclusive) on createdAt; already validated upstream. */
  since?: string;
  limit?: number;
}

interface ReservationInboxRow {
  documentId?: unknown;
  fullName?: unknown;
  phone?: unknown;
  guestCount?: unknown;
  preferredDate?: unknown;
  preferredTime?: unknown;
  overlapCount?: unknown;
  createdAt?: unknown;
}

const toIsoString = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const toInboxItem = (row: ReservationInboxRow): ReservationInboxItem => ({
  documentId: String(row.documentId ?? ''),
  fullName: String(row.fullName ?? ''),
  phone: String(row.phone ?? ''),
  guestCount: typeof row.guestCount === 'number' ? row.guestCount : Number(row.guestCount ?? 0),
  preferredDate: String(row.preferredDate ?? ''),
  preferredTime: String(row.preferredTime ?? ''),
  overlapCount:
    typeof row.overlapCount === 'number' ? row.overlapCount : Number(row.overlapCount ?? 0),
  createdAt: toIsoString(row.createdAt),
});

const toCount = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value ?? 0);

const toStatus = (value: unknown): ReservationStatus =>
  RESERVATION_STATUSES.find((status) => status === value) ?? 'new';

const DETAIL_FIELDS = [
  ...ITEM_FIELDS,
  'email',
  'occasion',
  'note',
  'menuSelectionMode',
  'sourceLocale',
  'sourcePath',
  'leadStatus',
  'staffNote',
] as const;

interface ReservationDetailRow extends ReservationInboxRow {
  email?: unknown;
  occasion?: unknown;
  note?: unknown;
  menuSelectionMode?: unknown;
  sourceLocale?: unknown;
  sourcePath?: unknown;
  leadStatus?: unknown;
  staffNote?: unknown;
  menuPackages?: unknown;
  menuItems?: unknown;
}

const toOptionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const toNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => toOptionalText((entry as { name?: unknown } | null)?.name))
        .filter((name): name is string => name !== null)
    : [];

const notFound = (documentId: string): ReservationInboxError =>
  new ReservationInboxError(
    ReservationInboxErrorCode.NotFound,
    `Reservation request ${documentId} was not found.`,
    'Không tìm thấy yêu cầu đặt bàn này.',
  );

// Rows saved before the status column existed hold NULL. They are unhandled
// requests, so every "new" query matches them too (as toStatus already does).
const NEW_STATUS_FILTER = { $or: [{ leadStatus: 'new' as const }, { leadStatus: { $null: true } }] };

const statusFilter = (status: ReservationStatus): Record<string, unknown> =>
  status === 'new' ? NEW_STATUS_FILTER : { leadStatus: status };

export const createReservationInboxService = (strapi: Core.Strapi) => ({
  async summary(query: ReservationInboxSummaryQuery): Promise<{
    items: ReservationInboxItem[];
    unreadCount: number;
  }> {
    const filters: Record<string, unknown> = { ...NEW_STATUS_FILTER };
    if (query.since) {
      filters.createdAt = { $gt: query.since };
    }

    const [rows, unreadCount] = await Promise.all([
      strapi.documents(UID).findMany({
        filters,
        fields: [...ITEM_FIELDS],
        sort: 'createdAt:desc',
        limit: query.limit ?? RESERVATION_INBOX_SUMMARY_LIMIT,
      }),
      // unreadCount is the full backlog regardless of the `since` window.
      strapi.documents(UID).count({ filters: NEW_STATUS_FILTER }),
    ]);

    return {
      items: (rows as unknown as ReservationInboxRow[]).map(toInboxItem),
      unreadCount: typeof unreadCount === 'number' ? unreadCount : Number(unreadCount ?? 0),
    };
  },

  async list(query: ReservationInboxListQuery): Promise<ReservationInboxListResult> {
    const clauses: Record<string, unknown>[] = [];
    if (query.status) {
      clauses.push(statusFilter(query.status));
    }
    if (query.search) {
      clauses.push({
        $or: [
          { fullName: { $containsi: query.search } },
          { phone: { $containsi: query.search } },
        ],
      });
    }
    const filters = clauses.length > 0 ? { $and: clauses } : {};

    const [rows, total, ...statusCounts] = await Promise.all([
      strapi.documents(UID).findMany({
        filters,
        fields: [...LIST_FIELDS],
        sort: 'createdAt:desc',
        limit: RESERVATION_INBOX_PAGE_SIZE,
        start: (query.page - 1) * RESERVATION_INBOX_PAGE_SIZE,
      }),
      strapi.documents(UID).count({ filters }),
      ...RESERVATION_STATUSES.map((status) =>
        strapi.documents(UID).count({ filters: statusFilter(status) }),
      ),
    ]);

    const totalCount = toCount(total);
    const counts = Object.fromEntries(
      RESERVATION_STATUSES.map((status, index) => [status, toCount(statusCounts[index])]),
    ) as Record<ReservationStatus, number>;
    return {
      items: (rows as unknown as Array<ReservationInboxRow & { leadStatus?: unknown }>).map(
        (row) => ({ ...toInboxItem(row), status: toStatus(row.leadStatus) }),
      ),
      total: totalCount,
      page: query.page,
      pageSize: RESERVATION_INBOX_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(totalCount / RESERVATION_INBOX_PAGE_SIZE)),
      counts,
    };
  },

  async detail(documentId: string): Promise<ReservationInboxDetail> {
    const row = (await strapi.documents(UID).findOne({
      documentId,
      fields: [...DETAIL_FIELDS],
      populate: {
        menuPackages: { fields: ['name'] },
        menuItems: { fields: ['name'] },
      },
    })) as unknown as ReservationDetailRow | null;
    if (!row) {
      throw notFound(documentId);
    }

    return {
      ...toInboxItem(row),
      email: toOptionalText(row.email),
      occasion: toOptionalText(row.occasion),
      note: toOptionalText(row.note),
      menuSelectionMode:
        RESERVATION_MENU_SELECTION_MODES.find((mode) => mode === row.menuSelectionMode) ?? null,
      menuPackageNames: toNames(row.menuPackages),
      menuItemNames: toNames(row.menuItems),
      sourceLocale: toOptionalText(row.sourceLocale),
      sourcePath: toOptionalText(row.sourcePath),
      status: toStatus(row.leadStatus),
      staffNote: toOptionalText(row.staffNote),
    };
  },

  async setStatus(
    documentId: string,
    status: ReservationStatus,
  ): Promise<{ documentId: string; status: string }> {
    const existing = await strapi.documents(UID).findOne({
      documentId,
      fields: ['documentId', 'leadStatus'],
    });
    if (!existing) {
      throw notFound(documentId);
    }

    const updated = (await strapi.documents(UID).update({
      documentId,
      data: { leadStatus: status },
      fields: ['documentId', 'leadStatus'],
    })) as unknown as { documentId?: unknown; leadStatus?: unknown } | null;

    return {
      documentId: String(updated?.documentId ?? documentId),
      status: String(updated?.leadStatus ?? status),
    };
  },

  async setNote(
    documentId: string,
    note: string | null,
  ): Promise<{ documentId: string; staffNote: string | null }> {
    const existing = await strapi.documents(UID).findOne({ documentId, fields: ['documentId'] });
    if (!existing) {
      throw notFound(documentId);
    }

    const staffNote = note?.trim() ? note.trim() : null;
    const updated = (await strapi.documents(UID).update({
      documentId,
      // Strapi clears a text field with null; the generated type omits null.
      data: { staffNote } as { staffNote: string },
      fields: ['documentId', 'staffNote'],
    })) as unknown as { documentId?: unknown; staffNote?: unknown } | null;

    return {
      documentId: String(updated?.documentId ?? documentId),
      staffNote: toOptionalText(updated?.staffNote),
    };
  },

  async markRead(documentId: string): Promise<{ documentId: string; status: string }> {
    return this.setStatus(documentId, 'read');
  },
});
