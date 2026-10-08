import type { IntlShape } from 'react-intl';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';
import {
  ApiReservationInboxPermission,
  ReservationInboxTranslationKey,
  type ReservationInboxPermissions,
  type ReservationStatus,
  type ReservationStatusFilter,
} from './reservation-inbox.types';
import { reservationInboxVietnameseTranslations } from './vi';

const translationNamespace = 'reservation-inbox';

export const INBOX_POLL_INTERVAL_MS = 20_000;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export const reservationInboxPermissions: ReservationInboxPermissions = {
  read: [{ action: ApiReservationInboxPermission.Read, subject: null }],
};

export interface ParsedSseEvent {
  name: string;
  data: string;
}

export interface ParsedSseChunk {
  events: ParsedSseEvent[];
  rest: string;
}

export const parseSseChunk = (buffer: string): ParsedSseChunk => {
  const segments = buffer.split('\n\n');
  const rest = segments.pop() ?? '';
  const events: ParsedSseEvent[] = [];

  for (const segment of segments) {
    let name = 'message';
    const dataLines: string[] = [];

    for (const rawLine of segment.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        name = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        const value = line.slice('data:'.length);
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }

    if (dataLines.length > 0) {
      events.push({ name, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
};

export const nextBackoffMs = (attempt: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));

export interface MergeNewItemsResult {
  items: ReservationInboxItem[];
  added: ReservationInboxItem[];
  lastSeenAt: string | null;
}

export const mergeNewItems = (
  existing: readonly ReservationInboxItem[],
  incoming: readonly ReservationInboxItem[],
  lastSeenAt: string | null,
): MergeNewItemsResult => {
  const known = new Set(existing.map((item) => item.documentId));
  const added: ReservationInboxItem[] = [];
  let newest = lastSeenAt;

  for (const item of incoming) {
    if (known.has(item.documentId)) {
      continue;
    }
    if (lastSeenAt !== null && item.createdAt <= lastSeenAt) {
      continue;
    }
    known.add(item.documentId);
    added.push(item);
    if (newest === null || item.createdAt > newest) {
      newest = item.createdAt;
    }
  }

  return { items: [...added, ...existing], added, lastSeenAt: newest };
};

const preferredDateParts = (
  preferredDate: string,
): { day: string; month: string; year: string } => {
  const [year = '', month = '', day = ''] = preferredDate.split('-');
  return { day, month, year };
};

export const formatInboxToastMessage = (item: ReservationInboxItem): string => {
  const { day, month } = preferredDateParts(item.preferredDate);
  return `Đặt bàn mới: ${item.fullName} · ${item.guestCount} khách · ${item.preferredTime} ${day}/${month}`;
};

export const formatInboxVisitDateTime = (item: ReservationInboxItem): string => {
  const { day, month, year } = preferredDateParts(item.preferredDate);
  return `${day}/${month}/${year} ${item.preferredTime}`;
};

export const formatInboxReceivedAt = (createdAt: string): string =>
  new Date(createdAt).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const contentManagerEditPath = (documentId: string): string =>
  `/content-manager/collection-types/api::reservation-request.reservation-request/${documentId}`;

/**
 * Full admin URL for plain `href`s (Strapi notification links) that bypass the
 * router basename. Mirrors Strapi's own `getBasename()`.
 */
export const adminHref = (path: string): string => {
  const basename = (process.env.ADMIN_PATH ?? '').replace(window.location.origin, '');
  return `${basename.replace(/\/+$/, '')}${path}`;
};

export type InboxMode = 'stream' | 'polling';

export interface InboxState {
  mode: InboxMode;
  unreadCount: number;
  items: ReservationInboxItem[];
  lastSeenAt: string | null;
}

export type InboxAction =
  | { type: 'refreshed'; items: ReservationInboxItem[]; unreadCount: number }
  | { type: 'itemsArrived'; items: ReservationInboxItem[]; unreadCount?: number }
  | { type: 'streamOpened' }
  | { type: 'streamClosed' }
  | { type: 'markedRead'; documentId: string };

export const initialInboxState: InboxState = {
  mode: 'polling',
  unreadCount: 0,
  items: [],
  lastSeenAt: null,
};

export const inboxReducer = (state: InboxState, action: InboxAction): InboxState => {
  switch (action.type) {
    case 'refreshed': {
      const lastSeenAt = action.items.reduce<string | null>(
        (newest, item) =>
          newest === null || item.createdAt > newest ? item.createdAt : newest,
        state.lastSeenAt,
      );
      return {
        ...state,
        items: action.items,
        unreadCount: Math.max(0, action.unreadCount),
        lastSeenAt,
      };
    }
    case 'itemsArrived': {
      const merged = mergeNewItems(state.items, action.items, state.lastSeenAt);
      const unreadCount =
        action.unreadCount ?? state.unreadCount + merged.added.length;
      if (merged.added.length === 0 && unreadCount === state.unreadCount) {
        return state;
      }
      return {
        ...state,
        items: merged.items,
        lastSeenAt: merged.lastSeenAt,
        unreadCount: Math.max(0, unreadCount),
      };
    }
    case 'streamOpened':
      return state.mode === 'stream' ? state : { ...state, mode: 'stream' };
    case 'streamClosed':
      return state.mode === 'polling' ? state : { ...state, mode: 'polling' };
    case 'markedRead':
      return {
        ...state,
        items: state.items.filter((item) => item.documentId !== action.documentId),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    default:
      return state;
  }
};

export const getReservationInboxTranslationId = (
  key: ReservationInboxTranslationKey,
): string => `${translationNamespace}.${key}`;

export const formatReservationInboxMessage = (
  intl: IntlShape,
  key: ReservationInboxTranslationKey,
  values?: Parameters<IntlShape['formatMessage']>[1],
): string =>
  intl.formatMessage(
    {
      id: getReservationInboxTranslationId(key),
      // `config.translations.vi` only applies when the admin UI locale is
      // Vietnamese; defaultMessage keeps the labels Vietnamese otherwise.
      defaultMessage: reservationInboxVietnameseTranslations[key],
    },
    values,
  ) as string;

export const INBOX_SEARCH_DEBOUNCE_MS = 300;

export interface ReservationListFilters {
  status: ReservationStatusFilter;
  search: string;
  page: number;
}

export const initialListFilters: ReservationListFilters = {
  status: 'new',
  search: '',
  page: 1,
};

export const buildReservationListQuery = ({
  status,
  search,
  page,
}: ReservationListFilters): string => {
  const params = new URLSearchParams();
  if (status !== 'all') {
    params.set('status', status);
  }
  const trimmed = search.trim();
  if (trimmed) {
    params.set('search', trimmed);
  }
  params.set('page', String(Math.max(1, page)));
  return params.toString();
};

export const reservationStatusTone = (
  status: ReservationStatus,
): InformationStatusChipTone => {
  switch (status) {
    case 'new':
      return InformationStatusChipTone.Info;
    case 'confirmed':
      return InformationStatusChipTone.Published;
    case 'cancelled':
    case 'no_show':
      return InformationStatusChipTone.Warning;
    default:
      return InformationStatusChipTone.Neutral;
  }
};

export const reservationStatusChipKey: Record<ReservationStatus, ReservationInboxTranslationKey> = {
  new: ReservationInboxTranslationKey.ChipNew,
  read: ReservationInboxTranslationKey.ChipRead,
  confirmed: ReservationInboxTranslationKey.ChipConfirmed,
  cancelled: ReservationInboxTranslationKey.ChipCancelled,
  no_show: ReservationInboxTranslationKey.ChipNoShow,
  archived: ReservationInboxTranslationKey.ChipArchived,
};

export const reservationStatusTabKey: Record<ReservationStatus, ReservationInboxTranslationKey> = {
  new: ReservationInboxTranslationKey.StatusNew,
  read: ReservationInboxTranslationKey.StatusRead,
  confirmed: ReservationInboxTranslationKey.StatusConfirmed,
  cancelled: ReservationInboxTranslationKey.StatusCancelled,
  no_show: ReservationInboxTranslationKey.StatusNoShow,
  archived: ReservationInboxTranslationKey.StatusArchived,
};

export interface ReservationStatusAction {
  /** Status the request moves to. */
  target: ReservationStatus;
  translationKey: ReservationInboxTranslationKey;
}

/** Table rows show only the first actions; the detail modal shows all. */
export const RESERVATION_ROW_ACTION_LIMIT = 2;

const action = (
  target: ReservationStatus,
  translationKey: ReservationInboxTranslationKey,
): ReservationStatusAction => ({ target, translationKey });

/** Next steps per current status, most likely step first. */
export const reservationStatusActions = (
  status: ReservationStatus,
): ReservationStatusAction[] => {
  const K = ReservationInboxTranslationKey;
  switch (status) {
    case 'new':
      return [
        action('confirmed', K.ActionConfirm),
        action('cancelled', K.ActionCancel),
        action('read', K.ActionMarkRead),
      ];
    case 'read':
      return [
        action('confirmed', K.ActionConfirm),
        action('cancelled', K.ActionCancel),
        action('archived', K.ActionArchive),
        action('new', K.ActionMarkNew),
      ];
    case 'confirmed':
      return [
        action('no_show', K.ActionNoShow),
        action('cancelled', K.ActionCancel),
        action('archived', K.ActionArchive),
      ];
    case 'cancelled':
      return [action('archived', K.ActionArchive), action('read', K.ActionRestore)];
    case 'no_show':
      return [
        action('archived', K.ActionArchive),
        action('confirmed', K.ActionRestoreConfirmed),
      ];
    default:
      return [action('read', K.ActionRestore)];
  }
};
