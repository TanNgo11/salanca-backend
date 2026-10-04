import { ReservationInboxTranslationKey } from './reservation-inbox.types';

export const reservationInboxVietnameseTranslations: Record<
  ReservationInboxTranslationKey,
  string
> = {
  [ReservationInboxTranslationKey.Title]: 'Hộp thư đặt bàn',
  [ReservationInboxTranslationKey.StatusStream]: 'Kết nối trực tiếp',
  [ReservationInboxTranslationKey.StatusPolling]: 'Đang kiểm tra mỗi 20 giây',
  [ReservationInboxTranslationKey.PrefOsNotify]: 'Thông báo hệ điều hành',
  [ReservationInboxTranslationKey.PrefSound]: 'Âm thanh',
  [ReservationInboxTranslationKey.OsNotifyDenied]:
    'Trình duyệt không cho phép thông báo. Hãy bật thông báo cho trang này rồi thử lại.',
  [ReservationInboxTranslationKey.ColumnCustomer]: 'Khách hàng',
  [ReservationInboxTranslationKey.ColumnPhone]: 'SĐT',
  [ReservationInboxTranslationKey.ColumnGuests]: 'Số khách',
  [ReservationInboxTranslationKey.ColumnDateTime]: 'Ngày giờ',
  [ReservationInboxTranslationKey.ColumnOverlap]: 'Trùng khung giờ',
  [ReservationInboxTranslationKey.ColumnReceivedAt]: 'Nhận lúc',
  [ReservationInboxTranslationKey.ColumnActions]: 'Thao tác',
  [ReservationInboxTranslationKey.ActionOpen]: 'Mở',
  [ReservationInboxTranslationKey.ActionMarkRead]: 'Đã đọc',
  [ReservationInboxTranslationKey.Empty]: 'Không có yêu cầu mới',
  [ReservationInboxTranslationKey.PillUnread]: 'đặt bàn mới',
  [ReservationInboxTranslationKey.PillAria]: '{count} đặt bàn mới',
  [ReservationInboxTranslationKey.OverlapCount]: 'Trùng {count}',
  [ReservationInboxTranslationKey.ToggleOn]: 'Bật',
  [ReservationInboxTranslationKey.ToggleOff]: 'Tắt',
};
