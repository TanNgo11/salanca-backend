const I18N_PREFIX = 'i18n.';

export const i18nPluginMessages: Record<string, string> = {
  'actions.delete.label': 'Xóa bản ghi ({locale})',
  'actions.delete.dialog.title': 'Xác nhận',
  'actions.delete.dialog.body': 'Bạn có chắc muốn xóa ngôn ngữ này?',
  'actions.delete.error': 'Không xóa được ngôn ngữ của bản ghi.',
  'CMEditViewCopyLocale.copy-failure': 'Không sao chép được ngôn ngữ',
  'CMEditViewCopyLocale.copy-success': 'Đã sao chép ngôn ngữ',
  'CMEditViewCopyLocale.copy-text': 'Điền từ ngôn ngữ khác',
  'CMEditViewCopyLocale.cancel-text': 'Không, hủy',
  'CMEditViewCopyLocale.submit-text': 'Có, điền vào',
  'CMEditViewCopyLocale.dialog.title': 'Xác nhận',
  'CMEditViewCopyLocale.dialog.body':
    'Nội dung hiện tại sẽ bị xóa và thay bằng nội dung của ngôn ngữ đã chọn:',
  'CMEditViewCopyLocale.dialog.field.label': 'Ngôn ngữ',
  'CMEditViewCopyLocale.dialog.field.placeholder': 'Chọn một ngôn ngữ...',
  'CMEditViewBulkLocale.publish-title': 'Xuất bản nhiều ngôn ngữ',
  'CMEditViewBulkLocale.unpublish-title': 'Gỡ xuất bản nhiều ngôn ngữ',
  'CMEditViewBulkLocale.status': 'Trạng thái',
  'CMEditViewBulkLocale.publication-status': 'Trạng thái xuất bản',
  'CMEditViewBulkLocale.draft-relation-warning':
    'Một số ngôn ngữ liên kết tới bản nháp. Xuất bản chúng có thể làm hỏng liên kết trên ứng dụng.',
  'CMEditViewBulkLocale.continue-confirmation': 'Bạn có chắc muốn tiếp tục?',
  'CMEditViewAITranslation.status-aria-label': 'Trạng thái dịch AI',
  'CMEditViewAITranslation.status-title':
    '{enabled, select, true {Đã bật dịch AI} false {Đã tắt dịch AI} other {Đã tắt dịch AI}}',
  'CMEditViewAITranslation.status-description':
    'AI dịch nội dung sang mọi ngôn ngữ mỗi khi bạn lưu thay đổi ở ngôn ngữ mặc định.',
  'CMEditViewAITranslation.settings-link':
    '{enabled, select, true {Tắt trong cài đặt} false {Bật trong cài đặt} other {Bật trong cài đặt}}',
  'CMEditViewAITranslation.job-completed': 'Dịch AI hoàn tất!',
  'CMEditViewAITranslation.job-failed': 'Dịch AI thất bại. Hãy thử lại.',
  'CMEditViewLocalePicker.locale.create': 'Tạo ngôn ngữ <bold>{locale}</bold>',
  'CMEditViewLocalePicker.locale.ai-translations': 'Dịch AI:',
  'CMListView.popover.display-locales.label': 'Hiện các ngôn ngữ đã dịch',
  'CMListView.popover.display-locales.more': '{locales} + {count} nữa',
  'CheckboxConfirmation.Modal.body': 'Bạn muốn tắt tính năng này?',
  'CheckboxConfirmation.Modal.button-confirm': 'Có, tắt',
  'CheckboxConfirmation.Modal.content':
    'Tắt đa ngôn ngữ sẽ xóa mọi nội dung, trừ nội dung của ngôn ngữ mặc định (nếu có).',
  'Field.localized': 'Giá trị này riêng cho ngôn ngữ đang chọn',
  'Field.not-localized': 'Giá trị này dùng chung cho mọi ngôn ngữ',
  'Settings.list.actions.add': 'Thêm ngôn ngữ',
  'Settings.list.actions.delete': 'Xóa ngôn ngữ {name}',
  'Settings.list.actions.deleteAdditionalInfos':
    'Thao tác này sẽ xóa các phiên bản ngôn ngữ đang chọn <em>(từ Đa ngôn ngữ)</em>',
  'Settings.list.actions.publishAdditionalInfos':
    'Thao tác này sẽ xuất bản các phiên bản ngôn ngữ đang chọn <em>(từ Đa ngôn ngữ)</em>',
  'Settings.list.actions.unpublishAdditionalInfos':
    'Thao tác này sẽ gỡ xuất bản các phiên bản ngôn ngữ đang chọn <em>(từ Đa ngôn ngữ)</em>',
  'Settings.list.actions.edit': 'Sửa ngôn ngữ {name}',
  'Settings.list.description': 'Cấu hình plugin đa ngôn ngữ',
  'Settings.list.empty.description':
    'Đây không phải hành vi thông thường — có thể cơ sở dữ liệu đã bị sửa tay. Cần có ít nhất một ngôn ngữ để dùng Strapi đúng.',
  'Settings.list.empty.title': 'Chưa có ngôn ngữ nào.',
  'Settings.aiLocalizations.label': 'Dịch AI',
  'Settings.aiLocalizations.description':
    'Mỗi lần bạn lưu trong Content Manager, AI dùng ngôn ngữ mặc định để dịch tự động các ngôn ngữ còn lại.',
  'Settings.locales.default': 'Mặc định',
  'Settings.locales.list.sort.default': 'Sắp xếp theo ngôn ngữ mặc định',
  'Settings.locales.list.sort.displayName': 'Sắp xếp theo tên hiển thị',
  'Settings.locales.list.sort.id': 'Sắp xếp theo ID',
  'Settings.locales.modal.advanced': 'Cài đặt nâng cao',
  'Settings.locales.modal.advanced.setAsDefault': 'Đặt làm ngôn ngữ mặc định',
  'Settings.locales.modal.advanced.setAsDefault.hint':
    'Phải có một ngôn ngữ mặc định; đổi bằng cách chọn ngôn ngữ khác',
  'Settings.locales.modal.advanced.settings': 'Cài đặt',
  'Settings.locales.modal.base': 'Cài đặt cơ bản',
  'Settings.locales.modal.create.success': 'Đã thêm ngôn ngữ',
  'Settings.locales.modal.create.code.label': 'Ngôn ngữ',
  'Settings.locales.modal.create.code.error': 'Hãy chọn một ngôn ngữ',
  'Settings.locales.modal.create.name.description':
    'Ngôn ngữ sẽ hiện với tên này trong trang quản trị',
  'Settings.locales.modal.create.name.label': 'Tên hiển thị của ngôn ngữ',
  'Settings.locales.modal.create.name.error.min':
    'Tên hiển thị ngôn ngữ chỉ được dưới 50 ký tự.',
  'Settings.locales.modal.create.name.error.required': 'Hãy đặt tên hiển thị cho ngôn ngữ',
  'Settings.locales.modal.delete.confirm': 'Xóa',
  'Settings.locales.modal.delete.message':
    'Xóa ngôn ngữ này sẽ xóa mọi nội dung liên quan. Nếu muốn giữ nội dung, hãy chuyển sang ngôn ngữ khác trước.',
  'Settings.locales.modal.delete.secondMessage': 'Bạn có muốn xóa ngôn ngữ này?',
  'Settings.locales.modal.delete.success': 'Đã xóa ngôn ngữ',
  'Settings.locales.modal.edit.confirmation': 'Hoàn tất',
  'Settings.locales.modal.edit.success': 'Đã cập nhật ngôn ngữ',
  'Settings.locales.modal.edit.tab.label':
    'Chuyển giữa cài đặt cơ bản và cài đặt nâng cao của i18n',
  'Settings.locales.modal.title': 'Cấu hình',
  'Settings.locales.row.default-locale': 'Ngôn ngữ mặc định',
  'Settings.locales.row.displayName': 'Tên hiển thị',
  'Settings.locales.row.id': 'ID',
  'Settings.permissions.loading': 'Đang tải quyền',
  'Settings.permissions.read.denied.description':
    'Để xem nội dung này, hãy liên hệ quản trị viên hệ thống.',
  'Settings.permissions.read.denied.title': 'Bạn không có quyền xem nội dung này.',
  'actions.select-locale': 'Chọn ngôn ngữ',
  'components.Select.locales.not-available': 'Chưa có nội dung',
  'plugin.description.long':
    'Plugin này cho phép tạo, đọc và cập nhật nội dung bằng nhiều ngôn ngữ, cả trên trang quản trị và qua API.',
  'plugin.description.short':
    'Plugin này cho phép tạo, đọc và cập nhật nội dung bằng nhiều ngôn ngữ, cả trên trang quản trị và qua API.',
  'plugin.name': 'Đa ngôn ngữ',
  'plugin.schema.i18n.localized.description-content-type':
    'Cho phép dịch một bản ghi sang các ngôn ngữ khác',
  'plugin.schema.i18n.localized.description-field':
    'Trường có thể có giá trị khác nhau ở mỗi ngôn ngữ',
  'plugin.schema.i18n.localized.label-content-type': 'Đa ngôn ngữ',
  'plugin.schema.i18n.localized.label-field': 'Bật đa ngôn ngữ cho trường này',
  'list-view.table.header.label': 'Có ở',
};

export const i18nPluginVietnameseTranslations: Record<string, string> = Object.fromEntries(
  Object.entries(i18nPluginMessages).map(([key, value]) => [`${I18N_PREFIX}${key}`, value]),
);
