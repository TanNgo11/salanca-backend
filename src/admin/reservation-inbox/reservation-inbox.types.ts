import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import type { ReservationLeadStatus as ReservationStatus } from '../../shared/lead-status/lead-status';

export enum ApiReservationInboxPermission {
  Read = 'admin::reservation-inbox.read',
}

export interface ReservationInboxPermissions {
  read: { action: ApiReservationInboxPermission; subject: null }[];
}

export {
  RESERVATION_LEAD_STATUSES as RESERVATION_STATUSES,
  type ReservationLeadStatus as ReservationStatus,
} from '../../shared/lead-status/lead-status';

/** Status filter value; `all` means no status constraint. */
export type ReservationStatusFilter = ReservationStatus | 'all';

export interface ReservationListItem extends ReservationInboxItem {
  status: ReservationStatus;
}

export interface ApiReservationListResult {
  items: ReservationListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: Record<ReservationStatus, number>;
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
  ChipNew = 'chip.new',
  ChipRead = 'chip.read',
  ChipArchived = 'chip.archived',
  FilterStatusLabel = 'filter.status',
  FilterAll = 'filter.all',
  StatusNew = 'status.new',
  StatusRead = 'status.read',
  StatusArchived = 'status.archived',
  SearchLabel = 'search.label',
  SearchPlaceholder = 'search.placeholder',
  SearchClear = 'search.clear',
  ColumnStatus = 'columns.status',
  ActionArchive = 'actions.archive',
  ActionRestore = 'actions.restore',
  ActionMarkNew = 'actions.markNew',
  PaginationSummary = 'pagination.summary',
  PaginationPrev = 'pagination.prev',
  PaginationNext = 'pagination.next',
  EmptyFiltered = 'emptyFiltered',
  LoadFailed = 'loadFailed',
  ActionFailed = 'actionFailed',
  ActionEdit = 'actions.edit',
  DetailTitle = 'detail.title',
  DetailLoading = 'detail.loading',
  DetailLoadFailed = 'detail.loadFailed',
  DetailClose = 'detail.close',
  DetailEmpty = 'detail.empty',
  DetailFullName = 'detail.fullName',
  DetailPhone = 'detail.phone',
  DetailEmail = 'detail.email',
  DetailVisit = 'detail.visit',
  DetailGuests = 'detail.guests',
  DetailOccasion = 'detail.occasion',
  DetailNote = 'detail.note',
  DetailMenuMode = 'detail.menuMode',
  DetailPackages = 'detail.packages',
  DetailItems = 'detail.items',
  DetailSourceLocale = 'detail.sourceLocale',
  DetailSourcePath = 'detail.sourcePath',
  DetailStatus = 'detail.status',
  DetailOverlap = 'detail.overlap',
  DetailReceivedAt = 'detail.receivedAt',
  ChipConfirmed = 'chip.confirmed',
  ChipCancelled = 'chip.cancelled',
  ChipNoShow = 'chip.noShow',
  StatusConfirmed = 'status.confirmed',
  StatusCancelled = 'status.cancelled',
  StatusNoShow = 'status.noShow',
  ActionConfirm = 'actions.confirm',
  ActionCancel = 'actions.cancel',
  ActionNoShow = 'actions.noShow',
  ActionRestoreConfirmed = 'actions.restoreConfirmed',
  DetailActions = 'detail.actions',
  DetailStaffNote = 'detail.staffNote',
  DetailStaffNoteHint = 'detail.staffNoteHint',
  DetailStaffNoteSave = 'detail.staffNoteSave',
  DetailStaffNoteSaved = 'detail.staffNoteSaved',
  DetailStaffNoteFailed = 'detail.staffNoteFailed',
}
