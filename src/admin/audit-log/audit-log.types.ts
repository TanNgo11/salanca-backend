export enum ApiAuditLogPermission {
  Read = 'admin::audit-log.read',
  Details = 'admin::audit-log.details',
  Export = 'admin::audit-log.export',
}

export enum AuditLogTranslationKey {
  Title = 'title',
  Export = 'actions.export',
  Search = 'filters.search',
  SearchPlaceholder = 'filters.searchPlaceholder',
  Category = 'filters.category',
  Action = 'filters.action',
  Source = 'filters.source',
  Result = 'filters.result',
  From = 'filters.from',
  To = 'filters.to',
  CategoryContent = 'category.content',
  CategoryAccount = 'category.account',
  CategorySecurity = 'category.security',
  CategoryError = 'category.error',
  ResultSuccess = 'result.success',
  ResultFailure = 'result.failure',
  ColumnTime = 'table.time',
  ColumnActor = 'table.actor',
  ColumnAction = 'table.action',
  ColumnSource = 'table.source',
  ColumnTarget = 'table.target',
  ColumnResult = 'table.result',
  Empty = 'table.empty',
  Loading = 'loading',
  Error = 'notification.loadError',
  Retry = 'actions.retry',
  Denied = 'denied',
  ExportError = 'notification.exportError',
  ExportTooLarge = 'notification.exportTooLarge',
  DetailTitle = 'detail.title',
  DetailClose = 'detail.close',
  DetailTechnical = 'detail.technical',
  DetailNoPermission = 'detail.noPermission',
  DetailRequestId = 'detail.requestId',
  DetailMethod = 'detail.method',
  DetailPath = 'detail.path',
  DetailStatus = 'detail.status',
  DetailSource = 'detail.source',
  DetailTargetId = 'detail.targetId',
  DetailChangedFields = 'detail.changedFields',
  DetailResult = 'detail.result',
  DetailBefore = 'detail.before',
  DetailAfter = 'detail.after',
  OpenTarget = 'detail.openTarget',
}

export enum AuditLogScreenStatus {
  Denied = 'denied',
  Empty = 'empty',
  Error = 'error',
  Loading = 'loading',
  Ready = 'ready',
}

export interface AuditLogPermissions {
  details: ReadonlyArray<{ action: ApiAuditLogPermission; subject: null }>;
  export: ReadonlyArray<{ action: ApiAuditLogPermission; subject: null }>;
  read: ReadonlyArray<{ action: ApiAuditLogPermission; subject: null }>;
}

export interface ApiAuditLogSummary {
  action: string;
  actorLabel: string;
  actorType: string | null;
  category: string;
  eventId: string;
  eventSource: string;
  occurredAt: string;
  success: boolean;
  targetId: string | null;
  targetLabel: string;
  targetType: string | null;
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

export interface AuditLogDraftFilters {
  action: string;
  category: string;
  from: string;
  search: string;
  source: string;
  success: string;
  to: string;
}
