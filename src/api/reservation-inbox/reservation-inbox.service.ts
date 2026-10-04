import type { Core } from '@strapi/strapi';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import { ReservationInboxError } from './reservation-inbox.error';
import {
  ReservationInboxErrorCode,
  RESERVATION_INBOX_PAGE_SIZE,
  RESERVATION_INBOX_SUMMARY_LIMIT,
  RESERVATION_STATUSES,
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

const LIST_FIELDS = [...ITEM_FIELDS, 'status'] as const;

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

export const createReservationInboxService = (strapi: Core.Strapi) => ({
  async summary(query: ReservationInboxSummaryQuery): Promise<{
    items: ReservationInboxItem[];
    unreadCount: number;
  }> {
    const filters: Record<string, unknown> = { status: 'new' };
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
      strapi.documents(UID).count({ filters: { status: 'new' } }),
    ]);

    return {
      items: (rows as unknown as ReservationInboxRow[]).map(toInboxItem),
      unreadCount: typeof unreadCount === 'number' ? unreadCount : Number(unreadCount ?? 0),
    };
  },

  async list(query: ReservationInboxListQuery): Promise<ReservationInboxListResult> {
    const filters: Record<string, unknown> = {};
    if (query.status) {
      filters.status = query.status;
    }
    if (query.search) {
      filters.$or = [
        { fullName: { $containsi: query.search } },
        { phone: { $containsi: query.search } },
      ];
    }

    const [rows, total, newCount, readCount, archivedCount] = await Promise.all([
      strapi.documents(UID).findMany({
        filters,
        fields: [...LIST_FIELDS],
        sort: 'createdAt:desc',
        limit: RESERVATION_INBOX_PAGE_SIZE,
        start: (query.page - 1) * RESERVATION_INBOX_PAGE_SIZE,
      }),
      strapi.documents(UID).count({ filters }),
      ...RESERVATION_STATUSES.map((status) =>
        strapi.documents(UID).count({ filters: { status } }),
      ),
    ]);

    const totalCount = toCount(total);
    return {
      items: (rows as unknown as Array<ReservationInboxRow & { status?: unknown }>).map(
        (row) => ({ ...toInboxItem(row), status: toStatus(row.status) }),
      ),
      total: totalCount,
      page: query.page,
      pageSize: RESERVATION_INBOX_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(totalCount / RESERVATION_INBOX_PAGE_SIZE)),
      counts: {
        new: toCount(newCount),
        read: toCount(readCount),
        archived: toCount(archivedCount),
      },
    };
  },

  async setStatus(
    documentId: string,
    status: ReservationStatus,
  ): Promise<{ documentId: string; status: string }> {
    const existing = await strapi.documents(UID).findOne({
      documentId,
      fields: ['documentId', 'status'],
    });
    if (!existing) {
      throw new ReservationInboxError(
        ReservationInboxErrorCode.NotFound,
        `Reservation request ${documentId} was not found.`,
        'Không tìm thấy yêu cầu đặt bàn này.',
      );
    }

    const updated = (await strapi.documents(UID).update({
      documentId,
      data: { status },
      fields: ['documentId', 'status'],
    })) as unknown as { documentId?: unknown; status?: unknown } | null;

    return {
      documentId: String(updated?.documentId ?? documentId),
      status: String(updated?.status ?? status),
    };
  },

  async markRead(documentId: string): Promise<{ documentId: string; status: string }> {
    return this.setStatus(documentId, 'read');
  },
});
