import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';

export enum ApiReservationInboxPermission {
  Read = 'admin::reservation-inbox.read',
}

export interface ReservationInboxPermissions {
  read: { action: ApiReservationInboxPermission; subject: null }[];
}

export interface ApiReservationInboxSummary {
  items: ReservationInboxItem[];
  unreadCount: number;
}

export enum ReservationInboxTranslationKey {
  Title = 'title',
  StatusStream = 'status.stream',
  StatusPolling = 'status.polling',
  PrefOsNotify = 'prefs.osNotify',
  PrefSound = 'prefs.sound',
  OsNotifyDenied = 'prefs.osNotifyDenied',
  ColumnCustomer = 'columns.customer',
  ColumnPhone = 'columns.phone',
  ColumnGuests = 'columns.guests',
  ColumnDateTime = 'columns.dateTime',
  ColumnOverlap = 'columns.overlap',
  ColumnReceivedAt = 'columns.receivedAt',
  ColumnActions = 'columns.actions',
  ActionOpen = 'actions.open',
  ActionMarkRead = 'actions.markRead',
  Empty = 'empty',
  PillUnread = 'pill.unread',
  PillAria = 'pill.aria',
  OverlapCount = 'overlap.count',
  ToggleOn = 'toggle.on',
  ToggleOff = 'toggle.off',
}
