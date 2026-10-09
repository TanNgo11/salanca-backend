# Nghiên cứu tham khảo cho lõi bán hàng generic

Ngày cập nhật: 2026-10-10

Đây là tài liệu nghiên cứu. Tài liệu không phải spec và không chứa quyết định triển khai cho
plugin. Các hợp đồng duy nhất của thiết kế nằm trong
[`ordering-core-contracts.md`](ordering-core-contracts.md). Bối cảnh đã chốt là hệ thống sẽ có
cả bán voucher/thẻ quà tặng và dịch vụ đặt lịch hẹn về sau; nghiên cứu dưới đây chỉ ra những dữ
liệu và ranh giới mà một lõi generic cần để không khóa các hướng đó.

Cấu trúc:

- **Phần A — Lõi giao dịch** (vòng 1): trạng thái, tiền, dòng hàng, giá, giữ chỗ, checkout, mã
  đơn, lịch sử, thông báo, mở rộng, nhà hàng, khung plugin Strapi.
- **Phần B — Góc nhìn đa ngành** (vòng 1, rà theo hướng generic).
- **Phần C — Nghiệp vụ bổ sung** (vòng 3).

Mỗi mục giữ khuôn "các hệ thống làm thế nào → best practice". Phần "áp vào plugin" đã chuyển
sang `ordering-core-contracts.md`.

> Ghi chú khôi phục (2026-10-10): vòng 3 đã vô tình thay toàn bộ file bằng Phần C. Phần A và B
> được khôi phục từ nội dung vòng 1 (đã bỏ các đoạn "Áp vào plugin"). **Khi cập nhật file này,
> chỉ sửa hoặc bổ sung, không xoá mục cũ.**

## Nguồn và giấy phép

Các repo được đọc ở đúng commit ghi trong bảng. Chỉ đọc source (clone, không cài, không chạy).
Chỉ dùng để học thiết kế; không chép code từ nguồn GPL.

