import type {
  AuditAction,
  AuditEventCategory,
  AuditEventSource,
  AuditTargetType,
} from '../../domain/audit/audit-event.types';

export enum ApiAuditLogPermission {
  Read = 'admin::audit-log.read',
  Details = 'admin::audit-log.details',
  Export = 'admin::audit-log.export',
}

export enum ApiAuditLogRoute {
  Events = '/audit-log/events',
  Event = '/audit-log/events/:eventId',
  Export = '/audit-log/export',
}

export enum AuditLogErrorCode {
  ExportTooLarge = 'EXPORT_TOO_LARGE',
  Forbidden = 'FORBIDDEN',
  InvalidQuery = 'INVALID_QUERY',
  NotFound = 'NOT_FOUND',
  Unexpected = 'UNEXPECTED',
}

export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 25;
export const AUDIT_LOG_MAX_PAGE_SIZE = 50;
export const AUDIT_LOG_MAX_EXPORT_ROWS = 5_000;
export const AUDIT_LOG_SEARCH_MIN_LENGTH = 2;
export const AUDIT_LOG_SEARCH_MAX_LENGTH = 100;

export interface ApiAuditLogListQuery {
  action?: AuditAction;
  category?: AuditEventCategory;
  eventSource?: AuditEventSource;
  from?: string;
  page: number;
  pageSize: number;
  search?: string;
  success?: boolean;
  toExclusive?: string;
}

export interface ApiAuditLogSummary {
  action: AuditAction;
  actorLabel: string;
  actorType: string | null;
  category: AuditEventCategory;
  eventId: string;
  eventSource: AuditEventSource;
  occurredAt: string;
  success: boolean;
  targetId: string | null;
  targetLabel: string;
  targetType: AuditTargetType | null;
  targetUid: string | null;
}

export interface ApiAuditLogDetail extends ApiAuditLogSummary {
  afterValues: unknown;
  beforeValues: unknown;
  httpMethod: string;
  requestId: string;
  requestPath: string;
  statusCode: number;
}

export interface ApiAuditLogListResponse {
  data: readonly ApiAuditLogSummary[];
  meta: {
    pagination: {
      page: number;
      pageCount: number;
      pageSize: number;
      total: number;
    };
  };
}

export interface ApiAuditLogRequestContext {
  badRequest: (message: string) => void;
  body: unknown;
  forbidden: (message: string) => void;
  internalServerError: (message: string) => void;
  notFound?: (message: string) => void;
  params?: { eventId?: string };
  path: string;
  query?: unknown;
  request: { body?: unknown; header?: Record<string, string | string[] | undefined> };
  set: (name: string, value: string) => void;
  state: {
    requestId?: unknown;
    user?: {
      email?: string | null;
      firstname?: string | null;
      id?: number | string;
      lastname?: string | null;
    } | null;
  };
  status?: number;
}

export interface ApiAuditLogController {
  exportCsv: (context: ApiAuditLogRequestContext) => Promise<void>;
  find: (context: ApiAuditLogRequestContext) => Promise<void>;
  findOne: (context: ApiAuditLogRequestContext) => Promise<void>;
}

export interface AuditLogStoredRow {
  action: string;
  actorDocumentId: string | null;
  actorLabel: string | null;
  actorType: string | null;
  afterValues: unknown;
  beforeValues: unknown;
  eventId: string;
  eventSource: string | null;
  httpMethod: string;
  occurredAt: Date | string;
  requestId: string;
  requestPath: string | null;
  statusCode: number;
  success: boolean;
  targetDocumentId: string | null;
  targetLabel: string | null;
  targetType: string | null;
  targetUid: string | null;
}
