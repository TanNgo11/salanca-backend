const CONTENT_MANAGER_PREFIX = 'content-manager.';

export const contentManagerEditMessages: Record<string, string> = {
  'actions.clone.error': 'Không nhân bản được bản ghi.',
  'actions.delete.error': 'Không xóa được bản ghi.',
  'actions.edit.error': 'Không sửa được bản ghi.',
  'actions.unpublish.error': 'Không gỡ xuất bản được bản ghi.',
  'apiError.This attribute must be unique': '{field} phải là duy nhất',
  'components.DragHandle-label': 'Kéo',
  'components.DynamicZone.ComponentPicker-label': 'Chọn một thành phần',
  'components.DynamicZone.add-component': 'Thêm thành phần vào {componentName}',
  'components.DynamicZone.delete-label': 'Xóa {name}',
  'components.DynamicZone.error-message': 'Thành phần còn lỗi',
  'components.DynamicZone.missing-components':
    '{number, plural, =0 {Thiếu # thành phần} other {Thiếu # thành phần}}',
  'components.DynamicZone.extra-components':
    '{number, plural, =0 {Thừa # thành phần} other {Thừa # thành phần}}',
  'components.DynamicZone.move-down-label': 'Chuyển thành phần xuống',
  'components.DynamicZone.move-up-label': 'Chuyển thành phần lên',
  'components.DynamicZone.pick-compo': 'Chọn một thành phần',
  'components.DynamicZone.required': 'Thành phần là bắt buộc',
  'components.DynamicZone.unknown-component': 'Thành phần không xác định',
  'components.DynamicZone.move-up': 'Chuyển lên',
  'components.DynamicZone.move-down': 'Chuyển xuống',
  'components.NotAllowedInput.text': 'Bạn không có quyền xem trường này',
  'components.RelationInput.icon-button-aria-label': 'Kéo',
  'components.RelationInputModal.confirmation-message':
    'Một số thay đổi chưa được lưu. Bạn có chắc muốn đóng liên kết này? Mọi thay đổi chưa lưu sẽ bị mất.',
  'components.RepeatableComponent.error-message': 'Thành phần còn lỗi',
  'components.notification.info.maximum-requirement': 'Đã đạt số trường tối đa',
  'components.notification.info.minimum-requirement':
    'Đã thêm một trường để đủ số lượng tối thiểu',
  'components.repeatable.reorder.error':
    'Không sắp xếp lại được trường của thành phần, hãy thử lại',
  'components.uid.apply': 'Áp dụng',
  'components.uid.available': 'Dùng được',
  'components.uid.regenerate': 'Tạo lại',
  'components.uid.suggested': 'gợi ý',
  'components.uid.unavailable': 'Đã có bản ghi khác dùng',
  'containers.edit.tabs.label': 'Trạng thái bản ghi',
  'containers.edit.panels.default.title': 'Bản ghi',
  'containers.edit.panels.default.more-actions': 'Thêm thao tác bản ghi',
  'containers.edit.information.last-published.value':
    '{time}{isAnonymous, select, true {} other { bởi {author}}}',
  'containers.edit.information.last-draft.value':
    '{time}{isAnonymous, select, true {} other { bởi {author}}}',
  'containers.edit.information.document.value':
    '{time}{isAnonymous, select, true {} other { bởi {author}}}',
  'containers.EditView.publishHint':
    'Ctrl / Cmd + Shift + Enter để đăng lên website',
  'containers.EditView.saveHint': 'Ctrl / Cmd + Enter để lưu',
  'containers.untitled': 'Chưa có tiêu đề',
  'dnd.cancel-item': '{item} đã thả. Đã hủy sắp xếp lại.',
  'dnd.drop-item': '{item} đã thả. Vị trí cuối trong danh sách: {position}.',
  'dnd.grab-item':
    '{item} đã chọn. Vị trí hiện tại: {position}. Bấm phím mũi tên để di chuyển, Space để thả, Escape để hủy.',
  'dnd.instructions': 'Bấm phím cách để chọn và sắp xếp lại',
  'dnd.reorder': '{item} đã chuyển. Vị trí mới trong danh sách: {position}.',
  'form.Input.hint.character.unit': '{maxValue, plural, other { ký tự}}',
  'form.Input.hint.minMaxDivider': ' / ',
  'form.Input.hint.text':
    '{min, select, undefined {} other {tối thiểu {min}}}{divider}{max, select, undefined {} other {tối đa {max}}}{unit}{br}{description}',
  'form.Input.pageEntries.inputDescription':
    'Lưu ý: bạn có thể ghi đè giá trị này ở trang cài đặt danh sách nội dung.',
  'form.Input.sort.order': 'Thứ tự sắp xếp mặc định',
  'popover.display-relations.label': 'Hiện liên kết',
  'relation.add': 'Thêm liên kết',
  'relation.disconnect': 'Bỏ liên kết',
  'relation.error-adding-relation': 'Không thêm được liên kết.',
  'relation.isLoading': 'Đang tải liên kết',
  'relation.loadMore': 'Tải thêm',
  'relation.notAvailable': 'Không còn lựa chọn',
  'select.currently.selected': 'Đã chọn {count}',
  'success.record.discard': 'Đã hủy thay đổi',
  'success.record.publishing': 'Đang đăng lên website...',
  'validation.error.unreadable-required-field':
    'Quyền hiện tại không cho phép xem một số trường bắt buộc. Hãy nhờ quản trị viên cấp quyền để tiếp tục.',
};

export const contentManagerEditVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(contentManagerEditMessages).map(([key, value]) => [
      `${CONTENT_MANAGER_PREFIX}${key}`,
      value,
    ]),
  );
