/**
 * Labels for enumeration values in Content Manager forms and list filters.
 * Strapi looks each option up with the raw stored value as the message id
 * (`formatMessage({ id: value, defaultMessage: value })`), so these keys stay
 * unprefixed. Values shared by several fields (`new`, `vi`...) mean the same
 * thing everywhere, so one label serves them all.
 */
export const contentEnumOptionVietnameseTranslations: Record<string, string> = {
  // reservation-request.menuSelectionMode
  later: 'Chọn món sau',
  now: 'Chọn món ngay',

  // reservation-request / contact-message .sourceLocale
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',

  // reservation-request / contact-message .leadStatus
  new: 'Mới',
  read: 'Đã đọc',
  archived: 'Lưu trữ',

  // campaign.kind
  promotion: 'Khuyến mãi',
  event: 'Sự kiện',
  private_event: 'Sự kiện riêng',

  // gallery-item.area
  main_hall: 'Sảnh chính',
  bar: 'Quầy bar',
  private_room: 'Phòng riêng',
  night: 'Buổi tối',
  food: 'Món ăn',
  experience: 'Trải nghiệm',

  // shared.social-link.platform
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  other: 'Khác',

  // menu.decor.slot
  'a-la-carte-leaves': 'Gọi món – lá',
  'a-la-carte-botanical': 'Gọi món – thực vật',
  'buffet-leaf': 'Buffet – lá',
  'rodizio-flower': 'Rodizio – hoa',
  'dessert-fruit-top': 'Tráng miệng – trái cây trên',
  'dessert-fruit-bottom': 'Tráng miệng – trái cây dưới',
  'takeaway-leaves-top': 'Mang đi – lá trên',
  'takeaway-leaves-bottom': 'Mang đi – lá dưới',
  'takeaway-frame-top': 'Mang đi – khung trên',
  'takeaway-frame-bottom': 'Mang đi – khung dưới',
  'takeaway-frame-second-top': 'Mang đi – khung thứ hai trên',
  'takeaway-frame-second-bottom': 'Mang đi – khung thứ hai dưới',
  'takeaway-logo': 'Mang đi – logo',
  'booking-strip-leaves': 'Dải đặt bàn – lá',
  'accent-flowers': 'Hoa điểm nhấn',
};
