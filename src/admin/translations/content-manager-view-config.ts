const CONTENT_MANAGER_PREFIX = 'content-manager.';

export const contentManagerViewConfigMessages: Record<string, string> = {
  'api.id': 'API ID',
  'components.DraggableCard.delete.field': 'Xóa trường {item}',
  'components.DraggableCard.edit.field': 'Sửa trường {item}',
  'components.DraggableCard.move.field': 'Di chuyển trường {item}',
  'components.FieldItem.linkToComponentLayout': 'Cấu hình bố cục thành phần',
  'components.FieldSelect.label': 'Thêm trường',
  'components.SettingsViewWrapper.pluginHeader.description.edit-settings':
    'Kéo thả để sắp xếp bố cục biểu mẫu',
  'components.SettingsViewWrapper.pluginHeader.description.list-settings':
    'Chọn cột và thứ tự cột hiển thị',
  'components.SettingsViewWrapper.pluginHeader.title': 'Cấu hình chế độ xem — {name}',
  'containers.EditSettingsView.modal-form.edit-field': 'Sửa trường',
  'containers.list-settings.modal-form.label': 'Sửa {fieldName}',
  'containers.list-settings.modal-form.error': 'Không mở được biểu mẫu.',
  'containers.edit-settings.modal-form.error': 'Không mở được biểu mẫu.',
  'containers.edit-settings.modal-form.label': 'Nhãn',
  'containers.edit-settings.modal-form.description': 'Mô tả',
  'containers.edit-settings.modal-form.placeholder': 'Placeholder',
  'containers.edit-settings.modal-form.mainField': 'Tiêu đề bản ghi',
  'containers.edit-settings.modal-form.mainField.hint':
    'Chọn trường hiển thị trên cả màn sửa và màn danh sách',
  'containers.edit-settings.modal-form.editable': 'Trường có thể sửa',
  'containers.edit-settings.modal-form.size': 'Kích thước',
  'containers.SettingPage.add.field': 'Chèn thêm trường',
  'containers.SettingPage.add.relational-field': 'Chèn thêm trường liên kết',
  'containers.SettingPage.editSettings.relation-field.description':
    'Chọn trường hiển thị trên cả màn sửa và màn danh sách',
  'containers.SettingPage.editSettings.relationOpenMode': 'Cách mở liên kết',
  'containers.SettingPage.editSettings.relationOpenMode.description':
    'Chọn cách mở bản ghi liên kết khi bấm vào',
  'containers.SettingPage.editSettings.relationOpenMode.modal': 'Modal (mặc định)',
  'containers.SettingPage.editSettings.relationOpenMode.newTab': 'Mở tab mới',
  'containers.SettingPage.editSettings.relationOpenMode.page': 'Chuyển tới trang',
  'containers.SettingPage.listSettings.description':
    'Cấu hình tùy chọn cho danh sách nội dung này',
  'containers.SettingPage.pluginHeaderDescription':
    'Cấu hình riêng cho danh sách nội dung này',
  'containers.SettingPage.relations': 'Trường liên kết',
  'containers.SettingPage.view': 'Chế độ xem',
  'containers.SettingsPage.Block.contentType.title': 'Danh sách nội dung',
  'containers.SettingsPage.Block.generalSettings.description':
    'Cấu hình tùy chọn mặc định cho các danh sách nội dung',
  'containers.SettingsPage.pluginHeaderDescription':
    'Cấu hình cho mọi danh sách nội dung và nhóm',
  'containers.SettingsView.list.subtitle':
    'Cấu hình bố cục và cách hiển thị danh sách nội dung và nhóm',
  'edit-settings-view.link-to-ctb.components': 'Sửa thành phần',
  'edit-settings-view.link-to-ctb.content-types': 'Sửa loại nội dung',
  'emptyAttributes.button': 'Mở Trình tạo loại nội dung',
  'emptyAttributes.description': 'Thêm trường trong Trình tạo loại nội dung',
  'link-to-ctb': 'Sửa loại nội dung',
};

export const contentManagerViewConfigVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(contentManagerViewConfigMessages).map(([key, value]) => [
      `${CONTENT_MANAGER_PREFIX}${key}`,
      value,
    ]),
  );
