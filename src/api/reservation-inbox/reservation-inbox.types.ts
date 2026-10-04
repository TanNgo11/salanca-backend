import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';

export enum ApiReservationInboxPermission {
  Read = 'admin::reservation-inbox.read',
}

export enum ApiReservationInboxRoute {
  Summary = '/reservation-inbox/summary',
  Stream = '/reservation-inbox/stream',
  MarkRead = '/reservation-inbox/:documentId/read',
  List = '/reservation-inbox/list',
  SetStatus = '/reservation-inbox/:documentId/status',
}

export enum ReservationInboxErrorCode {
  InvalidQuery = 'INVALID_QUERY',
  NotFound = 'NOT_FOUND',
  Unexpected = 'UNEXPECTED',
}

export const RESERVATION_INBOX_SUMMARY_LIMIT = 20;
export const RESERVATION_INBOX_PAGE_SIZE = 20;
export const RESERVATION_INBOX_SEARCH_MAX_LENGTH = 100;

export const RESERVATION_STATUSES = ['new', 'read', 'archived'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface ApiReservationInboxSummaryResponse {
  data: {
    items: readonly ReservationInboxItem[];
    unreadCount: number;
  };
}

export interface ApiReservationInboxMarkReadResponse {
  data: {
    documentId: string;
    status: string;
  };
}

export interface ApiReservationInboxRequestContext {
  badRequest: (message: string) => void;
  body: unknown;
  internalServerError: (message: string) => void;
  notFound?: (message: string) => void;
  params?: { documentId?: string };
  query?: unknown;
  request?: { body?: unknown };
  req: { on: (event: 'close', listener: () => void) => void };
  res: {
    end: () => void;
    on: (event: 'close', listener: () => void) => void;
    write: (chunk: string) => unknown;
    writeHead: (status: number, headers: Record<string, string>) => void;
  };
  respond: boolean;
  set: (name: string, value: string) => void;
  state: {
    requestId?: unknown;
  };
  status?: number;
}

export interface ApiReservationInboxController {
  list: (context: ApiReservationInboxRequestContext) => Promise<void>;
  setStatus: (context: ApiReservationInboxRequestContext) => Promise<void>;
  markRead: (context: ApiReservationInboxRequestContext) => Promise<void>;
  stream: (context: ApiReservationInboxRequestContext) => void;
  summary: (context: ApiReservationInboxRequestContext) => Promise<void>;
}
