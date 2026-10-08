import type { Core } from '@strapi/strapi';

import { buildCsv } from '../../shared/csv/csv';
import {
  CONTACT_CSV_HEADERS,
  NEWSLETTER_CSV_HEADERS,
  RESERVATION_CSV_HEADERS,
  contactRow,
  newsletterRow,
  reservationRow,
} from './lead-export.mapper';
import { LEAD_EXPORT_MAX_ROWS, type LeadExportKind, type LeadExportQuery } from './lead-export.types';

export class LeadExportError extends Error {
  constructor(
    readonly code: 'INVALID_QUERY' | 'EXPORT_TOO_LARGE',
    message: string,
    readonly vietnameseMessage: string,
  ) {
    super(message);
  }
}

const RESERVATION_UID = 'api::reservation-request.reservation-request' as const;
const CONTACT_UID = 'api::contact-message.contact-message' as const;

const VIETNAM_OFFSET = '+07:00';

/** Start of a Vietnam calendar day as a UTC ISO string. */
const vietnamDayStart = (day: string): string =>
  new Date(`${day}T00:00:00${VIETNAM_OFFSET}`).toISOString();

const nextDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

// Newsletter sign-ups are contact messages with topic "newsletter" (salanca-web
// newsletter-action.ts); the contacts export leaves them out.
const KIND_FILTER: Record<LeadExportKind, Record<string, unknown> | null> = {
  reservations: null,
  newsletter: { topic: { $eq: 'newsletter' } },
  contacts: { $or: [{ topic: { $ne: 'newsletter' } }, { topic: { $null: true } }] },
};

export const buildLeadExportFilters = (query: LeadExportQuery): Record<string, unknown> => {
  const clauses: Record<string, unknown>[] = [];
  const kindFilter = KIND_FILTER[query.kind];
  if (kindFilter) clauses.push(kindFilter);
  if (query.from) clauses.push({ createdAt: { $gte: vietnamDayStart(query.from) } });
  if (query.to) clauses.push({ createdAt: { $lt: vietnamDayStart(nextDay(query.to)) } });
  return clauses.length > 0 ? { $and: clauses } : {};
};

const SOURCES = {
  reservations: {
    uid: RESERVATION_UID,
    headers: RESERVATION_CSV_HEADERS,
    toRow: reservationRow,
    populate: { menuPackages: { fields: ['name'] }, menuItems: { fields: ['name'] } },
  },
  contacts: { uid: CONTACT_UID, headers: CONTACT_CSV_HEADERS, toRow: contactRow, populate: undefined },
  newsletter: {
    uid: CONTACT_UID,
    headers: NEWSLETTER_CSV_HEADERS,
    toRow: newsletterRow,
    populate: undefined,
  },
} as const;

export const createLeadExportService = (strapi: Core.Strapi) => ({
  async exportCsv(query: LeadExportQuery): Promise<string> {
    const source = SOURCES[query.kind];
    const filters = buildLeadExportFilters(query);
    const documents = strapi.documents(source.uid);

    const total = Number(await documents.count({ filters } as never));
    if (total > LEAD_EXPORT_MAX_ROWS) {
      throw new LeadExportError(
        'EXPORT_TOO_LARGE',
        `Lead export matched ${total} rows.`,
        `Kết quả vượt quá ${LEAD_EXPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng. Hãy chọn khoảng ngày ngắn hơn.`,
      );
    }

    const rows = (await documents.findMany({
      filters,
      sort: 'createdAt:asc',
      limit: LEAD_EXPORT_MAX_ROWS,
      ...(source.populate ? { populate: source.populate } : {}),
    } as never)) as unknown as Record<string, unknown>[];

    return buildCsv(source.headers, rows.map(source.toRow));
  },
});
