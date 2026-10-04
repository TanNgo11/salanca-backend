/** Strapi 5.51.1 feedback strings missing from its Vietnamese catalog. */
export const runtimeFeedbackVietnameseTranslations: Record<string, string> = {
  'tours.profile.notification.success.reset': 'Đã đặt lại hướng dẫn sử dụng.',
  'content-manager.preview.copy.success': 'Đã sao chép liên kết xem trước.',
  'content-manager.preview.error.invalid-field-path':
    'Không tìm thấy trường này trong nội dung hiện tại.',
  'content-manager.preview.error.relations-not-handled':
    'Hiện chưa hỗ trợ chỉnh sửa trực tiếp trường liên kết.',
  'content-manager.preview.error.incomplete-strapi-source':
    'Trường này thiếu thông tin cần thiết để xem trước.',
  'content-manager.preview.error.different-document': 'Trường này thuộc một nội dung khác.',
  'content-manager.preview.error.script-failed':
    'Không thể tải chức năng xem trước trực tiếp. Chỉnh sửa trực quan có thể không hoạt động.',
  'content-manager.history.content.missing-assets.title':
    '{number, plural, =1 {Thiếu một tệp} other {Thiếu # tệp}}',
  'content-manager.history.content.missing-assets.message':
    '{number, plural, =1 {Tệp này đã} other {Các tệp này đã}} bị xóa khỏi Thư viện phương tiện và không thể khôi phục.',
  'content-manager.history.content.missing-relations.title':
    '{number, plural, =1 {Thiếu một liên kết} other {Thiếu # liên kết}}',
  'content-manager.history.content.missing-relations.message':
    '{number, plural, =1 {Liên kết này đã} other {Các liên kết này đã}} bị xóa và không thể khôi phục.',
  'content-manager.history.content.new-field.title': 'Trường mới',
  'content-manager.history.content.new-field.message':
    'Trường này chưa tồn tại khi phiên bản được lưu. Nếu khôi phục phiên bản này, trường sẽ để trống.',
  'content-manager.history.content.unknown-fields.title': 'Trường không xác định',
  'content-manager.history.content.unknown-fields.message':
    'Các trường này đã bị xóa hoặc đổi tên và sẽ không được khôi phục.',
  'content-manager.history.restore.success.title': 'Đã khôi phục phiên bản.',
  'content-manager.history.restore.success.message':
    'Đã khôi phục một phiên bản trước của nội dung.',
  'content-manager.history.restore.error.message': 'Không thể khôi phục phiên bản.',
  'content-type-builder.chat.messages.error': 'Đã xảy ra lỗi.',
  'content-type-builder.chat.messages.too-many-requests':
    'Có quá nhiều yêu cầu. Vui lòng thử lại sau.',
  'content-type-builder.chat.messages.license-limit-reached':
    'Đã đạt giới hạn giấy phép. Vui lòng thử lại vào ngày mai.',
  'content-type-builder.chat.messages.license-limit-exceeded': 'Đã vượt giới hạn lượt dùng AI.',
  'content-type-builder.chat.messages.too-long-error':
    'Cuộc trò chuyện đã đạt độ dài tối đa. Vui lòng bắt đầu cuộc trò chuyện mới.',
  'content-type-builder.chat.feedback.error': 'Không thể gửi phản hồi.',
  'content-type-builder.chat.feedback.submitted': 'Cảm ơn bạn đã gửi phản hồi.',
  'content-type-builder.chat.feedback.reason.invalid_schema': 'Cấu trúc dữ liệu không hợp lệ',
  'content-type-builder.chat.figma-upload.no-images': 'Không tìm thấy khung hình nào trong tệp Figma.',
  'content-releases.content-manager-edit-view.add-to-release.notification.success':
    'Đã thêm nội dung vào đợt phát hành.',
  'content-releases.content-manager-edit-view.remove-from-release.notification.success':
    'Đã gỡ nội dung khỏi đợt phát hành.',
  'content-releases.content-manager-list-view.add-to-release.notification.success.title':
    'Đã thêm vào đợt phát hành.',
  'content-releases.content-manager-list-view.add-to-release.notification.success.message':
    '{entriesAlreadyInRelease}/{totalEntries} nội dung đã có trong đợt phát hành.',
  'content-releases.content-manager.notification.entry-error': 'Không thể tải dữ liệu nội dung.',
  'content-releases.modal.release-created-notification-success': 'Đã tạo đợt phát hành.',
  'content-releases.modal.release-updated-notification-success': 'Đã cập nhật đợt phát hành.',
  'content-releases.pages.ReleaseDetails.publish-notification-success': 'Đã phát hành thành công.',
  'content-releases.pages.Releases.notification.error.title': 'Không thể xử lý yêu cầu.',
  'content-releases.pages.Releases.notification.error.message':
    'Vui lòng thử lại hoặc mở một đợt phát hành khác.',
  'content-releases.pages.Releases.max-limit-reached.title':
    'Bạn đã đạt giới hạn {number} đợt phát hành đang chờ.',
  'content-releases.pages.Releases.max-limit-reached.message':
    'Vui lòng nâng cấp gói để quản lý không giới hạn số đợt phát hành.',
  'content-releases.pages.Releases.max-limit-reached.action': 'Xem các gói',
  'content-releases.pages.PurchaseRelease.not-available':
    'Tính năng Đợt phát hành chỉ có trong gói trả phí. Vui lòng nâng cấp để sử dụng.',
  'content-releases.modal.form.time.has-passed': 'Thời điểm đã chọn đã qua.',
  'content-releases.pages.Settings.releases.setting.default-timezone-notification-success':
    'Đã cập nhật múi giờ mặc định.',
  'content-releases.pages.ReleaseDetails.entry-validation.fields.error':
    'Có {errors} lỗi ở các trường.',
  'content-releases.pages.ReleaseDetails.entry-validation.fields': 'Các trường',
  'content-releases.pages.ReleaseDetails.entry-validation.fields.success':
    'Tất cả các trường đã được điền đúng.',
  'content-releases.pages.ReleaseDetails.entry-validation.fields.see-errors': 'Xem lỗi',
  'content-releases.pages.ReleaseDetails.entry-validation.not-ready': 'Chưa sẵn sàng để xuất bản',
  'content-releases.pages.ReleaseDetails.entry-validation.already-published': 'Đã xuất bản',
  'content-releases.pages.ReleaseDetails.entry-validation.ready-to-publish': 'Sẵn sàng xuất bản',
  'content-releases.pages.ReleaseDetails.entry-validation.modified':
    'Sẵn sàng xuất bản các thay đổi',
  'content-releases.pages.ReleaseDetails.entry-validation.already-unpublished': 'Đã ngừng xuất bản',
  'content-releases.pages.ReleaseDetails.entry-validation.ready-to-unpublish': 'Sẵn sàng ngừng xuất bản',
  'content-releases.pages.ReleaseDetails.entry-validation.review-stage.not-ready':
    'Nội dung chưa ở bước cần thiết để xuất bản. ({stageName})',
  'content-releases.pages.ReleaseDetails.entry-validation.review-stage.not-enabled':
    'Nội dung này chưa được gắn với quy trình duyệt.',
  'content-releases.pages.ReleaseDetails.entry-validation.review-stage.ready':
    'Nội dung đang ở đúng bước để xuất bản. ({stageName})',
  'content-releases.pages.ReleaseDetails.entry-validation.review-stage.stage-not-required':
    'Không yêu cầu bước duyệt để xuất bản.',
  'review-workflows.assignee.notification.saved': 'Đã cập nhật người phụ trách.',
  'review-workflows.assignee.error': 'Không thể tải danh sách người dùng.',
  'review-workflows.stage.notification.saved': 'Đã cập nhật bước duyệt.',
  'review-workflows.stage.notification.error': 'Không thể cập nhật bước duyệt.',
  'review-workflows.settings.not-available':
    'Quy trình duyệt chỉ có trong phiên bản Enterprise. Vui lòng nâng cấp để sử dụng.',
  'review-workflows.stages.no-transition': 'Bạn không có quyền cập nhật bước này.',
  'review-workflows.stages.save-first': 'Hãy lưu nội dung trước khi chọn bước duyệt.',
  'review-workflows.stages.single-stage':
    'Quy trình này chỉ có một bước. Hãy thêm bước để có thể chuyển trạng thái.',
  'review-workflows.stages.limit.title': 'Gói hiện tại đã đạt giới hạn số bước duyệt',
  'review-workflows.stages.limit.body':
    'Hãy xóa bớt bước hoặc liên hệ bộ phận kinh doanh để mở rộng giới hạn.',
  'review-workflows.workflows.limit.title': 'Gói hiện tại đã đạt giới hạn số quy trình duyệt',
  'review-workflows.workflows.limit.body':
    'Hãy xóa bớt quy trình hoặc liên hệ bộ phận kinh doanh để mở rộng giới hạn.',
};
