import type { Core } from '@strapi/strapi';

import { AuditEventCategory, AuditEventSource } from '../../domain/audit/audit-event.types';
import { defaultAuditLogDateRange } from './audit-log.date';
import { AuditLogError } from './audit-log.error';
import { buildAuditLogCsv } from './audit-log.export';
import { actionsMatchingQuery, toAuditLogDetail, toAuditLogSummary } from './audit-log.mapper';
import {
  AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL,
  AUDIT_LOG_TARGET_LABEL_PREFIX_SQL,
  escapePrefixSearch,
} from './audit-log.query';
import {
  AUDIT_LOG_MAX_EXPORT_ROWS,
  AuditLogErrorCode,
  type ApiAuditLogDetail,
  type ApiAuditLogListQuery,
  type ApiAuditLogListResponse,
  type AuditLogStoredRow,
} from './audit-log.types';

const TABLE = 'audit_events';

export const AUDIT_LOG_SELECT_COLUMNS = [
  'action',
  'actor_document_id as actorDocumentId',
  'actor_label as actorLabel',
  'actor_type as actorType',
  'after_values as afterValues',
  'before_values as beforeValues',
  'event_id as eventId',
  'event_source as eventSource',
  'http_method as httpMethod',
  'occurred_at as occurredAt',
  'request_id as requestId',
  'request_path as requestPath',
  'status_code as statusCode',
  'success',
  'target_document_id as targetDocumentId',
  'target_label as targetLabel',
  'target_type as targetType',
  'target_uid as targetUid',
] as const;

interface AuditLogQueryBuilder {
  andWhere: (callback: (inner: AuditLogQueryBuilder) => void) => AuditLogQueryBuilder;
  clone: () => AuditLogQueryBuilder;
  count: <T>(expression: Record<string, string>) => Promise<T>;
  first: () => Promise<Record<string, unknown> | undefined>;
  limit: (value: number) => AuditLogQueryBuilder;
  offset: (value: number) => AuditLogQueryBuilder;
  orWhere: (column: string, value: string) => AuditLogQueryBuilder;
  orWhereRaw: (sql: string, bindings: readonly string[]) => AuditLogQueryBuilder;
  orderBy: (column: string, direction: 'desc') => AuditLogQueryBuilder;
  select: (columns: readonly string[]) => AuditLogQueryBuilder;
  then: Promise<Record<string, unknown>[]>['then'];
  where: (
    column: string,
    operatorOrValue: string | boolean,
    value?: string | boolean,
  ) => AuditLogQueryBuilder;
  whereIn: (column: string, values: readonly string[]) => AuditLogQueryBuilder;
  whereRaw: (sql: string, bindings?: readonly string[]) => AuditLogQueryBuilder;
}

interface AuditLogConnection {
  (table: string): AuditLogQueryBuilder;
}

const applyListFilters = (
  builder: AuditLogQueryBuilder,
  query: ApiAuditLogListQuery,
): AuditLogQueryBuilder => {
  const from = query.from ?? defaultAuditLogDateRange().from;
  const toExclusive = query.toExclusive ?? defaultAuditLogDateRange().toExclusive;
  builder.where('occurred_at', '>=', from).where('occurred_at', '<', toExclusive);

  const actions = actionsMatchingQuery(query);
  if (actions) {
    if (actions.length === 0) {
      builder.whereRaw('1 = 0');
    } else {
      builder.whereIn('action', actions);
    }
  }

  if (query.category === AuditEventCategory.Error || query.success === false) {
    builder.where('success', false);
  } else if (query.success === true) {
    builder.where('success', true);
  }

  if (query.eventSource) {
    builder.where('event_source', query.eventSource);
  }

  const search = query.search?.trim();
  if (search) {
    const prefix = `${escapePrefixSearch(search.toLocaleLowerCase('vi-VN'))}%`;
    builder.andWhere((inner) => {
      inner
        .where('event_id', search)
        .orWhere('request_id', search)
        .orWhere('target_document_id', search)
        .orWhereRaw(AUDIT_LOG_ACTOR_LABEL_PREFIX_SQL, [prefix, '\\'])
        .orWhereRaw(AUDIT_LOG_TARGET_LABEL_PREFIX_SQL, [prefix, '\\']);
    });
  }

  return builder;
};

