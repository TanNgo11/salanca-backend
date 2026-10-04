const CONTENT_TYPE_BUILDER_PREFIX = 'content-type-builder.';

export const contentTypeBuilderAttributeMessages: Record<string, string> = {
  'attribute.boolean': 'Đúng/Sai',
  'attribute.boolean.description': 'Có hoặc không, 1 hoặc 0, true hoặc false',
  'attribute.component': 'Thành phần',
  'attribute.component.description': 'Nhóm trường có thể lặp lại hoặc tái sử dụng',
  'attribute.customField': 'Trường tùy chỉnh',
  'attribute.date': 'Ngày',
  'attribute.date.description': 'Bộ chọn ngày có giờ, phút và giây',
  'attribute.datetime': 'Ngày giờ',
  'attribute.dynamiczone': 'Vùng linh hoạt',
  'attribute.dynamiczone.description': 'Chọn thành phần động khi sửa nội dung',
  'attribute.email': 'Email',
  'attribute.email.description': 'Trường email có kiểm tra định dạng',
  'attribute.enumeration': 'Danh sách lựa chọn',
  'attribute.enumeration.description': 'Danh sách giá trị, chọn một',
  'attribute.json': 'JSON',
  'attribute.json.description': 'Dữ liệu định dạng JSON',
  'attribute.media': 'Tệp phương tiện',
  'attribute.media.description': 'Tệp như ảnh, video, v.v.',
  'attribute.null': ' ',
  'attribute.number': 'Số',
  'attribute.number.description': 'Số (nguyên, thực, thập phân)',
  'attribute.password': 'Mật khẩu',
  'attribute.password.description': 'Trường mật khẩu có mã hóa',
  'attribute.relation': 'Liên kết',
  'attribute.relation.description': 'Trỏ tới một danh sách nội dung',
  'attribute.richtext': 'Văn bản định dạng (cũ)',
  'attribute.richtext.description': 'Trình soạn thảo rich text cổ điển',
  'attribute.blocks': 'Rich text (Blocks)',
  'attribute.blocks.description': 'Trình soạn thảo rich text dựa trên JSON',
  'attribute.text': 'Văn bản',
  'attribute.text.description': 'Văn bản ngắn hoặc dài như tiêu đề hoặc mô tả',
  'attribute.time': 'Giờ',
  'attribute.timestamp': 'Dấu thời gian',
  'attribute.uid': 'UID',
  'attribute.uid.description': 'Định danh duy nhất',
  'media.multiple': 'Nhiều tệp',
  'component.repeatable': 'Lặp lại',
  'components.componentSelect.no-component-available': 'Bạn đã thêm hết các thành phần',
  'components.componentSelect.no-component-available.with-search':
    'Không có thành phần nào khớp tìm kiếm',
  'components.componentSelect.value-component':
    'Đã chọn {number} thành phần (gõ để tìm thành phần)',
  'components.componentSelect.value-components': 'Đã chọn {number} thành phần',
  'form.attribute.component.option.add': 'Thêm thành phần',
  'form.attribute.component.option.create': 'Tạo thành phần mới',
  'form.attribute.component.option.create.description':
    'Thành phần dùng chung giữa các loại nội dung, có thể dùng ở mọi nơi.',
  'form.attribute.component.option.repeatable': 'Thành phần lặp lại',
  'form.attribute.component.option.repeatable.description':
    'Phù hợp khi cần nhiều mục (mảng) như nguyên liệu, thẻ meta, v.v.',
  'form.attribute.component.option.reuse-existing': 'Dùng thành phần có sẵn',
  'form.attribute.component.option.reuse-existing.description':
    'Tái sử dụng thành phần đã tạo để giữ dữ liệu nhất quán giữa các loại nội dung.',
  'form.attribute.component.option.single': 'Thành phần đơn',
  'form.attribute.component.option.single.description':
    'Phù hợp để nhóm trường như địa chỉ đầy đủ, thông tin chính, v.v.',
  'form.attribute.item.customColumnName': 'Tên cột tùy chỉnh',
  'form.attribute.item.customColumnName.description':
    'Đổi tên cột trong cơ sở dữ liệu cho dễ đọc hơn trong phản hồi API',
  'form.attribute.item.date.type.date': 'ngày (vd: 01/01/{currentYear})',
  'form.attribute.item.date.type.datetime': 'ngày giờ (vd: 01/01/{currentYear} 00:00 AM)',
  'form.attribute.item.date.type.time': 'giờ (vd: 00:00 AM)',
  'form.attribute.item.defineRelation.fieldName': 'Tên trường',
  'form.attribute.item.enumeration.graphql': 'Ghi đè tên GraphQL',
  'form.attribute.item.enumeration.graphql.description':
    'Cho phép ghi đè tên GraphQL được sinh mặc định',
  'form.attribute.item.enumeration.placeholder': 'Vd:\nsáng\ntrưa\ntối',
  'form.attribute.item.enumeration.rules': 'Các giá trị (mỗi dòng một giá trị)',
  'form.attribute.item.maximum': 'Giá trị tối đa',
  'form.attribute.item.maximumComponents': 'Số thành phần tối đa',
  'form.attribute.item.maximumLength': 'Độ dài tối đa',
  'form.attribute.item.minimum': 'Giá trị tối thiểu',
  'form.attribute.item.minimumComponents': 'Số thành phần tối thiểu',
  'form.attribute.item.minimumLength': 'Độ dài tối thiểu',
  'form.attribute.item.number.type': 'Định dạng số',
  'form.attribute.item.number.type.biginteger': 'số nguyên lớn (ex: 123456789)',
  'form.attribute.item.number.type.decimal': 'số thập phân (ex: 2.22)',
  'form.attribute.item.number.type.float': 'số thực (ex: 3.33333333)',
  'form.attribute.item.number.type.integer': 'số nguyên (ex: 10)',
  'form.attribute.item.privateField': 'Trường riêng tư',
  'form.attribute.item.privateField.description':
    'Trường này không xuất hiện trong phản hồi API',
  'form.attribute.item.requiredField': 'Trường bắt buộc',
  'form.attribute.item.requiredField.description':
    'Không tạo được bản ghi nếu trường này trống',
  'form.attribute.item.text.regex': 'Mẫu RegExp',
  'form.attribute.item.text.regex.description': 'Nội dung biểu thức chính quy',
  'form.attribute.item.uniqueField': 'Trường duy nhất',
  'form.attribute.item.uniqueField.description':
    'Không tạo được bản ghi nếu đã có bản ghi trùng nội dung',
  "form.attribute.item.uniqueField.v5.willBeDisabled'":
    'Hiện trường duy nhất chưa hoạt động đúng trong thành phần. Nếu tắt tính năng này, trường sẽ bị vô hiệu cho đến khi được sửa.',
  'form.attribute.item.uniqueField.v5.disabled':
    'Hiện trường duy nhất chưa hoạt động đúng trong thành phần. Trường này đã bị vô hiệu cho đến khi được sửa.',
  'form.attribute.media.allowed-types': 'Chọn loại tệp phương tiện được phép',
  'form.attribute.media.allowed-types.option-files': 'Tệp',
  'form.attribute.media.allowed-types.option-images': 'Ảnh',
  'form.attribute.media.allowed-types.option-videos': 'Video',
  'form.attribute.media.option.multiple': 'Nhiều tệp phương tiện',
  'form.attribute.media.option.multiple.description':
    'Phù hợp slider, carousel hoặc tải nhiều tệp',
  'form.attribute.media.option.single': 'Một tệp phương tiện',
  'form.attribute.media.option.single.description':
    'Phù hợp ảnh đại diện, ảnh hồ sơ hoặc ảnh bìa',
  'form.attribute.settings.default': 'Giá trị mặc định',
  'form.attribute.text.option.long-text': 'Văn bản dài',
  'form.attribute.text.option.long-text.description':
    'Phù hợp mô tả, tiểu sử. Tìm kiếm khớp chính xác bị tắt.',
  'form.attribute.text.option.short-text': 'Văn bản ngắn',
  'form.attribute.text.option.short-text.description':
    'Phù hợp tiêu đề, tên, liên kết (URL). Đồng thời bật tìm kiếm khớp chính xác.',
  'form.attribute.condition.title': 'Điều kiện',
  'form.attribute.condition.description':
    'Bật/tắt cài đặt trường tùy theo giá trị của một trường Đúng/Sai hoặc danh sách lựa chọn khác.',
  'form.attribute.condition.label': 'Điều kiện',
  'form.attribute.condition.field': 'Trường',
  'form.attribute.condition.operator': 'Toán tử',
  'form.attribute.condition.value': 'Giá trị',
  'form.attribute.condition.operator.is': 'là',
  'form.attribute.condition.operator.isNot': 'không phải',
  'form.attribute.condition.value.true': 'true',
  'form.attribute.condition.value.false': 'false',
  'form.attribute.condition.apply': 'Áp dụng điều kiện',
  'form.attribute.condition.then': 'Thì',
  'form.attribute.condition.action': 'Hành động',
  'form.attribute.condition.action.show': 'Hiện',
  'form.attribute.condition.action.hide': 'Ẩn',
  'form.attribute.condition.no-fields':
    'Không có trường Đúng/Sai hoặc danh sách lựa chọn nào để đặt điều kiện.',
  'form.attribute.condition.enum-change-warning':
    'Các trường sau có điều kiện phụ thuộc trường này: {fieldNames}. Đổi hoặc xóa giá trị enum {values} sẽ làm hỏng các điều kiện đó. Bạn có muốn tiếp tục?',
  'form.attribute.condition.enum-change-warning-values': '. Đổi hoặc xóa giá trị enum ',
  'form.attribute.condition.enum-change-warning-end':
    ' sẽ làm hỏng các điều kiện đó. Bạn có muốn tiếp tục?',
  'form.attribute.condition.field-change-warning':
    'Các trường sau có điều kiện phụ thuộc trường này: {fieldNames}. Đổi tên sẽ làm hỏng các điều kiện đó. Bạn có muốn tiếp tục?',
  'form.attribute.condition.field-change-warning-end':
    '. Đổi tên sẽ làm hỏng các điều kiện đó. Bạn có muốn tiếp tục?',
};

export const contentTypeBuilderAttributeVietnameseTranslations: Record<string, string> =
  Object.fromEntries(
    Object.entries(contentTypeBuilderAttributeMessages).map(([key, value]) => [
      `${CONTENT_TYPE_BUILDER_PREFIX}${key}`,
      value,
    ]),
  );
