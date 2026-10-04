const DOCUMENTATION_PREFIX = 'documentation.';

export const documentationPluginMessages: Record<string, string> = {
  'coming-soon': 'Nội dung này đang được xây dựng và sẽ trở lại trong vài tuần tới!',
  'notification.delete.success': 'Đã xóa tài liệu',
  'notification.generate.success': 'Đã tạo tài liệu',
  'pages.PluginPage.Button.open': 'Mở tài liệu',
  'pages.PluginPage.header.description': 'Cấu hình plugin tài liệu',
  'pages.PluginPage.table.generated': 'Tạo lần cuối',
  'pages.PluginPage.table.icon.regenerate': 'Tạo lại {target}',
  'pages.PluginPage.table.icon.show': 'Mở {target}',
  'pages.PluginPage.table.version': 'Phiên bản',
  'pages.SettingsPage.header.description': 'Cấu hình plugin tài liệu',
  'pages.SettingsPage.header.save': 'Lưu',
  'pages.SettingsPage.toggle.hint': 'Đặt endpoint tài liệu ở chế độ riêng tư',
  'pages.SettingsPage.toggle.label': 'Hạn chế truy cập',
  'plugin.description.long':
    'Tạo tài liệu OpenAPI và xem API bằng SWAGGER UI.',
  'plugin.description.short':
    'Tạo tài liệu OpenAPI và xem API bằng SWAGGER UI.',
  'Input.error.contain.lowercase': 'Mật khẩu phải có ít nhất một chữ thường',
  'Input.error.contain.number': 'Mật khẩu phải có ít nhất một chữ số',
  'Input.error.contain.uppercase': 'Mật khẩu phải có ít nhất một chữ hoa',
};

export const documentationPluginVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(documentationPluginMessages).map(([key, value]) => [
      `${DOCUMENTATION_PREFIX}${key}`,
      value,
    ]),
  );