| Nguồn | Commit | Giấy phép tại commit | Phạm vi đọc |
| --- | --- | --- | --- |
| [Medusa](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603) v2 | `146c46b` | MIT, phần Enterprise có điều khoản riêng | product, order, payment, workflow, event |
| [Vendure](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c) v3 | `e5146b1` | GPLv3 hoặc thương mại | giá, state machine, tax, order modifier |
| [WooCommerce](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183) | `5fb08bd` | GPLv3 | order, refund, giữ hàng, cart hash, Store API, fee, draft/payment link |
| [TastyIgniter cart](https://github.com/tastyigniter/ti-ext-cart/tree/99fcb6208031bf20f9df4cda69f861080339ac62) 4.x | `99fcb62` | MIT | món, tùy chọn, fee, slot/capacity, trạng thái |
| [TastyIgniter local](https://github.com/tastyigniter/ti-ext-local/tree/b8e31850c6168e4195c15f3049944bad354b7e92) 4.x | `b8e3185` | MIT | chi nhánh, working schedule, timeslot, vùng giao |
| [TastyIgniter payregister](https://github.com/tastyigniter/ti-ext-payregister/tree/86d0a991351718c250c9326bf0f741b508e196e6) 4.x | `86d0a99` | MIT | payment gateway, payment log |
| [WebbyCommerce](https://github.com/webbycrown/webbycommerce/tree/27451514df7b9167df1a3d0a8f92c2c45f62a5de) 2.0.x | `2745151` | MIT | khung plugin Strapi, đối chiếu các rủi ro demo |
| [Bagisto](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57) | `3fb8300` | MIT | simple, configurable, bundle, virtual, downloadable, booking |
| [Sylius](https://github.com/Sylius/Sylius/tree/39313695548c709756ee9073bf309fa4ae89365a) | `3931369` | MIT | state machine abstraction và các trục trạng thái |
| [Saleor](https://github.com/saleor/saleor/tree/782a751f622c4a047798ce7084b7c66c0877ec6f) | `782a751` | BSD-3-Clause | gift card, transaction item/event, webhook |
| [Action Scheduler](https://github.com/woocommerce/action-scheduler/tree/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64) | `3a8178f` | GPLv3 | claim, batch, retry, queue runner |

Không đọc: Orderable (phần nghiệp vụ F&B đã có TastyIgniter thay).

## 12 best practice rút ra

1. Trạng thái là dữ liệu có state machine và một đường `transition` duy nhất; guard và lịch sử
   phải chạy cùng giao dịch nghiệp vụ.
2. Trạng thái thanh toán được suy ra từ ledger, không cho controller gán cờ đã trả.
3. Dòng tiền vào, hoàn tiền và điều chỉnh là các bản ghi bất biến, có khóa idempotency.
4. Webhook được lưu nguyên bản trước khi chuẩn hóa; khóa duy nhất của provider chống giao dịch lặp.
5. Catalog, product type, pricing và payment provider có trách nhiệm tách nhau.
6. Dòng hàng chụp tên, giá, option, thuế và dữ liệu hiển thị; không đọc lại catalog để in đơn cũ.
7. Quote và create order dùng cùng pipeline server; thay đổi giá hoặc availability phải trả lỗi có mã.
8. Checkout giữ tài nguyên trong transaction, có hạn hết hạn và idempotency key.
9. Mọi side effect ngoài DB đi qua outbox, retry được và có quan sát delivered/failed.
10. API storefront, nhân viên tạo draft và payment link dùng token khác nhau, có rate limit và audit.
11. Một dòng có thể là hàng vật lý, dịch vụ, voucher hoặc combo; workflow được chọn theo loại dòng/
    fulfillment, không ép toàn app vào một industry module.
12. Dữ liệu cá nhân, mã voucher và payment raw payload có retention, che log và quyền truy cập riêng.

---

# Phần A — Lõi giao dịch

## A1. Trạng thái đơn và máy trạng thái

**Các hệ thống làm thế nào**

- **Vendure:** đơn có một trường `state`. Các bước chuyển khai báo dạng object
  `{ State: { to: [...] } }`. `onTransitionStart` trả về chuỗi lỗi để chặn bước chuyển (ví dụ
  không cho sang `PaymentSettled` nếu tiền chưa đủ), `onTransitionEnd` chạy việc sau đó (ghi lịch
  sử, phân bổ kho, bắn event). Nhiều định nghĩa được gộp lại, rồi kiểm tra lúc khởi động: trạng
  thái không tới được, hoặc trỏ tới trạng thái không tồn tại thì báo lỗi.
  Payment và Fulfillment có máy trạng thái riêng; đơn chỉ được sang `PaymentSettled` /
  `Delivered` khi các bản ghi con ở đúng trạng thái.
  ([default-order-process.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/default-order-process.ts),
  [order-state-machine.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/order-state-machine/order-state-machine.ts),
  [validate-transition-definition.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/common/finite-state-machine/validate-transition-definition.ts))
- **Medusa:** `order.status` chỉ có vài giá trị (`pending`, `completed`, `draft`, `archived`,
  `canceled`, `requires_action`). `payment_status` và `fulfillment_status` **không lưu**, được tính
  ra mỗi lần đọc từ payment collection và fulfillment.
  ([aggregate-status.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/core-flows/src/order/utils/aggregate-status.ts))
- **WooCommerce:** một danh sách trạng thái (`pending`, `processing`, `on-hold`, `completed`,
  `cancelled`, `refunded`, `failed`, cộng `checkout-draft`). Mỗi lần đổi bắn hook theo cặp
  `from_to`, nên code khác có thể gắn vào đúng một bước chuyển.
- **TastyIgniter:** trạng thái là các dòng trong bảng (chủ quán tạo được), có lịch sử trạng thái
  (nhân viên nào, ghi chú, có báo khách không). Cấu hình chọn trạng thái nào tính là "đang xử lý",
  "hoàn tất", "đã huỷ". Có luồng **nhận đơn kèm thời gian trễ** (nhận nhưng báo khách "trễ 15
  phút", tự dời giờ nhận) và **từ chối theo mã lý do soạn sẵn**.
  ([StatusWorkflowManager.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Classes/StatusWorkflowManager.php))
- **WebbyCommerce:** `status` và `payment_status` là enum, ai cũng set được; đơn hiện trong Content
  Manager nên nhân viên sửa thẳng được.

**Best practice**

- Một trường trạng thái đơn, các bước chuyển là dữ liệu, một hàm `transition()` duy nhất có guard
  và hook. Kiểm tra định nghĩa lúc khởi động (cách của Vendure).
- Không lưu trạng thái thanh toán / giao nhận dạng trường set tay; tính ra từ bản ghi con (Medusa,
  Vendure). Vẫn hiển thị đủ 3 trục, nhưng chỉ trục đơn (và các bước xử lý) được lưu.
- Mỗi lần chuyển ghi một dòng lịch sử: ai, từ đâu sang đâu, lúc nào, ghi chú.
- Riêng nhà hàng: "nhận đơn" có thể kèm số phút trễ; "từ chối" chọn từ danh sách lý do có sẵn
  (TastyIgniter). Không lấy kiểu "chủ quán tự tạo trạng thái".

## A2. Thanh toán và hoàn tiền

**Các hệ thống làm thế nào**

- **Vendure:** `Payment { method, amount, state, transactionId, metadata }`, trạng thái
  `Created → Authorized → Settled`, hoặc `Declined` / `Error` / `Cancelled`.
  `Refund { items, shipping, adjustment, total, reason, state, transactionId, lines }` gắn vào một
  payment. Số tiền đơn đã được trả = tổng `payment.amount` trừ các refund đã `Settled`.
  ([order-utils.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/utils/order-utils.ts),
  [refund.entity.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/refund/refund.entity.ts))
- **Medusa:** `payment_collection` (số cần thu, đã authorize, đã capture, đã hoàn), `payment`,
  nhiều `capture`, nhiều `refund` (`amount`, `note`, `created_by`, `idempotency_key`). Đơn có thêm
  bảng `transaction` (số dương là tiền vào, âm là tiền ra, có `reference`) làm sổ cái. Webhook của
  cổng được provider chuẩn hoá thành một hành động (`authorized`, `captured`, `failed`,
  `not_supported`…) cộng số tiền; lõi mới quyết định cập nhật gì.
  ([models/payment](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/payment/src/models),
  [webhook.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/utils/src/payment/webhook.ts),
  [order transaction](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/order/src/models/transaction.ts))
- **WooCommerce:** refund là bản ghi con của đơn. Số tiền hoàn không được vượt số còn hoàn được.
  Ghi ai hoàn, lý do, hoàn theo dòng hàng nào. Hoàn qua cổng hoặc ghi nhận tay; có thể trả lại
  kho. Hoàn hết thì đơn chuyển `refunded`, hoàn một phần thì giữ nguyên trạng thái.
  ([wc-order-functions.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/wc-order-functions.php), hàm `wc_create_refund`)
- **TastyIgniter:** `PaymentLog` lưu nguyên request/response của cổng, thành công hay không, còn
  hoàn được không, đã hoàn lúc nào.
  ([PaymentLog.php](https://github.com/tastyigniter/ti-ext-payregister/blob/86d0a991351718c250c9326bf0f741b508e196e6/src/Models/PaymentLog.php))
- **WebbyCommerce:** thanh toán chỉ là demo; webhook bị bỏ qua; tiền kiểu `decimal`.

**Best practice**

- Sổ cái: tiền vào và tiền ra là các dòng riêng; trạng thái thanh toán của đơn tính từ tổng.
- Lưu sự kiện thô của cổng vào bảng riêng trước khi khớp đơn. Mã giao dịch của cổng là unique ở
  DB để webhook gửi trùng không ghi hai lần.
- Provider trả về dữ liệu đã chuẩn hoá; việc khớp mã đơn, xử lý thiếu/thừa tiền nằm ở lõi.
- Hoàn tiền: không vượt số còn hoàn được, bắt buộc lý do, ghi ai làm, đánh dấu hoàn tay hay qua cổng.
- Tiền lưu số nguyên: Vendure lưu số nguyên đơn vị nhỏ nhất, Medusa dùng BigNumber. WooCommerce,
  TastyIgniter, WebbyCommerce dùng số thực, đây là điểm không nên học.

## A3. Dòng hàng và bản chụp

**Các hệ thống làm thế nào**

- **Medusa:** dòng hàng chụp lại `title`, `product_title`, `variant_title`, `thumbnail`, SKU, giá
  trị tùy chọn, `unit_price`, `compare_at_unit_price`, cờ giá sửa tay. Giảm giá là các dòng
  `adjustment` riêng (`promotion_id`, `code`, `amount`).
  ([line-item.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/order/src/models/line-item.ts))
- **TastyIgniter:** `order_menus` chụp tên món, đơn giá, thành tiền, tùy chọn, ghi chú; mỗi tùy
  chọn đã chọn là một dòng `order_menu_options` có tên, giá, số lượng.
  ([OrderMenu.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/OrderMenu.php),
  [OrderMenuOptionValue.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/OrderMenuOptionValue.php))
- **Vendure:** giữ quan hệ tới biến thể sản phẩm cộng giá lúc đặt (`listPrice`,
  `initialListPrice`); không chụp tên, vì sản phẩm chỉ bị xoá mềm.
- **WebbyCommerce:** đơn chỉ nối quan hệ tới sản phẩm, không lưu số lượng hay giá từng dòng.

**Best practice:** chụp lại mọi thứ in trên hoá đơn tại lúc đặt. Id gốc chỉ để báo cáo, đơn cũ
không bao giờ đọc lại giá hay tên từ bảng hàng. Strapi xoá cứng được, nên bản chụp là bắt buộc,
không như Vendure.

## A4. Tính tiền, tổng và khuyến mãi

**Các hệ thống làm thế nào**

- **Vendure:** mỗi lần tính lại đều chạy theo thứ tự: xoá khuyến mãi cũ, tính giá dòng, thuế, áp
  khuyến mãi (điều kiện + hành động), phí ship, khuyến mãi phí ship, cộng tổng. Cuối cùng **bỏ
  khuyến mãi không giảm được đồng nào** để nó không bị tính lượt dùng.
  ([order-calculator.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/order-calculator/order-calculator.ts))
- **Medusa:** `promotion` (mã, tự động hay nhập mã, giới hạn/đã dùng), `application_method` (cố
  định hay %, áp cho dòng / đơn / phí ship), `rule` (thuộc tính + danh sách giá trị),
  `campaign_budget` (ngân sách). Lượt dùng chỉ ghi khi hoàn tất checkout.
- **WooCommerce:** kiểm coupon theo danh sách: tồn tại, hết lượt, hết lượt của người này, hết hạn,
  đơn tối thiểu/tối đa, sản phẩm/danh mục được áp hoặc bị loại. Mỗi lỗi có mã riêng. Trong lúc
  checkout, lượt dùng được **giữ tạm**, thanh toán xong mới thành lượt thật, huỷ thì trả lại.
  ([class-wc-discounts.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-discounts.php))
- **TastyIgniter:** tổng của đơn là danh sách dòng `order_totals` (`code`, `title`, `value`,
  `priority`): tạm tính, phí giao, coupon, tip, tổng. Mỗi loại phí/giảm là một "condition" cắm
  thêm, chạy theo `priority`.
  ([OrderTotal.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/OrderTotal.php))
- **WebbyCommerce:** lấy `shipping_amount` và `discount_amount` **từ request của client**, cộng
  bằng số thực. Đây là lỗ hổng: client tự gửi giảm giá được.

**Best practice**

- Một hàm thuần tính báo giá từ (dòng hàng, giá từ catalog, quy tắc), chạy ở server, thứ tự bước
  cố định.
- Lưu tổng dạng danh sách dòng có thứ tự (TastyIgniter) để hoá đơn, email, báo cáo đọc cùng một
  nguồn.
- Coupon: điều kiện tách khỏi hành động; lỗi có mã cụ thể; lượt dùng chỉ tính khi đơn thành công
  (giữ tạm trong lúc chờ thanh toán); khuyến mãi không giảm được gì thì không tính lượt.

## A5. Giữ hàng, giữ suất và giới hạn số đơn

**Các hệ thống làm thế nào**

- **WooCommerce:** bảng `wc_reserved_stock` (`order_id`, `product_id`, số lượng, thời điểm giữ,
  thời điểm hết hạn), giữ theo cài đặt `woocommerce_hold_stock_minutes` (mặc định 60 phút). Số còn
  bán được = tồn kho − tổng các lần giữ chưa hết hạn. Ghi bằng khoá bi quan trong transaction,
  **khoá các sản phẩm theo thứ tự id** để hai đơn cùng lúc không deadlock. Đơn rời trạng thái chờ
  thì nhả.
  ([ReserveStock.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php))
- **Vendure:** phân bổ kho khi thanh toán xong (chiến lược thay được); số bán được = tồn − đã phân
  bổ − ngưỡng. Chỉ khoá dòng tồn kho khi việc phân bổ chạy trong cùng transaction với bước kiểm.
- **Medusa:** `reservation_item` cho từng dòng hàng, tạo ngay trong luồng checkout.
- **TastyIgniter:** tồn kho theo chi nhánh, bật/tắt theo dõi từng món, **"hết món đến hết ngày"**
  (`out_of_stock_until`). Giới hạn số đơn mỗi khung giờ, hoặc số món của một danh mục mỗi khung
  giờ, theo thứ trong tuần, khung giờ và hình thức nhận.
  ([Stock.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Stock.php),
  [CheckoutSettingsRequest.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Http/Requests/CheckoutSettingsRequest.php))

**Best practice**

- Mỗi lần giữ có thời điểm hết hạn; "còn lại" luôn tính từ các lần giữ chưa hết hạn, nên không cần
  job dọn mới đúng.
- Kiểm và giữ trong cùng một transaction, khoá theo thứ tự cố định.
- Nhà hàng thường không đếm tồn từng phần; cần "hết món" theo chi nhánh có giờ tự mở lại, và giới
  hạn số đơn theo khung giờ. Bán lẻ dùng tồn kho số lượng; dịch vụ dùng sức chứa theo slot.

## A6. Checkout: tạo đơn an toàn

**Các hệ thống làm thế nào**

- **Medusa** (`completeCartWorkflow`): khoá theo cart (chờ tối đa 30 giây, khoá tự hết sau 2 phút)
  → nếu cart đã có đơn thì trả lại đơn đó → kiểm dòng hàng, thanh toán, giao hàng → hook `validate`
  (chỉ được chặn, không được sửa cart) → tạo đơn → giữ kho → ghi lượt dùng khuyến mãi → bắn
  `order.placed` → **authorize thanh toán ở bước cuối** → ghi transaction → nhả khoá. Lỗi giữa
  chừng thì bước bù trừ huỷ hoặc hoàn khoản đã thu.
  ([complete-cart.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/core-flows/src/cart/workflows/complete-cart.ts))
- **WooCommerce** (Store API): tạo đơn nháp `checkout-draft` và dùng lại trong suốt lúc khách ở
  trang checkout; lưu hash của giỏ để biết giỏ đã đổi; kiểm tra đơn trước khi thanh toán; giữ kho;
  gọi cổng; đổi trạng thái theo kết quả.
  ([Checkout.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php))
- **WebbyCommerce:** không có transaction; trừ kho kiểu đọc-rồi-ghi (hai đơn cùng lúc có thể bán
  quá); tin số tiền client gửi.
  ([order.js](https://github.com/webbycrown/webbycommerce/blob/27451514df7b9167df1a3d0a8f92c2c45f62a5de/server/src/controllers/order.js))

**Best practice**

- Mỗi lần bấm đặt có một `Idempotency-Key` do client sinh, lưu unique; gửi lại cùng key thì trả lại
  đơn cũ.
- Server tính lại mọi thứ; client chỉ gửi hàng, số lượng, tùy chọn, thông tin nhận.
- Kiểm → tạo đơn + dòng hàng + giữ chỗ trong một transaction DB.
- Việc gọi ra ngoài (email, Telegram, API đối tác) chạy sau commit. Bước gọi ra ngoài bắt buộc nằm
  trong luồng thì để cuối và có hàm bù trừ.
- Chống spam đơn ở route tạo đơn: captcha (ví dụ Turnstile) và giới hạn request.

## A7. Mã đơn và quyền xem của khách

**Các hệ thống làm thế nào**

- **Medusa:** `display_id` tự tăng (sequence của DB), thêm `custom_display_id` tùy chọn.
- **Vendure:** mã đơn ngẫu nhiên (chiến lược thay được). Khách vãng lai xem đơn bằng mã **chỉ
  trong một khoảng thời gian** sau khi đặt (mặc định 2 giờ).
  ([order-by-code-access-strategy.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/order-by-code-access-strategy.ts))
- **WooCommerce:** id tăng dần cộng `order_key` ngẫu nhiên cho link của khách.
- **TastyIgniter:** id cộng `hash` cho link xem đơn.
- **WebbyCommerce:** `ORD-<timestamp>-<số ngẫu nhiên 3 chữ số>`, có thể trùng.

**Best practice:** hai định danh. Mã ngắn tăng dần (sequence DB) để nhân viên đọc và làm nội dung
chuyển khoản. Token ngẫu nhiên khó đoán cho link của khách. Tra cứu bằng mã + SĐT phải giới hạn
request và che bớt thông tin.

## A8. Lịch sử và ghi chú trên đơn

**Các hệ thống làm thế nào**

- **Vendure:** một bảng `history_entry` (`type`, `isPublic`, `data`) gom cả ghi chú, đổi trạng
  thái, đổi trạng thái thanh toán/hoàn tiền/giao nhận, áp/bỏ coupon, sửa đơn.
- **WooCommerce:** ghi chú đơn; đánh dấu "ghi chú gửi khách" thì gửi email cho khách. Hệ thống cũng
  tự ghi chú (ví dụ "đã giữ hàng 60 phút").
- **TastyIgniter:** lịch sử trạng thái có nhân viên, ghi chú, có báo khách không.

**Best practice:** một bảng dòng thời gian cho mỗi đơn: loại sự kiện, nội bộ hay hiện cho khách
(`isPublic`), ai làm, dữ liệu kèm theo. Màn hình chi tiết đơn đọc đúng một bảng này.

## A9. Thông báo

**Các hệ thống làm thế nào**

- **WooCommerce:** email gắn với **cặp bước chuyển**. Email "có đơn mới" gửi cho quán chỉ khi đơn
  chuyển từ `pending`/`failed`/`cancelled` sang `processing`/`on-hold`/`completed`, nên đơn bỏ dở
  không thanh toán không làm phiền quán.
  ([class-wc-email-new-order.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/emails/class-wc-email-new-order.php))
- **Vendure, Medusa:** bắn event (`OrderPlacedEvent`, `order.placed`, sự kiện chuyển trạng thái);
  plugin email lọc event và gửi.
- **TastyIgniter:** từng trạng thái có cờ báo khách; email nhận/từ chối có kèm lý do hoặc số phút trễ.

**Best practice:** thông báo theo bước chuyển (hoặc theo thời điểm "đơn thật sự được đặt"), không
theo "vừa tạo bản ghi". Gửi sau commit. Ghi lại đã gửi gì.

## A10. Điểm mở rộng

**Các hệ thống làm thế nào**

- **Vendure:** "strategy" thay được cho từng chính sách: sinh mã đơn, tính giá dòng, phân bổ kho,
  quyền xem đơn của khách, đơn được coi là "đã đặt" khi nào. Order process gộp từ nhiều plugin.
- **Medusa:** workflow có hook đặt tên (`validate`, `orderCreated`) và bước bù trừ.
- **WooCommerce:** action và filter ở gần như mọi chỗ.
- **TastyIgniter:** event hệ thống (`orderAccepted`, `orderRejected`), danh sách "cart condition"
  và "order type" cắm thêm được.

**Best practice:** ít điểm mở rộng nhưng có tên và có kiểu rõ ràng:

- **Strategy** để thay hẳn một chính sách.
- **Hook validate** chỉ được chặn, không được sửa dữ liệu.
- **Filter** chỉnh từng bước trong pipeline giá.
- **Event** sau commit.

Woo mở hook ở khắp nơi nên rất khó nâng cấp; Medusa và Vendure giới hạn điểm mở rộng, dễ giữ ổn
định hơn.

## A11. Nghiệp vụ nhà hàng (TastyIgniter)

- **Tùy chọn món:** nhóm tùy chọn dùng chung (ví dụ "Mức cay") có các lựa chọn và giá. Khi gắn vào
  một món thì đặt thêm: bắt buộc hay không, chọn ít nhất / nhiều nhất bao nhiêu, số lượng miễn phí,
  giá riêng cho món này, lựa chọn mặc định, lựa chọn chỉ hiện khi đã chọn một lựa chọn khác.
  ([MenuItemOption.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuItemOption.php),
  [MenuItemOptionValue.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuItemOptionValue.php))
- **Món bán được khi nào:** theo chi nhánh; theo bữa (khung giờ, có lặp lại); theo hình thức nhận;
  số lượng tối thiểu. ([Mealtime.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Mealtime.php))
- **Cài đặt theo chi nhánh × hình thức nhận:** độ dài khung giờ (tối thiểu 5 phút), thời gian
  chuẩn bị, có cộng thêm thời gian chuẩn bị không, đặt trước tối thiểu/tối đa bao nhiêu ngày, khách
  được tự huỷ đến trước giờ nhận bao nhiêu phút (0 = không cho tự huỷ), đơn tối thiểu, cờ "giao
  ngay".
  ([CollectionSettingsRequest.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Http/Requests/CollectionSettingsRequest.php))
- **Vùng giao:** mỗi chi nhánh có các vùng (hình tròn hoặc đa giác) với điều kiện phí theo tổng
  đơn (mọi đơn / trên mức / dưới mức), có thứ tự ưu tiên.
  ([LocationArea.php](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Models/LocationArea.php),
  [CoveredAreaCondition.php](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/CoveredAreaCondition.php))
- **Đơn:** gắn chi nhánh, hình thức nhận, ngày giờ nhận hoặc "giao ngay", nhân viên được giao xử
  lý, `hash` cho link của khách, IP và user agent.

**Best practice:** các cài đặt nhận đơn nằm theo chi nhánh × hình thức nhận; tùy chọn món theo mô
hình "nhóm dùng chung + cấu hình khi gắn vào món". Đây là nghiệp vụ của một loại hàng (món ăn),
không phải cột bắt buộc của lõi.

## A12. Khung plugin Strapi và chấm WebbyCommerce

**Học được về khung**

- `package.json` khai báo `strapi.kind: "plugin"`, có `exports` cho `./strapi-server` và
  `./strapi-admin`, có script `strapi-plugin build` / `watch` / `watch:link` / `verify`,
  `peerDependencies` là `@strapi/strapi ^5`.
- Plugin này trỏ `exports` thẳng vào source JS nên không cần build. Plugin viết TypeScript thì
  phải build: **cần kiểm khi dựng plugin trống**.
- Cài đặt plugin lưu trong `strapi.store`, kể cả SMTP password, và `validator` của config để
  rỗng: ví dụ không nên làm.

**Chấm theo checklist 7 câu**

| Câu hỏi | Kết quả |
| --- | --- |
| Checkout tính lại giá ở server? | Một phần: giá món đọc từ DB, nhưng phí ship và giảm giá lấy từ client |
| Dòng hàng có bản chụp? | Không, chỉ quan hệ tới sản phẩm |
| Tạo đơn có transaction? | Không |
| Đổi trạng thái qua một chỗ? | Không, set enum ở nhiều nơi; đơn sửa được trong Content Manager |
| Webhook có xác thực, chống trùng? | Không có webhook thật (thanh toán là demo) |
| Tiền là số nguyên? | Không, `decimal` + `parseFloat` |
| Có test? | Không |

Kết luận: chỉ dùng làm mẫu cấu trúc thư mục và cách khai báo plugin.

## A13. Không lấy

- **Medusa:** region, đa tiền tệ, sales channel, phiên bản đơn, đổi/trả hàng đầy đủ.
- **Vendure:** đa kênh, nhiều người bán, bước authorize thẻ.
- **WooCommerce:** đơn nháp tạo ngay khi khách đang điền form (sinh nhiều đơn nháp rác), hook ở
  khắp nơi.
- **TastyIgniter:** chủ quán tự tạo trạng thái đơn; tồn kho đếm từng phần cho mọi món.

---

# Phần B — Góc nhìn đa ngành

## B1. Ranh giới module và chiều phụ thuộc

**Các hệ thống làm thế nào**

- Medusa tách module bằng bảng riêng; module không FK trực tiếp sang module khác. Quan hệ được
  biểu diễn bằng link module, như `product-variant-inventory-item` (có `required_quantity`, tức một
  biến thể tiêu hao nhiều inventory item: combo/kit), và dòng hàng giữ id nguồn dạng text cùng
  snapshot.
  ([module links](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/link-modules/src/definitions),
  [line item](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/order/src/models/line-item.ts))
- Vendure đăng ký payment, shipping, promotion và strategy bằng operation definition; lõi gọi
  handler qua contract, thay vì biết chi tiết provider.
  ([configurable operations](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/common/configurable-operation.ts))
- WebbyCommerce cho thấy plugin Strapi có thể khai báo `strapi.kind: "plugin"`, exports server/admin
  và lưu setting trong `strapi.store`, nhưng phần checkout của nó không đạt các invariant cần thiết.

**Best practice:** dữ liệu do module nào sở hữu thì module đó ghi; module khác giữ ref định danh
và snapshot. Provider chỉ chuẩn hoá I/O. Contract có version, capability và validator; không cho
app import ngược lõi.

## B2. Hàng bán được (sellable) và dòng hàng

**Các hệ thống làm thế nào**

- Medusa dựng line item từ variant rồi gộp theo variant + metadata (cấu hình) + giá tùy chỉnh.
  ([`prepareLineItemData`](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/core-flows/src/cart/utils/prepare-line-item-data.ts))
- WooCommerce tạo cart id từ product, variation, attributes và `cart_item_data`; factory chọn loại
  simple/variable/grouped/external, có filter để thêm loại.
  ([`WC_Cart::generate_cart_id`](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-cart.php),
  [`WC_Product_Factory`](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-product-factory.php))
- Vendure tách giá niêm yết của variant (`ProductVariantPriceCalculationStrategy`) khỏi giá tính
  theo custom fields của order line (`OrderItemPriceCalculationStrategy`, ví dụ khắc chữ, topping).
  ([`ProductVariantPriceCalculationStrategy`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/catalog/product-variant-price-calculation-strategy.ts))
- TastyIgniter dùng interface `Buyable` (`getBuyableIdentifier/Name/Price`) để chuẩn hoá món, nên
  cart không cần biết model nguồn.
  ([`Buyable`](https://github.com/tastyigniter/ti-ext-cart/tree/99fcb6208031bf20f9df4cda69f861080339ac62/src/Contracts))

**Best practice:** hàng bán được cần biết loại hàng, biến thể, nhóm tùy chọn, combo/kit và tiền;
adapter chịu trách nhiệm i18n, Draft & Publish, đổi `decimal` sang số nguyên và khả dụng. Snapshot
dòng phải đủ để in hoá đơn, không đọc lại catalog. Gộp dòng bằng khoá chuẩn hoá chứa ref + lựa chọn
tùy chọn + giá, không bằng title hay thứ tự JSON client gửi.

## B3. Giá và tiền

**Các hệ thống làm thế nào**

- Vendure chạy pipeline giá dòng → thuế → promotion → phí ship và bỏ promotion không giảm được gì.
  ([`OrderCalculator`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/order-calculator/order-calculator.ts))
- Medusa tách price list/application method khỏi adjustment; WooCommerce kiểm điều kiện coupon và
  giữ lượt dùng; TastyIgniter lưu các dòng `order_totals` có `priority`.
- WebbyCommerce nhận phí ship/giảm giá từ client; đó là lỗi thiết kế, không được lấy lại.

**Best practice:** một pricing pipeline ở server, tiền số nguyên, currency không hardcode trong tên
field, `priceIncludesTax` rõ ràng, giá niêm yết tách giá do cấu hình dòng. Giá theo chi nhánh/kênh
là input của adapter/strategy, không phải FK cứng của lõi.

## B4. Tồn kho và khả dụng nhiều mức

**Các hệ thống làm thế nào**

- WooCommerce giữ stock theo order/product với hạn hết hạn, lock theo product id trong transaction
  ([`ReserveStock`](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php)).
- Vendure phân bổ sau thanh toán; Medusa tạo `reservation_item` trong checkout.
- TastyIgniter hỗ trợ bật/tắt theo dõi món, `out_of_stock_until`, chi nhánh và giới hạn số đơn theo
  khung giờ ([`Stock`](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Stock.php)).

**Best practice:** khả dụng phân tầng: không theo dõi / bật-tắt / số lượng / sức chứa theo thời
gian. Giữ chỗ có hạn và được tính động; lock theo thứ tự ổn định để giảm deadlock.

## B5. PaymentProvider và webhook

**Các hệ thống làm thế nào**

- **Medusa** `AbstractPaymentProvider`: `static validateOptions`, `initiatePayment`,
  `authorizePayment`, `capturePayment`, `cancelPayment`, `deletePayment`, `getPaymentStatus`,
  `refundPayment`, `retrievePayment`, `updatePayment`, và `getWebhookActionAndData` chuẩn hoá
  webhook thành action (`authorized`, `captured`, `failed`, `pending`, `requires_more`, `canceled`,
  `not_supported`) kèm số tiền.
  ([abstract-payment-provider.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/utils/src/payment/abstract-payment-provider.ts))
- **Vendure** `PaymentMethodHandler` tách create/settle/cancel/refund; `PaymentMethodEligibilityChecker`
  quyết định phương thức có dùng được cho đơn không. `PaymentMethod` là instance do admin tạo, gồm
  `code`, `enabled`, `handler {code, args}`, `checker {code, args}`; tham số có schema
  (`type`, `required`, `defaultValue`, `label`, `ui`).
  ([Vendure payment config](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/payment))
- **WooCommerce** gateway khai báo `supports[]` (products, refunds…), `is_available()` (bật,
  `max_amount`, quốc gia), `process_payment`, `process_refund`, form cài đặt riêng của gateway;
  webhook qua `wc-api`.
  ([abstract-wc-payment-gateway.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/abstracts/abstract-wc-payment-gateway.php))
- **TastyIgniter** `BasePaymentGateway`: URL webhook (`registerEntryPoints`), form cấu hình, khả
  năng tách thành trait (`WithApplicableFee` với đơn tối thiểu và phí cộng thêm, `WithAuthorizedPayment`,
  `WithPaymentProfile`, `WithPaymentRefund`); `Payment` là instance do admin tạo (bật/tắt, mặc định,
  thứ tự, đơn tối thiểu, phí); `PaymentLog` giữ request/response.
  ([PaymentLog.php](https://github.com/tastyigniter/ti-ext-payregister/blob/86d0a991351718c250c9326bf0f741b508e196e6/src/Models/PaymentLog.php))
- **VNPAY IPN** là server-to-server: kiểm checksum trước, rồi đơn có tồn tại, số tiền khớp, trạng
  thái còn chờ; trả `RspCode`: `00` thành công, `01` không thấy đơn, `02` đã xác nhận trước đó,
  `04` sai số tiền, `97` sai chữ ký, `99` lỗi khác. `00`/`02` kết thúc; mã khác hoặc timeout thì
  VNPAY gọi lại tối đa 10 lần, cách 5 phút. VNPAY 2.1 dùng HMACSHA512.
  ([VNPAY IPN](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html),
  [VNPAY checksum](https://sandbox.vnpayment.vn/apis/docs/chuyen-doi-thuat-toan/changeTypeHash.html))
- **MoMo IPN:** POST JSON tới `ipnUrl`, kiểm chữ ký, đối chiếu `PartnerCode`, `OrderId`, `Amount`
  với dữ liệu của mình; trả HTTP 204 (không cần body) trong 15 giây.
  ([MoMo IPN](https://developers.momo.vn/v3/vi/docs/payment/api/result-handling/notification/))
- **SePay:** xem C10.

**Best practice:** capability thay vì ép mọi cổng qua authorize; lưu sự kiện thô trước, chuẩn hoá
sau; unique mã giao dịch của cổng; hàng chờ giao dịch chưa khớp; job đối soát; refund không vượt số
còn được hoàn; provider không tự đổi trạng thái đơn. **Phản hồi HTTP của webhook khác nhau theo
cổng và có cổng phụ thuộc kết quả xử lý** (VNPAY trả mã theo kết quả; SePay khuyên trả lời ngay rồi
xử lý sau).

## B6. FulfillmentProvider và địa chỉ Việt Nam

**Các hệ thống làm thế nào**

- Medusa `AbstractFulfillmentProviderService`: `getFulfillmentOptions`, `validateFulfillmentData`,
  `validateOption`, `canCalculate`, `calculatePrice`, `createFulfillment`, `cancelFulfillment`,
  documents/labels, return. Mô hình `fulfillment_set` (shipping/pickup) theo stock location →
  `service_zone` → `geo_zone`; `shipping_option` có provider, rules, price type; `fulfillment` lưu
  trạng thái bằng mốc thời gian `packed_at` / `shipped_at` / `delivered_at` / `canceled_at`.
  ([fulfillment models](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/fulfillment))
- Vendure dùng `ShippingCalculator` (trả `price`, `priceIncludesTax`, `taxRate`, `metadata`),
  `ShippingEligibilityChecker` và `FulfillmentHandler`, đăng ký dạng configurable operation.
  ([shipping config](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/shipping-method))
- TastyIgniter coi collection/delivery là order type; vùng giao và phí theo tổng đơn
  ([`LocationArea`](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Models/LocationArea.php)).
- **Địa chỉ:** từ 01/07/2025 Việt Nam dùng 34 tỉnh/thành và 3.321 đơn vị cấp xã theo Quyết định
  19/2025/QĐ-TTg; không còn cấp huyện.
  ([Báo Chính phủ](https://baochinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-3321-don-vi-hanh-chinh-cap-xa-moi-102250704153652947.htm),
  [PDF quyết định](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/19ttg.signed.pdf))

**Best practice:** nhận tại chỗ, cửa hàng tự giao và hãng vận chuyển cùng một contract; tính phí,
điều kiện dùng được, slot, tạo vận đơn, theo dõi, huỷ là các capability độc lập. Lưu địa chỉ snapshot
trên đơn; không sửa đơn cũ khi danh mục địa chỉ đổi; không hardcode danh mục vào lõi.
**Chưa kiểm:** nguồn đồng bộ danh mục địa chỉ và độ ổn định của mã.

## B7. NotificationProvider

**Các hệ thống làm thế nào**

- Medusa notification: bảng `notification` có `to`, `from`, `channel`, `template`, `data`,
  `trigger_type`, `resource_id/type`, `receiver_id`, `idempotency_key` unique, `external_id`,
  `status`; provider khai báo `channels` (email, sms, feed…); trùng `idempotency_key` thì không gửi
  lại.
  ([notification module](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/notification))
- Vendure/Medusa phát event chuyển trạng thái; WooCommerce gắn email vào cặp transition;
  TastyIgniter gắn cờ thông báo và lý do nhận/từ chối vào status.

**Best practice:** gửi sau commit; template theo event/locale; người nhận do resolver quyết định,
không lấy tùy tiện từ payload; idempotency unique; retry có log và không làm fail giao dịch đơn.

## B8. Cấu hình nhiều tầng

**Các hệ thống làm thế nào**

- Strapi tách config code trong `/config`; plugin config khai báo `default`/`validator`; đọc bằng
  `strapi.plugin('<id>').config(key)`; setting sửa lúc chạy để trong `strapi.store`.
  ([Strapi configurations](https://docs.strapi.io/cms/configurations),
  [plugin Server API](https://docs.strapi.io/cms/plugins-development/server-api))
- Medusa: options của module/provider trong `medusa-config`, provider tự `validateOptions`; secret từ
  env.
- Vendure tách `VendureConfig` (code) khỏi instance PaymentMethod/ShippingMethod/Promotion trong DB;
  có `SettingsStore` với `scope` (global, user, channel…), `readonly`, `requiresPermission`,
  `validate`.
  ([settings-store-types.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/settings-store/settings-store-types.ts))
- Woo gateway dùng settings API riêng; TastyIgniter dùng `defineFieldsConfig` + bản ghi instance.
  WebbyCommerce lưu credential trong store mà không có validator: ví dụ phải tránh.

**Best practice:** code/env cho secret và invariant; setting vận hành cho chủ shop; provider instance
có schema tham số; module bật/tắt riêng; validator fail-fast; RBAC và audit cho setting, transition,
refund; không cho admin đổi graph workflow.

## B9. Điểm mở rộng và contract theo loại hàng

**Các hệ thống làm thế nào:** Vendure thay strategy cho order process, line price, stock allocation
và guest access; Medusa có hook validate/orderCreated và compensation; WooCommerce có action/filter
ở gần mọi điểm; TastyIgniter có event, cart condition và order type.

**Best practice:** ít điểm mở rộng có tên/kiểu: strategy thay policy, validate hook chỉ chặn, price
filter chỉ sửa bước giá, event chạy sau commit. Không mở callback tuỳ ý có quyền ghi DB.

## B10. Khách hàng, quyền xem đơn và dữ liệu cá nhân

**Các hệ thống làm thế nào:** Vendure cho khách vãng lai xem đơn bằng mã trong thời hạn (mặc định
2 giờ) qua strategy; WooCommerce kết hợp id tăng dần với `order_key`; TastyIgniter dùng hash; Medusa
có display id sequence.

**Best practice:** tách mã nhân viên khỏi token link khách; tra cứu có giới hạn request, thời hạn
và che SĐT/địa chỉ; sau này có thể gắn tài khoản nhưng không buộc bảng user vào lõi.

## B11. Workflow theo ngành

**Các hệ thống làm thế nào**

- Vendure có order/payment/fulfillment state machine riêng và transition guard.
- TastyIgniter có nhận đơn kèm phút trễ và từ chối theo lý do, nhưng cho chủ quán tạo status trong DB.
- Medusa giữ order state nhỏ, payment/fulfillment status dẫn xuất từ entity con.

**Best practice:** lõi hiểu cờ chung (`placed`, `terminal`, `fulfilled`, `canceled`) và transition
event; module khai báo bước ngành (F&B: nhận đơn, làm món, sẵn sàng; bán lẻ: đóng gói, gửi; dịch vụ:
đã hẹn, đã phục vụ). Payment/fulfillment state không được set tay trong order.

## B12. Admin/nhân viên và RBAC

**Các hệ thống làm thế nào:** Vendure admin xử lý transition qua service và permission; WooCommerce
order notes/status hooks; TastyIgniter có nhân viên, lịch sử và cờ báo khách. WebbyCommerce cho sửa
enum trong Content Manager, không có ranh giới transition: anti-pattern.

**Best practice:** màn hình admin gọi một command/transition service; quyền tách `order.read`,
`order.transition`, `payment.refund`, `settings.write`, `payment.raw.read`; mỗi lệnh ghi actor vào
dòng thời gian. Không mở CRUD tự do cho trạng thái đơn.

## B13. Kiểm thử độc lập

**Best practice:** app Strapi trống làm fixture; contract test chạy cùng một bộ case cho mọi adapter;
test invariant cho tiền, idempotency, transition, giới hạn hoàn tiền, webhook gửi lại và snapshot;
integration test PostgreSQL cho transaction/lock. WebbyCommerce thiếu transaction, xác thực webhook,
snapshot và test nên chỉ dùng làm mẫu cấu trúc plugin.

---

# Phần C — Nghiệp vụ bổ sung

## C1. Giá thay đổi và hàng hết giữa lúc xem và đặt

Vendure có `ChangedPriceHandlingStrategy` để chọn cách xử lý khi giá trong order khác giá hiện tại.
WooCommerce tạo cart hash và kiểm tra lại trước thanh toán. Cả hai cho thấy quote cũ không thể được
coi là giá cuối cùng. Giá, variant, option và availability phải được đọc lại trong create order.

- [Vendure changed-price strategy](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/changed-price-handling-strategy.ts)
- [Woo Store API validate before payment](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php)

Best practice là giữ `quoteVersion`/hash, re-quote trong create order, và trả mã lỗi ổn định như
`PRICE_CHANGED` hoặc `SELLABLE_UNAVAILABLE`. Client hiển thị lại quote; không tin amount từ client.

## C2. Nhân viên tạo đơn hộ và gửi link thanh toán

Medusa có draft order flow; Vendure có trạng thái draft; WooCommerce có `order-pay` cho người nhận
link thanh toán. Mẫu chung là tách actor nhân viên khỏi khách vãng lai, ghi audit khi sửa giá thủ
công, và dùng token ngẫu nhiên cho link công khai.

- [Medusa draft order flow](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/core/core-flows/src/draft-order)
- [Woo order-pay](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/StoreApi)

Link thanh toán phải có expiry, chỉ cho thao tác payment cần thiết và không thay thế quyền staff.
Override giá cần lý do, người thực hiện và event audit.

## C3. Storefront API dùng chung

Woo Store API và Medusa store routes cung cấp API công khai tách khỏi Admin. Vendure trả lỗi có kiểu
và mã để frontend hiển thị được. Một storefront generic cần các nhóm endpoint: config/capabilities,
quote, create order, tra cứu order bằng token, payment status, cancel và webhook-facing health.

- [Woo Store API](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/StoreApi)
- [Medusa store routes](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/medusa/src/api/store)
- [Vendure ErrorResult](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/api)

Response lỗi nên có `code`, message đã locale hóa ở lớp trình bày, `details` máy đọc được và
`requestId`. Polling payment phải có backoff và giới hạn; webhook cập nhật server, không để client
tự xác nhận đã trả.

## C4. Nâng cấp plugin nhiều app

Medusa để module mang migration riêng. Action Scheduler cho thấy job có claim, retry và log; một
plugin Strapi cần migration versioned, forward-only, backup/rollback runbook và changelog. Migration
không được đổi nghĩa dữ liệu cũ âm thầm. Schema mới phải chạy được trong thời gian app cũ còn online
nếu deployment rolling.

- [Medusa module migrations](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules)
- [Action Scheduler queue runner](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_QueueRunner.php)
- [Strapi server API](https://docs.strapi.io/cms/plugins-development/server-api)

Trong source local Strapi 5.51.1 không có package `@strapi/sdk-plugin` đã cài để xác nhận build;
đây là gate cần plugin fixture, không phải kết luận rằng SDK không hỗ trợ.

## C5. Dữ liệu cá nhân Việt Nam

Tên, số điện thoại, địa chỉ, token truy cập và nội dung chuyển khoản có thể là dữ liệu cá nhân hoặc
dữ liệu liên quan. Nghị định 13/2023/NĐ-CP có hiệu lực từ 01/07/2023. Luật Bảo vệ dữ liệu cá nhân
số 91/2025/QH15 có hiệu lực từ 01/01/2026 theo thông tin của Quốc hội. Nghị định 70/2025/NĐ-CP
liên quan hóa đơn, không thay thế quy định dữ liệu cá nhân.

- [Nghị định 13/2023/NĐ-CP](https://vanban.chinhphu.vn/default.aspx?docid=207759&pageid=27160)
- [Luật 91/2025/QH15, thư viện Quốc hội](http://thuvienso.quochoi.vn/handle/11742/103334)

Thiết kế tốt cần data inventory, purpose/consent theo nghiệp vụ, retention, quyền truy cập và quy
trình xóa hoặc ẩn danh. Log chỉ giữ phần PII cần điều tra; `payment-event.rawPayload` phải mã hóa
hoặc che field nhạy cảm và có retention riêng. Đây là yêu cầu kỹ thuật để review pháp lý, không phải
kết luận hệ thống đã tuân thủ luật.

## C6. Phí cộng thêm

TastyIgniter biểu diễn tổng bằng các dòng có `code`, `title`, `value`, `priority`; WooCommerce có
`WC_Cart_Fees`. Cả hai cho thấy phí dịch vụ, đóng gói, tip và phí fulfillment nên là adjustment có
thứ tự, thay vì thêm cột đặc biệt cho từng loại.

- [TastyIgniter cart conditions](https://github.com/tastyigniter/ti-ext-cart/tree/99fcb6208031bf20f9df4cda69f861080339ac62/src/CartConditions)
- [Woo WC_Cart_Fees](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-cart-fees.php)

Pipeline cần nói rõ phí tính trước hay sau discount, chịu VAT hay không, làm tròn ở đâu và ai được
override. Tip thường cần policy riêng vì có thể thuộc người nhận khác với doanh thu món.

## C7. Voucher và thẻ quà tặng

Saleor tách gift card, gift card event và lock object; gift card là bearer instrument nên mã phải
được bảo vệ. Medusa có cờ gift-card ở product/module. Các nguồn đều cho thấy mã phát hành, số dư,
expiry và redemption history không nên nhét vào `order-line` như một chuỗi duy nhất.

- [Saleor gift card model](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/giftcard/models.py)
- [Saleor gift card ADR](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/docs/adr/0001-gift-cards-remain-bearer-instruments.md)
- [Saleor transaction models](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/payment/models.py)
- [Medusa gift-card module reference](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules)
  (**chưa kiểm** phần gift card của Medusa có thuộc Enterprise không)

Các câu hỏi nghiệp vụ phải được ghi rõ: phát hành sau captured hay sau duyệt thủ công, mã dùng một
lần hay trừ dần, expiry, hoàn voucher chưa dùng, ghi nhận doanh thu khi bán hay khi redeem. Lõi cần
giữ generic fulfillment và ledger; module voucher sở hữu mã, hash mã, balance, redemption event,
lock và audit.

## C8. Dịch vụ đặt lịch hẹn

Bagisto có product type booking và các helper cho appointment, event, rental, table; slot lưu ngày,
thời lượng, break, disabled date, quantity và policy hủy. TastyIgniter tách working schedule,
timeslot, order type và giới hạn slot. Mẫu chung là availability theo resource/location, duration,
buffer, capacity và timezone; giữ chỗ phải có expiry khi thanh toán đang chờ.

- [Bagisto product types](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Type)
- [Bagisto booking helper](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/BookingProduct/src/Helpers/Booking.php)
- [TastyIgniter WorkingSchedule](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingSchedule.php),
  [WorkingTimeslot](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingTimeslot.php),
  [AbstractOrderType](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Classes/AbstractOrderType.php)

Hợp đồng scheduling cần biểu diễn opening hours theo branch × fulfillment, lead time, slot length,
capacity, blackout/holiday, max advance, resource, timezone, deposit/multiple payment và đổi/hủy.

## C9. Module tùy chọn và dữ liệu cần giữ đường lui

| Module | Mẫu tham khảo | Dữ liệu lõi nên giữ |
| --- | --- | --- |
| Báo cáo doanh thu | [Woo analytics](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Admin) | snapshot totals, line, location, tax, payment/refund event |
| Khuyến mãi | [Medusa promotion](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules) và [Vendure promotion](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers) | adjustment code, rule snapshot, usage reservation |
| Phân đơn/cảnh báo | TastyIgniter `StatusWorkflowManager` | assignee, SLA timestamps, transition event |
| Chống gian lận | provider/rule module | risk result, reason code, review event |
| Webhook ra ngoài | [Saleor webhook](https://github.com/saleor/saleor/tree/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/webhook) | outbox event, destination, delivery/retry log |
| Khách hàng/tích điểm | Medusa customer/account holder | customerRef, consent, immutable order snapshot |

Subscription, marketplace, multi-currency và in phiếu bếp nằm ngoài phạm vi nghiên cứu hiện tại.

## C10. Payment (SePay) và hóa đơn

SePay yêu cầu response HTTP 200 hoặc 201, JSON đúng `{"success": true}` và hoàn tất trong 30 giây;
mọi phản hồi khác bị coi là lỗi và SePay gửi lại. Payload có `id`, `gateway`, `transactionDate`,
`accountNumber`, `subAccount`, `code` có thể null, `content`, `transferType`, `description`,
`transferAmount`, `accumulated`, `referenceCode`. `id` được dùng chống trùng; `transferType=out`
không phải tiền khách trả. Provider phải có đường query/list transaction để đối soát, vì webhook
không phải nguồn duy nhất.

- [SePay tích hợp webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook)
- [SePay xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc)
- [SePay xử lý lỗi](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi)
- [SePay danh sách giao dịch](https://developer.sepay.vn/vi/api-giao-dich)
- [SePay tạo QR động](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html) (`acc`, `bank`, `amount`, `des`)

Nghị định 70/2025/NĐ-CP sửa Nghị định 123/2020/NĐ-CP và có hiệu lực 01/06/2025. Dữ liệu hóa đơn
được tham khảo gồm người bán, người mua khi cần, tên hàng/dịch vụ, đơn giá, số lượng, giá thanh toán,
thuế suất, tiền thuế và tổng tiền. Việc Salanca có thuộc diện phải dùng hóa đơn điện tử từ máy tính
tiền hay thời điểm ghi nhận voucher là vấn đề cần kế toán/chủ dự án quyết định.

- [Nghị định 70/2025/NĐ-CP](https://vanban.chinhphu.vn/?docid=213179&lang=vi&pageid=27160)

---

## Phụ lục: Đã đọc

### Vòng 1

Các file source đã đọc được dẫn trực tiếp trong Phần A và Phần B (link ghim commit).

### Vòng 3

- Handoff: [`ordering-research-handoff.md`](ordering-research-handoff.md),
  [`ordering-research-handoff-2.md`](ordering-research-handoff-2.md).
- Strapi 5.51.1 local source: `@strapi/database` transaction/query builder (`transaction`,
  `getConnection`, `forUpdate`); Document Service middleware; Content Manager schema `visible`;
  `config/server.ts` hiện chưa khai báo `cron`; `@strapi/sdk-plugin` chưa có trong node_modules.
  Đây là quan sát source local, cần fixture để xác nhận hành vi runtime.
- Bagisto: [product types](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Type),
  [booking helper](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/BookingProduct/src/Helpers/Booking.php); license MIT.
- Sylius: [state machine abstraction](https://github.com/Sylius/Sylius/tree/39313695548c709756ee9073bf309fa4ae89365a/src/Sylius/Abstraction/StateMachine);
  license MIT.
- Saleor: [gift card model](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/giftcard/models.py),
  [payment models](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/payment/models.py),
  [gift card ADR](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/docs/adr/0001-gift-cards-remain-bearer-instruments.md);
  license BSD-3-Clause.
- Action Scheduler: [queue runner](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_QueueRunner.php),
  [action claim](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_ActionClaim.php),
  [DB store](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/data-stores/ActionScheduler_DBStore.php),
  [GPLv3 license](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/license.txt); chỉ học thiết kế.

### Chưa kiểm được

- Chưa chạy plugin fixture với PostgreSQL để xác nhận lock transaction, Document Service middleware
  ordering/direct DB bypass, relation schema, cron concurrency, Admin permission và Content Manager UI.
- Chưa có tài khoản SePay live để xác nhận delivery/retry và dữ liệu thực tế; các field/response trên
  là contract tài liệu chính thức.
- Chưa có quyết định kế toán/pháp lý cho hóa đơn, VAT, retention cụ thể, phát hành voucher và deposit.
