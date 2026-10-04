const CONTENT_MANAGER_PREFIX = 'content-manager.';

export const contentManagerListMessages: Record<string, string> = {
  'App.schemas.data-loaded': 'Đã tải schema',
  'ListViewTable.relation-loaded': 'Đã tải liên kết',
  'ListViewTable.relation-loading': 'Đang tải liên kết',
  'ListViewTable.relation-more': 'Liên kết này còn bản ghi chưa hiện hết',
  'components.ListViewTable.row-line': 'dòng {number}',
  'components.Filters.usersSelect.label': 'Tìm và chọn người dùng để lọc',
  'bulk-publish.already-published': 'Đã xuất bản',
  'bulk-unpublish.already-unpublished': 'Chưa xuất bản',
  'bulk-publish.modified': 'Đã sửa',
  'bulk-publish.waiting-for-action': 'Chờ xử lý',
  'components.TableDelete.label':
    'Đã chọn {number, plural, other {# bản ghi}}',
  'containers.list.items':
    '{number} {number, plural, =0 {mục} other {mục}}',
  'containers.list.table.row-actions': 'Thao tác hàng',
  'containers.list.selectedEntriesModal.title': 'Xuất bản nhiều bản ghi',
  'containers.list.selectedEntriesModal.selectedCount.publish':
    '<b>{publishedCount}</b> {publishedCount, plural, other {bản ghi}} đã xuất bản. <b>{draftCount}</b> {draftCount, plural, other {bản ghi}} sẵn sàng xuất bản. <b>{withErrorsCount}</b> {withErrorsCount, plural, other {bản ghi}} chờ xử lý.',
  'containers.list.selectedEntriesModal.selectedCount.unpublish':
    '<b>{draftCount}</b> {draftCount, plural, other {bản ghi}} chưa xuất bản. <b>{publishedCount}</b> {publishedCount, plural, other {bản ghi}} sẵn sàng gỡ xuất bản.',
  'containers.list.autoCloneModal.error.unique':
    'Không được trùng giá trị trên trường duy nhất.',
  'containers.list.autoCloneModal.error.relation':
    'Nhân bản liên kết có thể gỡ liên kết đó khỏi bản ghi gốc.',
  'error.records.fetch-draft-relatons':
    'Không tải được liên kết bản nháp của bản ghi này.',
  'header.name': 'Quản lý nội dung',
  'models': 'Danh sách nội dung',
  'models.numbered': 'Danh sách nội dung ({number})',
  'pages.NoContentType.button': 'Tạo loại nội dung đầu tiên',
  'pages.NoContentType.text': 'Chưa có loại nội dung nào',
  'permissions.not-allowed.create': 'Bạn không có quyền tạo bản ghi',
  'permissions.not-allowed.update': 'Bạn không có quyền sửa bản ghi này',
  'popUpWarning.warning.has-draft-relations.title': 'Xác nhận',
  'popUpWarning.warning.has-draft-relations.message':
    'Bản ghi này liên kết với {count, plural, other {# bản nháp}}. {count, plural, other {Các liên kết đó sẽ không có trong phiên bản đã xuất bản.}}',
  'popUpWarning.warning.has-draft-m2m-relations.message':
    '{count, plural, other {# bản ghi liên kết vẫn đang là bản nháp. Chúng sẽ hiện trên site khi được xuất bản.}}',
  'popUpWarning.warning.has-draft-m2m-relations.additional':
    '{count, plural, other {# liên kết many-to-many trỏ}} tới bản nháp và sẽ hiện sau khi xuất bản.',
  'popUpwarning.warning.has-draft-relations.button-confirm':
    'Xuất bản không kèm liên kết',
  'popUpwarning.warning.bulk-has-draft-relations.message':
    '<b>{count} {count, plural, one { relation } other { relations } } trên {entities} { entities, plural, one { bản ghi } other { bản ghi } } {count, plural, one { vẫn } other { vẫn }}</b> chưa xuất bản và có thể gây hành vi bất ngờ. ',
  'popUpWarning.warning.publish-question': 'Bạn vẫn muốn xuất bản?',
  'utils.data-loaded': '{number, plural, other {# bản ghi}} đã tải',
  'listView.validation.errors.title': 'Cần xử lý',
  'listView.validation.errors.message':
    'Hãy đảm bảo mọi trường hợp lệ trước khi xuất bản (trường bắt buộc, giới hạn ký tự tối thiểu/tối đa, v.v.)',
  'bulk-publish.edit': 'Chỉnh sửa',
  'actions-drawer.open': 'Mở thêm thao tác',
  'actions-drawer.close': 'Đóng thêm thao tác',
};

export const contentManagerListVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(contentManagerListMessages).map(([key, value]) => [
      `${CONTENT_MANAGER_PREFIX}${key}`,
      value,
    ]),
  );
