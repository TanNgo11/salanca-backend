const EMAIL_PREFIX = 'email.';

export const emailPluginMessages: Record<string, string> = {
  link: 'Liên kết',
  'Settings.email.plugin.button.test-email': 'Gửi thử email',
  'Settings.email.plugin.button.verify': 'Kiểm tra kết nối',
  'Settings.email.plugin.label.defaultFrom': 'Email người gửi mặc định',
  'Settings.email.plugin.label.defaultReplyTo': 'Email nhận phản hồi mặc định',
  'Settings.email.plugin.label.provider': 'Nhà cung cấp email',
  'Settings.email.plugin.label.replyToName': 'Tên nhận phản hồi mặc định',
  'Settings.email.plugin.label.senderName': 'Tên người gửi mặc định',
  'Settings.email.plugin.label.testAddress': 'Email người nhận',
  'Settings.email.plugin.label.verifyConnection': 'Trạng thái kết nối',
  'Settings.email.plugin.notification.config.error': 'Không đọc được cấu hình email',
  'Settings.email.plugin.notification.data.loaded': 'Đã tải cấu hình email',
  'Settings.email.plugin.notification.test.error': 'Không gửi được email thử tới {to}',
  'Settings.email.plugin.notification.test.success':
    'Gửi thử thành công, kiểm tra hộp thư {to}',
  'Settings.email.plugin.notification.verify.error': 'Kiểm tra kết nối thất bại',
  'Settings.email.plugin.notification.verify.success': 'Kết nối hợp lệ',
  'Settings.email.plugin.placeholder.defaultFrom':
    'ex: Strapi No-Reply <no-reply@strapi.io>',
  'Settings.email.plugin.placeholder.defaultReplyTo': 'ex: Strapi <example@strapi.io>',
  'Settings.email.plugin.placeholder.testAddress': 'ex: developer@example.com',
  'Settings.email.plugin.status.connected': 'Đã kết nối',
  'Settings.email.plugin.status.error': 'Lỗi',
  'Settings.email.plugin.subTitle': 'Kiểm tra cấu hình của plugin Email',
  'Settings.email.plugin.text.configuration':
    'Plugin được cấu hình trong tệp {file}, xem {link} để biết chi tiết.',
  'Settings.email.plugin.title': 'Cấu hình',
  'Settings.email.plugin.title.config': 'Cấu hình',
  'Settings.email.plugin.title.test': 'Gửi thử email',
  'SettingsNav.link.settings': 'Cài đặt',
  'SettingsNav.section-label': 'Plugin Email',
  'components.Input.error.validation.email': 'Email không hợp lệ',
  'Settings.capabilities.title': 'Khả năng của nhà cung cấp',
  'Settings.capabilities.subtitle': 'Cấu hình SMTP hiện tại và các tính năng đang bật',
  'Settings.capabilities.label.smtpServer': 'Máy chủ SMTP',
  'Settings.capabilities.label.encryption': 'Mã hóa',
  'Settings.capabilities.label.authType': 'Xác thực',
  'Settings.capabilities.label.poolStatus': 'Trạng thái pool',
  'Settings.capabilities.label.features': 'Tính năng đang bật',
  'Settings.capabilities.poolStatus.idle': 'Rảnh',
  'Settings.capabilities.poolStatus.active': 'Đang hoạt động',
  'Settings.capabilities.feature.dkim': 'DKIM',
  'Settings.capabilities.feature.pool': 'Pool kết nối',
  'Settings.capabilities.feature.rateLimiting': 'Giới hạn tần suất',
  'Settings.capabilities.feature.oauth2': 'OAuth2',
  'Settings.capabilities.feature.requireTLS': 'Bắt buộc TLS',
};

export const emailPluginVietnameseTranslations: Record<string, string> = Object.fromEntries(
  Object.entries(emailPluginMessages).map(([key, value]) => [`${EMAIL_PREFIX}${key}`, value]),
);
