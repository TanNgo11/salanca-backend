import type { Core } from '@strapi/strapi';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import { ReservationInboxError } from './reservation-inbox.error';
import {
  ReservationInboxErrorCode,
  RESERVATION_INBOX_SUMMARY_LIMIT,
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

  async markRead(documentId: string): Promise<{ documentId: string; status: string }> {
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
      data: { status: 'read' },
      fields: ['documentId', 'status'],
    })) as unknown as { documentId?: unknown; status?: unknown } | null;

    return {
      documentId: String(updated?.documentId ?? documentId),
      status: String(updated?.status ?? 'read'),
    };
  },
});