const mapRow = (row: Record<string, unknown>): AuditLogStoredRow => ({
  action: String(row.action ?? ''),
  actorDocumentId: typeof row.actorDocumentId === 'string' ? row.actorDocumentId : null,
  actorLabel: typeof row.actorLabel === 'string' ? row.actorLabel : null,
  actorType: typeof row.actorType === 'string' ? row.actorType : null,
  afterValues: row.afterValues ?? null,
  beforeValues: row.beforeValues ?? null,
  eventId: String(row.eventId ?? ''),
  eventSource: typeof row.eventSource === 'string' ? row.eventSource : null,
  httpMethod: String(row.httpMethod ?? ''),
  occurredAt: (row.occurredAt as Date | string) ?? new Date().toISOString(),
  requestId: String(row.requestId ?? ''),
  requestPath: typeof row.requestPath === 'string' ? row.requestPath : null,
  statusCode: typeof row.statusCode === 'number' ? row.statusCode : Number(row.statusCode ?? 0),
  success: row.success === true,
  targetDocumentId: typeof row.targetDocumentId === 'string' ? row.targetDocumentId : null,
  targetLabel: typeof row.targetLabel === 'string' ? row.targetLabel : null,
  targetType: typeof row.targetType === 'string' ? row.targetType : null,
  targetUid: typeof row.targetUid === 'string' ? row.targetUid : null,
});

const categoryLabel = (source: AuditEventSource | string): string => {
  switch (source) {
    case AuditEventSource.AdminPanel:
      return 'Admin';
    case AuditEventSource.SystemProcess:
      return 'Hệ thống';
    default:
      return 'Chưa xác định';
  }
};

export const createAuditLogService = (strapi: Core.Strapi) => {
  const connection = strapi.db.connection as unknown as AuditLogConnection;

  const listQuery = (query: ApiAuditLogListQuery) =>
    applyListFilters(connection(TABLE), query);

  return {
    async find(query: ApiAuditLogListQuery): Promise<ApiAuditLogListResponse> {
      const offset = (query.page - 1) * query.pageSize;
      const [rows, countRow] = await Promise.all([
        listQuery(query)
          .clone()
          .select(AUDIT_LOG_SELECT_COLUMNS)
          .orderBy('occurred_at', 'desc')
          .limit(query.pageSize)
          .offset(offset),
        listQuery(query).clone().count<{ count: string | number }[]>({ count: '*' }),
      ]);

      const total = Number(countRow[0]?.count ?? 0);
      const data = rows.map((row) => toAuditLogSummary(mapRow(row)));

      return {
        data,
        meta: {
          pagination: {
            page: query.page,
            pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
            pageSize: query.pageSize,
            total,
          },
        },
      };
    },

    async findOne(eventId: string): Promise<ApiAuditLogDetail> {
      const row = await connection(TABLE).select(AUDIT_LOG_SELECT_COLUMNS).where('event_id', eventId).first();
      if (!row) {
        throw new AuditLogError(
          AuditLogErrorCode.NotFound,
          `Audit event ${eventId} was not found.`,
          'Không tìm thấy nhật ký này.',
        );
      }
      return toAuditLogDetail(mapRow(row as Record<string, unknown>));
    },

    async exportCsv(query: ApiAuditLogListQuery): Promise<string> {
      const totalRow = await listQuery(query).clone().count<{ count: string | number }[]>({
        count: '*',
      });
      const total = Number(totalRow[0]?.count ?? 0);
      if (total > AUDIT_LOG_MAX_EXPORT_ROWS) {
        throw new AuditLogError(
          AuditLogErrorCode.ExportTooLarge,
          `Export matched ${total} rows.`,
          `Kết quả vượt quá ${AUDIT_LOG_MAX_EXPORT_ROWS.toLocaleString('vi-VN')} dòng. Hãy thu hẹp bộ lọc rồi xuất lại.`,
        );
      }

      const rows = await listQuery(query)
        .clone()
        .select(AUDIT_LOG_SELECT_COLUMNS)
        .orderBy('occurred_at', 'desc')
        .limit(AUDIT_LOG_MAX_EXPORT_ROWS);

      const csvRows = rows.map((raw) => {
        const summary = toAuditLogSummary(mapRow(raw));
        return [
          summary.occurredAt,
          summary.actorLabel,
          summary.category,
          summary.action,
          summary.targetLabel,
          categoryLabel(summary.eventSource),
          summary.success ? 'Thành công' : 'Thất bại',
        ];
      });

      return buildAuditLogCsv(csvRows);
    },
  };
};
