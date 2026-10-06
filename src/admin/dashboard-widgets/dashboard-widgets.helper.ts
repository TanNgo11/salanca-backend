import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';
import { contactMessageUid, reservationRequestUid } from '../lead-shortcuts/lead-shortcuts.helper';

export type LeadStatus = 'new' | 'read' | 'archived';

export type LeadFilter = Record<string, Record<string, string | number>>;

export interface LeadListQuery {
  filters?: LeadFilter;
  sort?: string;
  pageSize: number;
}

const contentManagerListPath = (uid: string): string =>
  `/content-manager/collection-types/${uid}`;

/**
 * Builds a Content Manager admin list URL. Filters use the bracket syntax the
 * admin API parses with `qs`, combined under `$and`.
 */
export const buildLeadListUrl = (uid: string, { filters, sort, pageSize }: LeadListQuery): string => {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('pageSize', String(pageSize));
  if (sort) {
    params.set('sort', sort);
  }
  Object.entries(filters ?? {}).forEach(([field, conditions], index) => {
    Object.entries(conditions).forEach(([operator, value]) => {
      params.set(`filters[$and][${index}][${field}][${operator}]`, String(value));
    });
  });
  return `${contentManagerListPath(uid)}?${params.toString()}`;
};

/**
 * Content Manager list view with filters pre-applied, for click-through. The
 * admin route and the admin API share the same path shape.
 */
export const leadListViewHref = (uid: string, filters?: LeadFilter): string =>
  buildLeadListUrl(uid, { filters, pageSize: 25, sort: 'createdAt:DESC' });

export const leadEditHref = (uid: string, documentId: string): string =>
  `${contentManagerListPath(uid)}/${encodeURIComponent(documentId)}`;

/** `YYYY-MM-DD` in the viewer's local time zone (staff work in Vietnam time). */
export const localDateKey = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const daysAgo = (now: Date, days: number): Date => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start;
};

const notArchived = { $ne: 'archived' };

interface LeadOverviewQueries {
  newReservations: string;
  guestsToday: string;
  newContacts: string;
  reservationsThisWeek: string;
}

export const buildLeadOverviewFilters = (now: Date) => {
  const today = localDateKey(now);
  return {
    newReservations: { leadStatus: { $eq: 'new' } },
    today: { preferredDate: { $eq: today }, leadStatus: notArchived },
    newContacts: { leadStatus: { $eq: 'new' } },
    lastSevenDays: { createdAt: { $gte: daysAgo(now, 6).toISOString() } },
  } satisfies Record<string, LeadFilter>;
};

export const buildLeadOverviewQueries = (now: Date): LeadOverviewQueries => {
  const filters = buildLeadOverviewFilters(now);
  return {
    newReservations: buildLeadListUrl(reservationRequestUid, {
      filters: filters.newReservations,
      pageSize: 1,
    }),
    // Today's bookings are few; one page is enough to sum guest counts.
    guestsToday: buildLeadListUrl(reservationRequestUid, {
      filters: filters.today,
      pageSize: 100,
    }),
    newContacts: buildLeadListUrl(contactMessageUid, {
      filters: filters.newContacts,
      pageSize: 1,
    }),
    reservationsThisWeek: buildLeadListUrl(reservationRequestUid, {
      filters: filters.lastSevenDays,
      pageSize: 1,
    }),
  };
};

export const buildUpcomingReservationsUrl = (now: Date, limit: number): string =>
  buildLeadListUrl(reservationRequestUid, {
    filters: {
      preferredDate: { $gte: localDateKey(now) },
      leadStatus: notArchived,
    },
    sort: 'preferredDate:ASC,preferredTime:ASC',
    pageSize: limit,
  });

export const buildLatestContactsUrl = (limit: number): string =>
  buildLeadListUrl(contactMessageUid, {
    filters: { leadStatus: notArchived },
    sort: 'createdAt:DESC',
    pageSize: limit,
  });

export const sumGuests = (rows: ReadonlyArray<{ guestCount?: number | null }>): number =>
  rows.reduce((total, row) => total + (row.guestCount ?? 0), 0);

export const leadStatusLabel: Record<LeadStatus, string> = {
  new: 'Mới',
  read: 'Đã xem',
  archived: 'Lưu trữ',
};

/** Same tone mapping as the reservation inbox chip, so status reads alike everywhere. */
export const leadStatusTone = (status: LeadStatus): InformationStatusChipTone => {
  switch (status) {
    case 'new':
      return InformationStatusChipTone.Info;
    case 'read':
      return InformationStatusChipTone.Published;
    default:
      return InformationStatusChipTone.Neutral;
  }
};

/** Short Vietnamese day label: "Hôm nay", "Ngày mai", or "T7 10/10". */
export const formatReservationDay = (dateKey: string, now: Date): string => {
  const today = localDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateKey === today) {
    return 'Hôm nay';
  }
  if (dateKey === localDateKey(tomorrow)) {
    return 'Ngày mai';
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) {
    return dateKey;
  }
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay() === 0 ? 'CN' : `T${date.getDay() + 1}`;
  return `${weekday} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
