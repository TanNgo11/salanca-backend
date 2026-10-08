import type { Core } from '@strapi/strapi';

import { LeadExportError, createLeadExportService } from './lead-export.service';
import {
  LEAD_EXPORT_FILE_PREFIX,
  LEAD_EXPORT_KINDS,
  type LeadExportKind,
  type LeadExportQuery,
} from './lead-export.types';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface LeadExportContext {
  params?: { kind?: unknown };
  query?: unknown;
  body: unknown;
  set: (name: string, value: string) => void;
  badRequest: (message: string) => void;
  internalServerError: (message: string) => void;
}

const invalid = (vietnameseMessage: string): LeadExportError =>
  new LeadExportError('INVALID_QUERY', vietnameseMessage, vietnameseMessage);

const parseDay = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !DAY_PATTERN.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw invalid('Ngày không hợp lệ. Dùng định dạng YYYY-MM-DD.');
  }
  return value;
};

const parseQuery = (context: LeadExportContext): LeadExportQuery => {
  const kind = LEAD_EXPORT_KINDS.find((candidate) => candidate === context.params?.kind);
  if (!kind) throw invalid('Loại dữ liệu không hợp lệ.');
  const raw = (context.query ?? {}) as Record<string, unknown>;
  const from = parseDay(raw.from);
  const to = parseDay(raw.to);
  if (from && to && from > to) throw invalid('Ngày bắt đầu phải trước ngày kết thúc.');
  return { kind, ...(from ? { from } : {}), ...(to ? { to } : {}) };
};

const fileName = (kind: LeadExportKind, from?: string, to?: string): string =>
  `${LEAD_EXPORT_FILE_PREFIX[kind]}-${from ?? 'dau'}_${to ?? 'nay'}.csv`;

export const createLeadExportController = (strapi: Core.Strapi) => {
  const service = createLeadExportService(strapi);

  return {
    async exportCsv(context: LeadExportContext): Promise<void> {
      try {
        const query = parseQuery(context);
        const csv = await service.exportCsv(query);
        context.set('Content-Type', 'text/csv; charset=utf-8');
        context.set(
          'Content-Disposition',
          `attachment; filename="${fileName(query.kind, query.from, query.to)}"`,
        );
        context.body = csv;
      } catch (error) {
        if (error instanceof LeadExportError) {
          context.badRequest(error.vietnameseMessage);
          return;
        }
        strapi.log.error('Lead export failed.', { error });
        context.internalServerError('Không thể xuất dữ liệu lúc này. Vui lòng thử lại sau.');
      }
    },
  };
};
