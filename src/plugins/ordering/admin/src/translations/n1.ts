/** R1b: the read-only "Lịch sử gửi" screen. Each value is [vi, en]. */
export const n1Messages: Record<string, [string, string]> = {
  'nav.notificationLog': ['Lịch sử gửi', 'Delivery log'],

  'nlog.title': ['Lịch sử gửi thông báo', 'Notification delivery log'],
  'nlog.subtitle': [
    'Mỗi lần hệ thống gửi hoặc bỏ qua một thông báo. Ngày tính theo múi giờ {timezone}. Địa chỉ người nhận không được lưu nên không hiển thị.',
    'Every time the system sends or skips a notification. Dates follow the {timezone} timezone. Recipient addresses are not stored, so they are not shown.',
  ],
  'nlog.warn.noEmail': [
    'Chi nhánh chưa có email nhận đơn mới: {branches}. Nhân viên sẽ không nhận thông báo đơn mới ở các chi nhánh này.',
    'Branches without a new-order email: {branches}. Staff will not receive new-order notifications at these branches.',
  ],
  'nlog.warn.noEmail.link': ['Mở Chi nhánh', 'Open branches'],
  'nlog.info.allowlist': [
    'Môi trường thử: chỉ gửi tới người nhận trong danh sách cho phép.',
    'Test environment: sending only to allowlisted recipients.',
  ],

  'nlog.stat.sent24h': ['Đã gửi 24h', 'Sent (24h)'],
  'nlog.stat.failed24h': ['Lỗi 24h', 'Failed (24h)'],
  'nlog.stat.skipped24h': ['Bỏ qua 24h', 'Skipped (24h)'],
  'nlog.stat.budget': ['Hạn mức tính phí hôm nay', 'Paid-message budget today'],

  'nlog.filter.all': ['Tất cả', 'All'],
  'nlog.filter.from': ['Từ ngày', 'From'],
  'nlog.filter.to': ['Đến ngày', 'To'],
  'nlog.filter.status': ['Trạng thái', 'Status'],
  'nlog.filter.channel': ['Kênh', 'Channel'],
  'nlog.filter.template': ['Mẫu thông báo', 'Template'],
  'nlog.filter.role': ['Vai trò', 'Role'],
  'nlog.filter.q': ['Mã đơn', 'Order code'],
  'nlog.filter.apply': ['Lọc', 'Filter'],

  'nlog.status.all': ['Tất cả', 'All'],
  'nlog.status.sent': ['Đã gửi', 'Sent'],
  'nlog.status.failed': ['Lỗi', 'Failed'],
  'nlog.status.skipped': ['Bỏ qua', 'Skipped'],
  'nlog.status.pending': ['Đang chờ', 'Pending'],

  'nlog.channel.zalo': ['Zalo', 'Zalo'],
  'nlog.channel.sms': ['SMS', 'SMS'],
  'nlog.channel.email': ['Email', 'Email'],

  'nlog.role.staff': ['Nhân viên', 'Staff'],
  'nlog.role.customer': ['Khách', 'Customer'],

  'nlog.col.at': ['Giờ', 'Time'],
  'nlog.col.template': ['Mẫu', 'Template'],
  'nlog.col.channel': ['Kênh', 'Channel'],
  'nlog.col.role': ['Vai trò', 'Role'],
  'nlog.col.order': ['Đơn', 'Order'],
  'nlog.col.status': ['Trạng thái', 'Status'],
  'nlog.col.reason': ['Lý do', 'Reason'],
  'nlog.col.attempts': ['Lần thử', 'Attempts'],
  'nlog.col.action': ['Chi tiết', 'Detail'],

  'nlog.detail.title': ['Chi tiết lần gửi', 'Delivery detail'],
  'nlog.detail.reason': ['Lý do', 'Reason'],
  'nlog.detail.messageLocale': ['Ngôn ngữ tin', 'Message language'],
  'nlog.detail.openOrder': ['Mở đơn', 'Open order'],
  'nlog.detail.technical': ['Xem chi tiết kỹ thuật', 'Show technical detail'],
  'nlog.detail.noPermission': [
    'Bạn không có quyền xem chi tiết kỹ thuật.',
    'You do not have permission to view technical detail.',
  ],
  'nlog.detail.error': ['Lỗi kỹ thuật', 'Technical error'],
  'nlog.detail.providerId': ['Mã tin nhà cung cấp', 'Provider message id'],
  'nlog.detail.cost': ['Chi phí (ước tính)', 'Cost (estimate)'],

  'nlog.empty': ['Không có lần gửi nào trong khoảng này.', 'No deliveries in this range.'],
  'nlog.loadFailed': ['Không tải được lịch sử gửi.', 'Could not load the delivery log.'],
  'nlog.page.prev': ['Trang trước', 'Previous'],
  'nlog.page.next': ['Trang sau', 'Next'],
};
