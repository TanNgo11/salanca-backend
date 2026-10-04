const USERS_PERMISSIONS_PREFIX = 'users-permissions.';

export const usersPermissionsMessages: Record<string, string> = {
  'EditForm.inputToggle.placeholder.email-confirmation-redirection':
    'ex: https://yourfrontend.com/email-confirmation-redirection',
  'EditForm.inputToggle.placeholder.email-reset-password':
    'ex: https://yourfrontend.com/reset-password',
  'EditPage.form.roles': 'Chi tiết vai trò',
  'Email.template.data.loaded': 'Đã tải các mẫu email',
  'Email.template.email_confirmation': 'Xác nhận địa chỉ email',
  'Email.template.reset_password': 'Đặt lại mật khẩu',
  'Email.template.form.edit.label': 'Sửa mẫu',
  'Email.template.table.action.label': 'thao tác',
  'Email.template.table.icon.label': 'biểu tượng',
  'Email.template.table.name.label': 'tên',
  'Form.advancedSettings.data.loaded': 'Đã tải cài đặt nâng cao',
  'List.button.roles': 'Thêm vai trò người dùng',
  'PopUpForm.Email.link.documentation': 'xem tài liệu của chúng tôi.',
  'PopUpForm.Email.options.object.placeholder':
    'Vui lòng xác nhận địa chỉ email cho %APP_NAME%',
  'PopUpForm.Providers.redirectURL.label':
    'URL chuyển hướng cần khai báo trong cấu hình ứng dụng {provider}',
  'PopUpForm.header.edit.providers': 'Sửa nhà cung cấp',
  'Providers.data.loaded': 'Đã tải danh sách nhà cung cấp',
  'Providers.status': 'Trạng thái',
  'Roles.empty': 'Chưa có vai trò nào.',
  'Roles.empty.search': 'Không có vai trò nào khớp tìm kiếm.',
  'roles.website-users.title': 'Vai trò người dùng website',
  'Settings.roles.created': 'Đã tạo vai trò',
  'Settings.roles.deleted': 'Đã xóa vai trò',
  'Settings.roles.edited': 'Đã cập nhật vai trò',
  'Settings.section-label': 'Plugin Users & Permissions',
  'components.Input.error.validation.email': 'Email không hợp lệ',
  'components.Input.error.validation.json': 'Không đúng định dạng JSON',
  'components.Input.error.validation.max': 'Giá trị quá lớn.',
  'components.Input.error.validation.maxLength': 'Giá trị quá dài.',
  'components.Input.error.validation.min': 'Giá trị quá nhỏ.',
  'components.Input.error.validation.minLength': 'Giá trị quá ngắn.',
  'components.Input.error.validation.minSupMax': 'Không được lớn hơn',
  'components.Input.error.validation.regex': 'Giá trị không khớp biểu thức chính quy.',
  'components.Input.error.validation.required': 'Bắt buộc nhập giá trị này.',
  'components.Input.error.validation.unique': 'Giá trị này đã được dùng.',
  'page.title': 'Cài đặt - Vai trò',
  'popUpWarning.button.cancel': 'Hủy',
  'popUpWarning.button.confirm': 'Xác nhận',
  'popUpWarning.title': 'Xác nhận',
  'popUpWarning.warning.cancel': 'Bạn có chắc muốn hủy các thay đổi?',
};

export const usersPermissionsVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(usersPermissionsMessages).map(([key, value]) => [
      `${USERS_PERMISSIONS_PREFIX}${key}`,
      value,
    ]),
  );
