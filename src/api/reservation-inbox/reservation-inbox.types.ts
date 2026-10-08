import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import type { ReservationLeadStatus as ReservationStatus } from '../../shared/lead-status/lead-status';

export enum ApiReservationInboxPermission {
  Read = 'admin::reservation-inbox.read',
}

export enum ApiReservationInboxRoute {
  Summary = '/reservation-inbox/summary',
  Stream = '/reservation-inbox/stream',
  MarkRead = '/reservation-inbox/:documentId/read',
  List = '/reservation-inbox/list',
  SetStatus = '/reservation-inbox/:documentId/status',
  Detail = '/reservation-inbox/:documentId/detail',
  SetNote = '/reservation-inbox/:documentId/note',
}

export enum ReservationInboxErrorCode {
  InvalidQuery = 'INVALID_QUERY',
  NotFound = 'NOT_FOUND',
  Unexpected = 'UNEXPECTED',
}

export const RESERVATION_INBOX_SUMMARY_LIMIT = 20;
export const RESERVATION_INBOX_PAGE_SIZE = 20;
export const RESERVATION_INBOX_SEARCH_MAX_LENGTH = 100;

export {
  RESERVATION_LEAD_STATUSES as RESERVATION_STATUSES,
  type ReservationLeadStatus as ReservationStatus,
} from '../../shared/lead-status/lead-status';

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

export const RESERVATION_MENU_SELECTION_MODES = ['later', 'now'] as const;
export type ReservationMenuSelectionMode = (typeof RESERVATION_MENU_SELECTION_MODES)[number];

export interface ReservationInboxDetail {
  documentId: string;
  fullName: string;
  phone: string;
  email: string | null;
  guestCount: number;
  preferredDate: string;
  preferredTime: string;
  occasion: string | null;
  note: string | null;
  menuSelectionMode: ReservationMenuSelectionMode | null;
  menuPackageNames: string[];
  menuItemNames: string[];
  sourceLocale: string | null;
  sourcePath: string | null;
  status: ReservationStatus;
  staffNote: string | null;
  overlapCount: number;
  createdAt: string;
}

export interface ApiReservationInboxController {
  detail: (context: ApiReservationInboxRequestContext) => Promise<void>;
  list: (context: ApiReservationInboxRequestContext) => Promise<void>;
  setStatus: (context: ApiReservationInboxRequestContext) => Promise<void>;
  setNote: (context: ApiReservationInboxRequestContext) => Promise<void>;
  markRead: (context: ApiReservationInboxRequestContext) => Promise<void>;
  stream: (context: ApiReservationInboxRequestContext) => void;
  summary: (context: ApiReservationInboxRequestContext) => Promise<void>;
}
