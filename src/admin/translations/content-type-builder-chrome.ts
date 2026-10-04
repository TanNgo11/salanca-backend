const CONTENT_TYPE_BUILDER_PREFIX = 'content-type-builder.';

export const contentTypeBuilderChromeMessages: Record<string, string> = {
  'button.attributes.add.another': 'Thêm trường khác',
  'button.component.add': 'Thêm thành phần',
  'button.component.create': 'Tạo thành phần mới',
  'button.model.create': 'Tạo danh sách nội dung mới',
  'button.single-types.create': 'Tạo nội dung đơn mới',
  'components.SelectComponents.displayed-value':
    'Đã chọn {number, plural, =0 {# thành phần} other {# thành phần}}',
  configurations: 'Cấu hình',
  'contentType.apiId-plural.description': 'API ID số nhiều',
  'contentType.apiId-plural.label': 'API ID (số nhiều)',
  'contentType.apiId-singular.description':
    'UID dùng để sinh tuyến API và bảng/collection trong cơ sở dữ liệu',
  'contentType.apiId-singular.label': 'API ID (số ít)',
  'contentType.collectionName.description':
    'Dùng khi tên loại nội dung khác tên bảng dữ liệu',
  'contentType.collectionName.label': 'Tên bảng dữ liệu',
  'contentType.displayName.label': 'Tên hiển thị',
  'contentType.kind.change.warning':
    'Bạn vừa đổi loại nội dung: API sẽ được đặt lại (route, controller và service sẽ bị ghi đè).',
  'error.attributeName.reserved-name':
    'Không dùng được tên này trong loại nội dung vì có thể làm hỏng chức năng khác',
  'error.contentType.pluralName-used': 'Giá trị này không được trùng với dạng số ít',
  'error.contentType.singularName-used': 'Giá trị này không được trùng với dạng số nhiều',
  'error.contentType.singularName-equals-pluralName':
    'Giá trị này không được trùng API ID số nhiều của loại nội dung khác.',
  'error.contentType.pluralName-equals-singularName':
    'Giá trị này không được trùng API ID số ít của loại nội dung khác.',
  'error.contentType.pluralName-equals-collectionName':
    'Giá trị này đã được loại nội dung khác dùng.',
  'error.contentTypeName.reserved-name':
    'Không dùng được tên này trong dự án vì có thể làm hỏng chức năng khác',
  'error.category.format':
    'Tên nhóm phải bắt đầu bằng chữ cái và chỉ gồm chữ, số, gạch ngang và gạch dưới',
  'error.validation.enum-duplicate':
    'Không được trùng giá trị (chỉ tính ký tự chữ và số).',
  'error.validation.enum-empty-string': 'Không được để chuỗi trống',
  'error.validation.enum-regex':
    'Có ít nhất một giá trị không hợp lệ. Giá trị phải có ít nhất một chữ cái trước số đầu tiên.',
  'error.validation.minSupMax': 'Tối thiểu không được lớn hơn tối đa',
  'error.validation.positive': 'Phải là số dương',
  'error.validation.regex': 'Biểu thức chính quy không hợp lệ',
  'error.validation.relation.targetAttribute-taken': 'Tên này đã có ở phía đích',
  'form.button.add-components-to-dynamiczone': 'Thêm thành phần vào vùng',
  'form.button.add-field': 'Thêm trường khác',
  'form.button.add-first-field-to-created-component': 'Thêm trường đầu tiên vào thành phần',
  'form.button.add.field.to.collectionType': 'Thêm trường khác vào danh sách nội dung này',
  'form.button.add.field.to.component': 'Thêm trường khác vào thành phần này',
  'form.button.add.field.to.contentType': 'Thêm trường khác vào loại nội dung này',
  'form.button.add.field.to.singleType': 'Thêm trường khác vào nội dung đơn này',
  'form.button.cancel': 'Hủy',
  'form.button.submit': 'Gửi',
  'form.button.collection-type.description':
    'Phù hợp nhiều bản ghi như bài viết, sản phẩm, bình luận, v.v.',
  'form.button.collection-type.name': 'Danh sách nội dung',
  'form.button.configure-component': 'Cấu hình thành phần',
  'form.button.configure-view': 'Cấu hình chế độ xem',
  'form.button.select-component': 'Chọn một thành phần',
  'form.button.single-type.description':
    'Phù hợp nội dung đơn như giới thiệu, trang chủ, v.v.',
  'form.button.single-type.name': 'Nội dung đơn',
  from: 'từ',
  'menu.section.components.name': 'Thành phần',
  'menu.section.models.name': 'Danh sách nội dung',
  'menu.section.single-types.name': 'Nội dung đơn',
  'modalForm.attribute.form.base.name.description': 'Tên trường không được có khoảng trắng',
  'modalForm.attribute.form.base.name.placeholder': 'vd: slug, seoUrl, canonicalUrl',
  'modalForm.attribute.target-field': 'Trường gắn kèm',
  'modalForm.attributes.select-component': 'Chọn một thành phần',
  'modalForm.attributes.select-components': 'Chọn các thành phần',
  'modalForm.collectionType.header-create': 'Tạo danh sách nội dung',
  'modalForm.component.header-create': 'Tạo thành phần',
  'modalForm.components.create-component.category.label':
    'Chọn nhóm hoặc nhập tên để tạo nhóm mới',
  'modalForm.components.icon.label': 'Biểu tượng',
  'modalForm.empty.button': 'Thêm trường tùy chỉnh',
  'modalForm.empty.heading': 'Chưa có trường nào',
  'modalForm.empty.sub-heading': 'Tìm phần mở rộng phù hợp trong danh sách.',
  'modalForm.editCategory.base.name.description': 'Tên nhóm không được có khoảng trắng',
  'modalForm.header-edit': 'Sửa {name}',
  'modalForm.header.categories': 'Nhóm',
  'modalForm.header.back': 'Quay lại',
  'modalForm.singleType.header-create': 'Tạo nội dung đơn',
  'modalForm.sub-header.addComponentToDynamicZone': 'Thêm thành phần vào vùng linh hoạt',
  'modalForm.sub-header.attribute.create': 'Thêm trường {type} mới',
  'modalForm.sub-header.attribute.create.step': 'Thêm thành phần mới ({step}/2)',
  'modalForm.sub-header.attribute.edit': 'Sửa {name}',
  'modalForm.sub-header.chooseAttribute.collectionType':
    'Chọn trường cho danh sách nội dung',
  'modalForm.sub-header.chooseAttribute.component': 'Chọn trường cho thành phần',
  'modalForm.sub-header.chooseAttribute.singleType': 'Chọn trường cho nội dung đơn',
  'modalForm.custom-fields.advanced.settings.extended': 'Cài đặt mở rộng',
  'modalForm.tabs.custom': 'Tùy chỉnh',
  'modalForm.tabs.custom.howToLink': 'Cách thêm trường tùy chỉnh',
  'modalForm.tabs.default': 'Mặc định',
  'modalForm.tabs.label': 'Tab loại mặc định và tùy chỉnh',
  'modelPage.attribute.relation-polymorphic': 'Liên kết (đa hình)',
  'modelPage.attribute.relationWith': 'Liên kết với',
  'modelPage.attribute.with': 'với',
  'notification.error.dynamiczone-min.validation':
    'Vùng linh hoạt cần ít nhất một thành phần mới lưu được loại nội dung',
  'notification.info.autoreaload-disable':
    'Strapi đang chạy production nên không sửa được loại nội dung. Hãy chạy strapi develop.',
  'notification.info.creating.notSaved': 'Hãy lưu thay đổi trước khi tạo mới',
  'plugin.description.long':
    'Mô hình hóa cấu trúc dữ liệu API. Tạo trường và liên kết trong vài phút. Tệp được tạo và cập nhật tự động trong dự án.',
  'plugin.description.short': 'Mô hình hóa cấu trúc dữ liệu API.',
  'popUpForm.navContainer.advanced': 'Cài đặt nâng cao',
  'popUpForm.navContainer.base': 'Cài đặt cơ bản',
  'popUpWarning.bodyMessage.cancel-modifications': 'Bạn có chắc muốn hủy các thay đổi?',
  'popUpWarning.bodyMessage.cancel-modifications.with-components':
    'Bạn có chắc muốn hủy các thay đổi? Một số thành phần đã được tạo hoặc sửa...',
  'popUpWarning.bodyMessage.category.delete':
    'Bạn có chắc muốn xóa nhóm này? Mọi thành phần trong nhóm cũng sẽ bị xóa.',
  'popUpWarning.bodyMessage.component.delete': 'Bạn có chắc muốn xóa thành phần này?',
  'popUpWarning.bodyMessage.contentType.delete':
    'Bạn có chắc muốn xóa loại nội dung này?',
  'popUpWarning.draft-publish.button.confirm': 'Xác nhận',
  'popUpWarning.draft-publish.message':
    'Nếu tắt Bản nháp & xuất bản, các bản nháp sẽ bị xóa.',
  'popUpWarning.draft-publish.second-message': 'Bạn có chắc muốn tắt?',
  'popUpWarning.discardAll.message': 'Bạn có chắc muốn bỏ toàn bộ thay đổi?',
  'popUpWarning.bodyMessage.delete-condition': 'Bạn có chắc muốn xóa điều kiện này?',
  'popUpWarning.bodyMessage.delete-attribute-with-conditions':
    'Các trường sau có điều kiện phụ thuộc trường này: ',
  'popUpWarning.bodyMessage.delete-attribute-with-conditions-end':
    '. Bạn có chắc muốn xóa?',
  'prompt.unsaved': 'Bạn có chắc muốn rời trang? Mọi thay đổi sẽ mất.',
  'relation.attributeName.placeholder': 'Vd: author, category, tag',
  'relation.manyToMany': 'có và thuộc về nhiều',
  'relation.manyToOne': 'có nhiều',
  'relation.manyWay': 'có nhiều',
  'relation.oneToMany': 'thuộc về nhiều',
  'relation.oneToOne': 'có và thuộc về một',
  'relation.oneWay': 'có một',
  'table.button.no-fields': 'Thêm trường mới',
  'table.content.create-first-content-type.title': 'Chưa có loại nội dung',
  'table.content.create-first-content-type.description':
    'Tạo danh sách nội dung, nội dung đơn và thành phần để dựng schema.',
  'table.content.create-first-content-type.import-code': 'Nhập từ máy tính',
  'table.content.create-first-content-type.start-with-prompt': 'Bắt đầu bằng mô tả',
  'table.content.no-fields.collection-type':
    'Thêm trường đầu tiên vào danh sách nội dung này',
  'table.content.no-fields.component': 'Thêm trường đầu tiên vào thành phần này',
  'IconPicker.search.placeholder.label': 'Tìm biểu tượng',
  'IconPicker.search.clear.label': 'Xóa tìm kiếm biểu tượng',
  'IconPicker.search.button.label': 'Nút tìm biểu tượng',
  'IconPicker.remove.tooltip': 'Gỡ biểu tượng đã chọn',
  'IconPicker.remove.button': 'Nút gỡ biểu tượng đã chọn',
  'IconPicker.emptyState.label': 'Không tìm thấy biểu tượng',
  'IconPicker.icon.label': 'Chọn biểu tượng {icon}',
  'form.button.finish': 'Hoàn tất',
  'form.button.back': 'Quay lại',
};

export const contentTypeBuilderChromeVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(contentTypeBuilderChromeMessages).map(([key, value]) => [
      `${CONTENT_TYPE_BUILDER_PREFIX}${key}`,
      value,
    ]),
  );
