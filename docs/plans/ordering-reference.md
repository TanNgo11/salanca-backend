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
| [Action Scheduler](https://github.com/woocommerce/action-scheduler/tree/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64) | `3a8178f` | GPLv3 | claim, batch, retry, queue runner, cảnh báo việc quá hạn |
| [TastyIgniter user](https://github.com/tastyigniter/ti-ext-user/tree/3077e34fc9b6ee7a2df3beed79bf5d6171df9fbc) 4.x | `3077e34` | MIT | staff, location được gán, phạm vi đơn |
| [Odoo](https://github.com/odoo/odoo/tree/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale) 18.0 POS | `8749886` | LGPLv3 | ca bán hàng (session), ngày kinh doanh |
| [Strapi Shopify plugin](https://github.com/strapi-community/shopify/tree/8821013cb081196fc41a740bf6a07b33b5a30fb9) | `8821013` | MIT | cấu trúc plugin Strapi 5, custom field, webhook body gốc, mã hóa secret |
| [Strapi Open Mercato plugin](https://github.com/VirtusLab-Open-Source/strapi-plugin-open-mercato/tree/ae30c8bc69e0b70bd89844a93ada190034c4ca63) | `ae30c8b` | MIT | setting mã hóa trong plugin store |
| [Creem Strapi plugin](https://github.com/armitage-labs/creem/tree/cbb07d19b10efdb64399bf924d2cb838da170089/packages/integrations/strapi) | `cbb07d1` | MIT | webhook HMAC, setting trong plugin store |

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

SePay hỗ trợ API Key, HMAC-SHA256 và OAuth 2.0; tài liệu khuyến nghị HMAC với raw body và
`X-SePay-Timestamp`, từ chối timestamp lệch quá 5 phút, dùng HTTPS và whitelist IP. Webhook có thể
mất nếu endpoint sập quá lâu, nên đối soát định kỳ; tài liệu nêu khoảng retry Fibonacci đến lần thứ 8
(tổng khoảng 33 phút) khi bật tự gửi lại. ([xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
[bảo mật](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat),
[xử lý lỗi](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi),
[đối soát giao dịch](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich))

**Best practice:** xác minh chữ ký trước khi parse nghiệp vụ, lưu raw payload và `id` unique trước
khi enqueue, trả đúng body ACK theo provider, bỏ qua `transferType=out`, rồi chạy reconciliation
theo khoảng thời gian. Lịch retry cụ thể và quyền gọi API live vẫn cần kiểm bằng tài khoản thật.

- [SePay tích hợp webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook)
- [SePay xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc)
- [SePay xử lý lỗi](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi)
- [SePay đối soát và danh sách giao dịch](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich)
- [SePay tạo QR động](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html) (`acc`, `bank`, `amount`, `des`)

Nghị định 70/2025/NĐ-CP sửa Nghị định 123/2020/NĐ-CP và có hiệu lực 01/06/2025. Dữ liệu hóa đơn
được tham khảo gồm người bán, người mua khi cần, tên hàng/dịch vụ, đơn giá, số lượng, giá thanh toán,
thuế suất, tiền thuế và tổng tiền. Việc Salanca có thuộc diện phải dùng hóa đơn điện tử từ máy tính
tiền hay thời điểm ghi nhận voucher là vấn đề cần kế toán/chủ dự án quyết định.

- [Nghị định 70/2025/NĐ-CP](https://vanban.chinhphu.vn/?docid=213179&lang=vi&pageid=27160)

## C11. Kết quả đọc source Strapi 5.51.1

**Các file đã đọc và điều xác nhận**

- `@strapi/database/dist/index.js` (`Database.transaction`, `getConnection`) và
  `transaction-context.d.ts`: `strapi.db.transaction(cb)` mở
  transaction khi chưa có transaction lồng, truyền `trx`, `commit`, `rollback`, `onCommit` và
  `onRollback` vào callback, rồi tự commit hoặc rollback. `strapi.db.getConnection()` trả Knex;
  query builder có `.transacting(trx)` và `.forUpdate()`. Context hiện tại được dùng tự động khi
  query builder chạy trong callback. Đây là source package local, đối chiếu version tại
  [Strapi v5.51.1](https://github.com/strapi/strapi/tree/v5.51.1/packages/core/database).
- `@strapi/core/dist/services/document-service/index.js` (`createDocumentService`) và
  `.../middlewares/middleware-manager.js`: `strapi.documents.use()` chỉ bọc các method của
  Document Service; context có `uid`, `action`, `params`, và middleware phải gọi `next()`. Gọi
  thẳng `strapi.db.query()` không đi qua wrapper này. Vì vậy middleware không phải hàng rào duy nhất
  cho bảng order; invariant phải nằm trong service/route của plugin và transaction DB. Đối chiếu
  [Document Service middleware](https://docs.strapi.io/cms/api/document-service/middlewares).
- `@strapi/content-manager/dist/server/services/data-mapper.js` (`isVisible`, `toContentManagerModel`)
  và `content-types.js` (`findDisplayedContentTypes`): Content Manager đọc
  `pluginOptions.content-manager.visible`, mặc định `true`, rồi lọc `isDisplayed`. Đặt `visible: false` sẽ ẩn model khỏi danh sách Content Manager; đây chỉ
  là ẩn giao diện, không phải permission hay bảo vệ database. Đối chiếu
  [Content Manager API](https://github.com/strapi/strapi/tree/v5.51.1/packages/core/content-manager).
- `@strapi/admin/dist/server/server/src/domain/{action,condition}/provider.js` (`register`,
  `registerMany`) và `@strapi/permissions/dist/engine/index.js` (`evaluate`, `generateAbility`):
  action/condition phải đăng ký trước khi Strapi loaded; condition được resolve và evaluate thành
  `true`/`false` hoặc query điều kiện. Đây là cơ chế xây
  permission, không tự tạo bộ lọc chi nhánh cho route custom. Đối chiếu
  [Strapi server API](https://docs.strapi.io/cms/plugins-development/server-api).
- `@strapi/core/dist/providers/cron.js` (`init`, `bootstrap`, `destroy`) và `services/cron.js`
  (`add`, `start`, `stop`): Strapi đọc `server.cron.enabled` và `server.cron.tasks`, tạo
  `node-schedule` job rồi start trên từng process.
  Source không có claim/lease dùng chung giữa nhiều instance. Cron chỉ lập lịch; job phải tự claim
  row hoặc dùng lock PostgreSQL. Đối chiếu [CRON jobs](https://docs.strapi.io/cms/configurations/cron).
- Trong `node_modules` của project không có `@strapi/sdk-plugin`. Cách build TypeScript của SDK vì
  vậy **Chưa kiểm** bằng fixture; không suy ra rằng SDK không hỗ trợ.

**Kiểm thêm khi review vòng 4** (cùng bản source local 5.51.1):

- `@strapi/core/dist/loaders/plugins/index.js` (`applyUserConfig`): config plugin có `default` (object
  hoặc hàm nhận `env`) và `validator`. Strapi gộp `fp.defaultsDeep(defaultConfig, userPluginConfig)`,
  giá trị của app thắng, rồi gọi `plugin.config.validator(config)`; giá trị trả về bị bỏ qua, lỗi được
  bọc thành `Error regarding <plugin> config`. `defaultsDeep` gộp mảng theo vị trí, nên danh sách
  trong config nên là object theo key.
- `@strapi/core/dist/Strapi.js` (`register`, `bootstrap`): register của plugin chạy trước register của
  app; bootstrap của plugin chạy trước bootstrap của app. App đăng ký adapter ở `register()`, plugin
  kiểm registry ở `bootstrap()`.
- `@strapi/admin/dist/server/server/src/config/admin-conditions.js`: condition `admin::is-creator` có
  `handler: (user) => ({ 'createdBy.id': user.id })`. Condition trả query object để lọc theo người
  dùng; đây là mẫu cho condition lọc theo chi nhánh.
- `@strapi/core/dist/middlewares/body.js` dùng `koa-body` 6.0.1 (`lib/unparsed.js`): bật
  `includeUnparsed` thì body gốc nằm ở `ctx.request.body[Symbol.for('unparsedBody')]`. Middleware này
  chạy toàn cục trước route của plugin.
- `@strapi/core/dist/middlewares/cors.js`: header mặc định được phép là `Content-Type`,
  `Authorization`, `Origin`, `Accept`. `config/middlewares.ts` của Salanca giữ đúng bốn header này,
  nên header riêng như `X-Order-Token`, `Idempotency-Key` cần app thêm vào.

**Kiểm thêm tài liệu SePay** ([xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
[đối soát](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich)):

- HMAC-SHA256 ký chuỗi `{timestamp}.{raw_body}`; header `X-SePay-Signature: sha256=<hex>` và
  `X-SePay-Timestamp` (Unix giây). Tài liệu nói SePay ký bytes gốc, serialize lại JSON sẽ sai chữ ký.
  Code mẫu từ chối timestamp lệch quá 300 giây.
- Đối soát: `GET https://userapi.sepay.vn/v2/transactions`, lọc `transaction_date_from/to`,
  `bank_account_id`, `per_page` tối đa 100, `since_id` để lấy tiếp; tối đa 3 request/giây, vượt trả 429;
  ví dụ chạy cron mỗi giờ.

**Best practice**

Document Service middleware phù hợp cho cross-cutting behavior của Document Service. Invariant tiền,
branch scope, transition, webhook và outbox phải được kiểm ở application service, với DB transaction
và permission riêng. Content Manager visibility chỉ là lớp giảm nhầm thao tác. Cron phải kết hợp
claim/lease idempotent khi có từ hai process.

## C12. Mô hình sản phẩm đa ngành

**Các hệ thống làm thế nào**

- **Medusa:** product module tách `Product`, `ProductVariant`, `ProductOption`, `ProductOptionValue`
  và `ProductType`; link `product-variant-inventory-item` có `required_quantity`, nên một variant
  có thể tiêu hao nhiều inventory item cho combo/kit. ([product models](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models),
  [inventory link](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/link-modules/src/definitions/product-variant-inventory-item.ts))
- **Vendure:** `ProductOptionGroup`/`ProductOption` biểu diễn lựa chọn của variant; `Facet`/`FacetValue`
  phục vụ phân loại và tìm kiếm; custom fields mở rộng entity. Giá cơ bản của variant và giá theo
  cấu hình dòng đi qua hai strategy khác nhau. ([ProductOptionGroup](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/product-option-group/product-option-group.entity.ts),
  [Facet](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/facet/facet.entity.ts),
  [OrderItemPriceCalculationStrategy](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/order-item-price-calculation-strategy.ts))
- **WooCommerce:** product class tách variable, grouped, virtual và downloadable; variation là
  identity/giá riêng, còn `cart_item_data` giữ cấu hình của dòng. ([product factory](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-product-factory.php),
  [cart id](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-cart.php))
- **Bagisto:** các type `Simple`, `Configurable`, `Grouped`, `Bundle`, `Virtual`, `Downloadable` và
  `Booking` là class type riêng; booking còn có default, appointment, event, rental và table slot.
  ([product types](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Type),
  [booking helpers](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/BookingProduct/src/Helpers))

**Best practice**

Variant/SKU là danh tính tồn kho và giá cơ bản. Option là cấu hình được chọn và có thể cộng giá.
Combo/kit là quan hệ component có số lượng, không phải title ghép. Physical, virtual, downloadable,
gift card và appointment là capability của product type; registry chọn behavior theo từng line. Một
adapter phải trả i18n, Draft & Publish, option rule và availability đã chuẩn hóa mà không làm core biết
content type của app.

## C13. Sổ cái thanh toán Saleor và trạng thái nhiều trục của Sylius

**Các hệ thống làm thế nào**

- **Saleor:** `TransactionItem` giữ các tổng authorized, charged, refunded, canceled và các khoản
  pending; `TransactionEvent` là các biến động có `amount`, `type`, `include_in_calculations`,
  `psp_reference`, `idempotency_key` và metadata.
  Các helper cộng dồn event thành số đã authorize/charge/refund, không gán một cờ paid duy nhất.
  ([payment models](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/payment/models.py),
  [transaction calculations](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/payment/transaction_item_calculations.py))
- **Medusa:** payment collection giữ số cần thu và các payment/capture/refund; transaction là các
  biến động tiền gắn với order. ([payment collection](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/payment/src/models/payment-collection.ts),
  [order transaction](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/order/src/models/transaction.ts))
- **Sylius:** order có state machine riêng; checkout, payment và shipping có graph/trục riêng. Payment
  có `partially_paid`/`paid`/`partially_refunded`, shipping có `partially_shipped`/`shipped`, trong
  khi order chỉ giữ cart/new/cancelled/fulfilled. ([order workflow](https://github.com/Sylius/Sylius/blob/39313695548c709756ee9073bf309fa4ae89365a/src/Sylius/Bundle/CoreBundle/Resources/config/app/workflow/sylius_order.yaml),
  [payment states](https://github.com/Sylius/Sylius/blob/39313695548c709756ee9073bf309fa4ae89365a/src/Sylius/Component/Core/OrderPaymentStates.php),
  [shipping states](https://github.com/Sylius/Sylius/blob/39313695548c709756ee9073bf309fa4ae89365a/src/Sylius/Component/Core/OrderShippingStates.php))

**Best practice**

Payment cần ledger bất biến và projection; order không nhận cờ paid từ webhook. Có thể lưu một status
order nhỏ, còn payment/fulfillment tính từ entity con và fulfillment group. Partial capture, refund,
cancel phải có event và số tiền độc lập.

## C14. Outbox, workflow và job nhiều server

**Các hệ thống làm thế nào**

- **Medusa event bus:** local/Redis tách publish khỏi module; workflow engine lưu execution và bước
  để retry/compensate. Provider `locking-postgres` dùng PostgreSQL advisory lock cho vùng cần singleton.
  ([event bus local](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/event-bus-local/src/services/event-bus-local.ts),
  [workflow execution](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/workflow-engine-inmemory/src/models/workflow-execution.ts),
  [locking-postgres](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/providers/locking-postgres/src/services/advisory-lock.ts))
- **Action Scheduler (GPL, chỉ học thiết kế):** queue runner lấy batch, claim action, retry action
  lỗi, dọn action cũ và ghi log trong DB. ([queue runner](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_QueueRunner.php),
  [DB store](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/data-stores/ActionScheduler_DBStore.php),
  [logger](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/data-stores/ActionScheduler_DBLogger.php))

**Best practice**

Ghi outbox cùng transaction với aggregate; dispatcher claim theo batch bằng `FOR UPDATE SKIP LOCKED`,
lease và retry backoff. Với job hết hạn hold, đối soát và cảnh báo, mỗi row cần trạng thái claim,
`availableAt`, `attempts`, `lastError`; có thể dùng advisory lock cho singleton. Cron Strapi chỉ gọi
dispatcher, không thay thế claim/lock.

## C15. Sửa đơn, thuế và khách vãng lai

**Các hệ thống làm thế nào**

- **Vendure:** `OrderModifier` chỉ sửa order ở state `Modifying`; `OrderItemPriceCalculationStrategy`
  tính lại giá dòng; `TaxCategory`/`TaxRate` và tax zone tách chính sách thuế khỏi product. ([OrderModifier](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/order-modifier/order-modifier.ts),
  [tax category](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/tax-category/tax-category.entity.ts),
  [tax rate](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/tax-rate/tax-rate.entity.ts))
- **Medusa:** order change có dòng thêm/bớt và adjustment riêng; tax provider là module nên không
  khóa core vào một cách tính thuế. ([order change](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/order/src/models/order-change.ts),
  [tax provider](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/tax/src/services/tax-provider.ts))
- **Vendure guest checkout:** `GuestCheckoutStrategy` là strategy quyết định có tạo hoặc dùng
  customer hay không, thay vì bắt mọi order có account. ([strategy](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/guest-checkout-strategy.ts))

**Best practice**

Lưu các cột quantity đã fulfill/return/cancel trên line để giữ đường lui cho partial change. Snapshot
tax category/rate trên line; `InvoiceProvider` chịu issue/cancel. Guest v1 có thể chỉ snapshot contact
và customerRef tùy chọn; không ép bảng account vào core.

## C16. Branch scope, múi giờ, làm tròn, vận hành và cảnh báo

**Các hệ thống làm thế nào**

- Strapi Admin permission condition có thể trả điều kiện query, nhưng Content Manager `visible` chỉ
  quyết định model có hiện trong UI. Source local đã đọc ở C11; lọc branch cho route custom **Chưa kiểm**
  bằng fixture end-to-end.
- TastyIgniter `WorkingSchedule`/`WorkingTimeslot` gắn giờ mở, slot và timezone theo local; Bagisto
  booking giữ slot theo resource và duration. ([WorkingSchedule](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingSchedule.php),
  [WorkingTimeslot](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingTimeslot.php))
- Vendure có `OrderLineDiscountDistributionStrategy` để trả weight cho từng line; helper `prorate`
  phân bổ discount order theo weight và xử lý line đã hủy. ([strategy](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/order-line-discount-distribution-strategy.ts),
  [default strategy](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/default-order-line-discount-distribution-strategy.ts))

**Best practice**

Service luôn áp branch predicate sau authentication; UI ẩn không phải authorization. Lưu timestamp UTC
và `timezone`/business date theo branch; phải chốt policy quán mở qua nửa đêm. Phân bổ discount/fee
order xuống line bằng weight, làm tròn từng line theo VND và phân phần dư lớn nhất; snapshot
`discountAmount`/`feeAmount`/`roundingDelta` để refund một line không lệch tổng. Alert nên đi qua
NotificationProvider nhưng log chỉ có mã order/provider, trạng thái, attempts và requestId đã che PII.

## C17. Bổ sung sau review vòng 4: phân quyền chi nhánh, ngày kinh doanh, cảnh báo vận hành

Vòng 4 mới đọc phía Strapi cho phân quyền chi nhánh, chỉ dẫn link cho múi giờ và gần như chưa có
nguồn cho cảnh báo. Mục này đọc thêm source ở commit cố định. Odoo 18.0 là LGPLv3, WooCommerce và
Action Scheduler là GPLv3: chỉ học thiết kế, không chép code.

### C17.1. Giới hạn nhân viên theo chi nhánh

**Các hệ thống làm thế nào**

- **Vendure:** `Role` có quan hệ nhiều-nhiều `channels`
  ([role.entity.ts#L30](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/role/role.entity.ts#L30)).
  `getChannelPermissions` gộp quyền của mọi role theo từng channel
  ([get-user-channels-permissions.ts#L26-L47](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/utils/get-user-channels-permissions.ts#L26-L47)).
  `RequestContext.userHasPermissions` kiểm quyền trên channel đang chọn của request
  ([request-context.ts#L274-L280](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/api/common/request-context.ts#L274-L280)),
  và `ListQueryBuilder` join bảng channel để lọc dữ liệu theo channel đó
  ([list-query-builder.ts#L344-L346](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/service/helpers/list-query-builder/list-query-builder.ts#L344-L346)).
  Quyền gắn với cặp (role, channel), không gắn với từng user.
- **Saleor:** nhóm quyền `Group` có cờ `restricted_access_to_channels` và danh sách `channels`
  ([account/models.py#L443-L469](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/account/models.py#L443-L469)).
  Cờ `false` nghĩa là thấy mọi channel; giá trị này được lưu rõ ràng, không suy ra từ danh sách
  rỗng ([dataloaders.py#L180-L200](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/graphql/account/dataloaders.py#L180-L200)).
  Truy vấn đơn lọc `channel_id__in` theo channel user được phép
  ([order/resolvers.py#L34-L42](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/graphql/order/resolvers.py#L34-L42));
  mutation kiểm channel của chính object bị sửa bằng `check_channel_permissions`
  ([core/mutations.py#L585-L598](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/graphql/core/mutations.py#L585-L598)).
- **TastyIgniter:** staff có quan hệ `locations`; `Location::currentOrAssigned()` trả location đang
  chọn, hoặc danh sách location được gán, hoặc mảng rỗng cho super user
  ([Location.php#L117-L128](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/Location.php#L117-L128)).
  `locationApplyScope` **bỏ qua lọc khi mảng rỗng**, và mặc định còn cho thấy bản ghi không gắn
  location (`whereHasOrDoesntHaveLocation`)
  ([LocationAwareController.php#L57-L70](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Http/Actions/LocationAwareController.php#L57-L70)).
  Theo đoạn code này, staff thường chưa được gán location sẽ thấy như super user: thiếu dữ liệu thì
  mở toàn bộ. Lọc được gắn vào sự kiện list/form của Admin, không nằm ở tầng service. Ngoài ra staff có
  `sale_permission` 1/2/3 (mọi đơn, đơn của nhóm, chỉ đơn giao cho mình)
  ([ti-ext-user User.php#L283-L296](https://github.com/tastyigniter/ti-ext-user/blob/3077e34fc9b6ee7a2df3beed79bf5d6171df9fbc/src/Models/User.php#L283-L296)),
  là chiều thứ hai: phạm vi theo người được giao đơn.
- **Medusa:** module RBAC có `rbac_role`, `rbac_policy` (`resource` + `operation`) và kế thừa role
  ([rbac-policy.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/rbac/src/models/rbac-policy.ts),
  [rbac-role.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/rbac/src/models/rbac-role.ts)).
  Model không có chiều sales channel hay stock location, nên quyền chỉ ở mức loại tài nguyên.
- **Strapi 5.51.1:** engine permission `await condition.handler(...)`, nên handler async được hỗ trợ.
  Kết quả không phải boolean hoặc object (ví dụ `undefined`, `null`) bị loại; nếu một condition trả `true`
  thì cấp không điều kiện; các object được gộp bằng `$or` (`@strapi/permissions/dist/engine/index.js`,
  hàm tạo ability, dòng 53–95 của bản local).
  **Sửa sau spike O0 (2026-10-10):** bản đọc trước ghi "mọi condition bị loại thì cấp quyền không điều kiện". Sai: sau khi loại
  kết quả không hợp lệ, engine kiểm `evaluatedConditions.every(result === false)` trước, mà `[].every(...)`
  là `true`, nên quyền **bị từ chối** (fail-closed); nhánh `isEmpty` phía sau không bao giờ tới.
  `scripts/spike-ordering/scope-engine.mjs` chứng minh qua engine thật. Handler nhận thẳng object user
  (đã gộp permission), không phải `{ user }`.

**Best practice**

- Phạm vi chi nhánh là dữ liệu riêng, kiểm ở service cho cả đọc lẫn ghi. Ghi phải kiểm chi nhánh của
  chính đơn bị sửa (Saleor), không chỉ lọc danh sách (TastyIgniter chỉ lọc màn hình Admin).
- "Thấy mọi chi nhánh" phải là cờ lưu rõ ràng (Saleor `restricted_access_to_channels`), không suy ra
  từ danh sách rỗng. Thiếu dữ liệu thì từ chối.
- Condition Strapi trả `false` khi user không có scope. Trả `null`/`undefined` không làm lộ quyền (engine
  từ chối khi mọi kết quả bị loại, xem trên), nhưng vẫn nên trả `false` rõ ràng để dễ đọc và để không phụ
  thuộc chi tiết cài đặt của engine.
- Gắn scope theo role (Vendure, Saleor) hợp với tổ chức ổn định; gắn theo user (TastyIgniter) hợp với
  chuỗi quán có nhân viên luân chuyển. Plugin không sửa được schema role/user của Strapi, nên bảng
  riêng là đường duy nhất cho cả hai cách.
- "Chỉ đơn giao cho mình" là chiều khác, thuộc module phân đơn về sau.

### C17.2. Múi giờ và ngày kinh doanh

**Các hệ thống làm thế nào**

- **TastyIgniter:** `WorkingRange::endsNextDay()` là `end < start`; `containsTime` xử lý khoảng qua nửa
  đêm như 22:00–02:00
  ([WorkingRange.php#L65-L88](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingRange.php#L65-L88)).
  `WorkingSchedule` nhận timezone
  ([WorkingSchedule.php#L40-L42](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/WorkingSchedule.php#L40-L42)),
  nhưng `HasWorkingHours` tạo schedule không truyền timezone theo location
  ([HasWorkingHours.php#L83-L85](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Models/Concerns/HasWorkingHours.php#L83-L85)),
  tức cả hệ thống dùng một timezone. Đơn lưu `order_date` và `order_time` dạng giờ địa phương của lúc
  nhận hàng ([OrderManager.php#L374-L382](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Classes/OrderManager.php#L374-L382)).
- **Odoo POS 18.0 (LGPLv3):** đơn POS bắt buộc thuộc một `pos.session` đang mở
  ([pos_order.py#L345-L347](https://github.com/odoo/odoo/blob/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale/models/pos_order.py#L345-L347)).
  Session có `start_at`/`stop_at` và trạng thái mở → đang bán → kiểm đóng ca → đã đóng
  ([pos_session.py#L22-L46](https://github.com/odoo/odoo/blob/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale/models/pos_session.py#L22-L46));
  mỗi điểm bán chỉ có một session chưa đóng
  ([pos_session.py#L293-L301](https://github.com/odoo/odoo/blob/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale/models/pos_session.py#L293-L301)).
  Ngày kinh doanh vì vậy là ca, không phải ngày lịch: đơn lúc 01:00 vẫn thuộc ca mở từ chiều hôm trước.
  Ngày đóng ca hiển thị theo timezone của user đang xem, không theo điểm bán
  ([pos_config.py#L346-L347](https://github.com/odoo/odoo/blob/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale/models/pos_config.py#L346-L347)).
- **Medusa, Vendure, Saleor:** không thấy field timezone trong model store/channel/stock location đã
  kiểm (Medusa `store`, `stock-location`; Vendure `channel`, `stock-location`; Saleor `channel`).
  Các lõi thương mại điện tử lưu UTC và để báo cáo tự xử lý.

**Best practice**

- Lưu mọi mốc thời gian bằng UTC, kèm IANA timezone trên từng chi nhánh.
- Tính và lưu `businessDate` một lần lúc đặt đơn, theo timezone và giờ chốt ngày của chi nhánh. Báo
  cáo nhóm theo cột đã lưu, nên đổi giờ chốt về sau không viết lại lịch sử. TastyIgniter lưu ngày/giờ
  địa phương thành cột riêng; Odoo gắn đơn vào ca.
- Giờ mở cửa cho phép `end < start` nghĩa là đóng sau nửa đêm (TastyIgniter).
- Hiển thị và tính slot theo timezone chi nhánh, không theo timezone của server hay người xem (lỗi
  Odoo tránh được nếu lưu timezone ở điểm bán).
- Ca bán hàng/đóng ca kiểu Odoo hữu ích cho đối soát tiền mặt; là module về sau, không bắt buộc ở lõi.

### C17.3. Theo dõi vận hành và cảnh báo

**Các hệ thống làm thế nào**

- **WooCommerce webhook (GPL):** mỗi lần gửi lỗi tăng `failure_count`; vượt
  `woocommerce_max_webhook_delivery_failures` (mặc định 5) thì tự chuyển webhook sang `disabled`;
  gửi thành công thì đặt lại về 0
  ([class-wc-webhook.php#L577-L602](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes/class-wc-webhook.php#L577-L602)).
- **Action Scheduler (GPL):** màn hình Admin cảnh báo khi có action quá hạn lâu hơn ngưỡng (mặc định
  1 ngày, tối thiểu 1 action), kết quả kiểm được cache theo chu kỳ bằng 1/4 ngưỡng
  ([ActionScheduler_AdminView.php#L176-L212](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_AdminView.php#L176-L212)).
  `QueueCleaner` trả lại action đã claim mà không chạy sau 300 giây, đánh dấu lỗi action chạy quá 300
  giây, giữ action xong 1 tháng và action lỗi 3 tháng
  ([ActionScheduler_QueueCleaner.php#L112-L121](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_QueueCleaner.php#L112-L121),
  [#L320-L355](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_QueueCleaner.php#L320-L355)).
- **Saleor:** `AppProblem` có `key`, `count`, `is_critical`, `dismissed`, người dismiss và giới hạn 100
  bản ghi mỗi app ([app/models.py#L199-L213](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/app/models.py#L199-L213)).
  Báo lại cùng `key` trong `aggregation_period` (mặc định 60 phút) chỉ tăng `count`; đạt
  `critical_threshold` thì thành critical; ngoài cửa sổ thì tạo bản ghi mới; vượt giới hạn thì xóa bản
  cũ nhất ([app_problem_create.py#L76-L90](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/graphql/app/mutations/app_problem_create.py#L76-L90),
  [#L136-L170](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/graphql/app/mutations/app_problem_create.py#L136-L170)).
  Webhook gửi ra có `EventDelivery` và từng `EventDeliveryAttempt` kèm status
  ([core/models.py#L212-L240](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/core/models.py#L212-L240)).
- **Vendure:** job có `retries`, `attempts` và trạng thái `RETRYING`/`FAILED`
  ([job.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/job-queue/job.ts));
  endpoint health check gom các strategy đã đăng ký
  ([health-check.controller.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/health-check/health-check.controller.ts)).
- **Strapi 5.51.1:** chỉ có `/_health` (`@strapi/core/dist/services/server/index.js`), cho biết process
  còn sống, không biết outbox hay webhook có kẹt không.

**Best practice**

- Cảnh báo là bản ghi có `key`, cửa sổ gộp, `count`, ngưỡng critical, trạng thái đã xem và giới hạn số
  bản ghi (Saleor). Cùng lỗi lặp lại chỉ tăng đếm, không gửi thêm.
- Ngưỡng là cấu hình có giá trị mặc định (WooCommerce 5 lần, Action Scheduler 1 ngày/300 giây), không
  hard-code. Đặt lại bộ đếm khi thành công.
- Phát hiện "kẹt" bằng tuổi của việc chờ lâu nhất và lease quá hạn, không chỉ bằng số lần lỗi.
- Có trang trạng thái vận hành riêng (backlog outbox, việc chờ lâu nhất, lần webhook thành công gần
  nhất theo provider, cảnh báo đang mở), vì health check của Strapi không thấy các thứ này.
- Có thời hạn lưu khác nhau cho việc thành công và việc lỗi (Action Scheduler).

### C17.4. Vùng giao và phí giao

**Các hệ thống làm thế nào**

- **TastyIgniter:** mỗi chi nhánh có các `LocationArea` kiểu polygon, circle hoặc address, kèm
  `conditions` và `priority` ([LocationArea.php](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Models/LocationArea.php)).
  `CoveredArea` xét các condition theo `priority`, lấy condition đầu tiên khớp với tổng giỏ
  (`above`, `below`, `all`...). Phí `-1` nghĩa là không giao, phí `0` là miễn phí, và condition còn cho
  mức đơn tối thiểu. Phí theo khoảng cách được cộng thêm nếu biết vị trí khách
  ([CoveredArea.php#L21-L87](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/CoveredArea.php#L21-L87),
  [CoveredAreaCondition.php#L54-L75](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes/CoveredAreaCondition.php#L54-L75)).
- Contract giao hàng của Medusa, Vendure, WooCommerce và Saleor đã so ở B6: phí và lựa chọn giao do
  provider/method tính, đơn lưu snapshot địa chỉ và phương thức.

**Best practice**

- Vùng giao gắn với chi nhánh, có thứ tự ưu tiên. Rule phí xét theo thứ tự, rule đầu tiên khớp thắng,
  có giá trị "không giao" riêng và mức đơn tối thiểu.
- Khớp vùng theo khoảng cách cần tọa độ, tức cần geocoding. Ở Việt Nam, khớp theo mã xã/phường trong
  địa chỉ 2 cấp không cần API bản đồ và đủ cho quán tự giao.
- Phí giao là một khoản của nhóm giao nhận, đi qua cùng pipeline giá, để khuyến mãi miễn phí giao dùng
  được về sau.

## C18. Catalog và danh mục trong plugin

Bối cảnh: plugin sẽ cài vào nhiều Strapi khác nhau, nên catalog (sản phẩm, danh mục, biến thể, tùy
chọn) phải thuộc plugin. C12 đã so mô hình sản phẩm; mục này bổ sung danh mục, khung giờ bán và cách app
mở rộng content type của plugin.

**Các hệ thống làm thế nào**

- **Medusa:** `ProductCategory` là cây (`parent_category`, `category_children`, `mpath`), có `rank`,
  `is_active`, `is_internal`, `handle` unique, `name`/`description` dịch được, quan hệ nhiều-nhiều với
  product ([product-category.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models/product-category.ts)).
  Ngoài category còn có collection, tag và type riêng
  ([models](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models)).
- **Vendure:** `Collection` là cây (`parent`, `children`, `isRoot`), có `position`, `isPrivate`, bản
  dịch, ảnh, gắn theo channel. Thành viên của collection có thể tính từ `filters` và kế thừa filter của
  cha (`inheritFilters`) ([collection.entity.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/collection/collection.entity.ts)).
- **TastyIgniter:** `Category` là cây lồng (`NestedTree`), có `priority`, `status`, slug
  ([Category.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Category.php)).
  `Mealtime` là khung giờ bán (giờ bắt đầu/kết thúc, hiệu lực theo ngày hoặc lặp lại theo thứ)
  ([Mealtime.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Mealtime.php)).
  Món có `minimum_qty`, `order_restriction` theo cách nhận hàng, gắn location, tồn kho và
  `isAvailable($datetime)` ([Menu.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Menu.php)).
- **Strapi 5.51.1 (source local):** `applyUserExtension` trong `@strapi/core/dist/loaders/plugins/index.js`
  đọc `src/extensions/<plugin>/content-types/**/schema.json` và `strapi-server.js`. Schema mở rộng
  được gộp **nông** (`{ ...schema, ...extendedSchema }`): khai `attributes` trong `schema.json` sẽ thay
  toàn bộ attribute của plugin. `strapi-server.js` nhận object plugin và trả lại, nên thêm field bằng
  code được mà không chép cả schema.

**Best practice**

- Danh mục là cây, quan hệ nhiều-nhiều với sản phẩm, có thứ tự (`rank`/`position`), cờ bật và cờ nội
  bộ, tên dịch được.
- Khung giờ bán (bữa sáng, bữa trưa) là entity riêng gắn vào danh mục hoặc món, tách khỏi giờ mở cửa
  của chi nhánh (TastyIgniter `Mealtime`).
- Món có số lượng tối thiểu, giới hạn theo cách nhận hàng và trạng thái theo chi nhánh.
- App mở rộng content type của plugin bằng `strapi-server` (thêm field bằng code), không chép
  `schema.json`, để nâng cấp plugin không mất field của app.
- Line lưu snapshot danh mục để báo cáo theo danh mục không đổi khi đổi tên hay chuyển danh mục.

## C19. Catalog sâu: tùy chọn, combo, giá, tồn kho, mở rộng theo ngành, cách dựng trên Strapi

Vòng này đọc phần catalog vì từ 2026-10-10 catalog thuộc plugin (contracts mục 20). Bagisto mới clone
lại ở `3fb8300` (MIT).

### C19.1. Tùy chọn món: biến thể khác với tùy chọn cộng thêm

**Các hệ thống làm thế nào**

- **Medusa, Vendure:** option (`ProductOption`, `ProductOptionGroup`) dùng để **sinh biến thể**: mỗi tổ
  hợp size × màu là một variant có SKU và giá riêng (C12). Không có tùy chọn cộng thêm kiểu topping
  trong lõi; Vendure làm việc này bằng custom field trên order line cùng
  `OrderItemPriceCalculationStrategy`.
- **WooCommerce:** variation sinh từ attribute; tùy chọn cộng thêm là extension trả phí, không ở lõi.
- **TastyIgniter** (lõi F&B, 4 bảng):
  - Thư viện dùng chung: `MenuOption` (tên, `display_type`, `priority`) và `MenuOptionValue` (tên, giá,
    thứ tự, có thể gắn tồn kho)
    ([MenuOption.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuOption.php),
    [MenuOptionValue.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuOptionValue.php)).
  - Gắn vào món: `MenuItemOption` (bắt buộc, `min_selected`, `max_selected`, `free_quantity`, thứ tự)
    và `MenuItemOptionValue` (`override_price`, `is_default`, `free_quantity`, thứ tự)
    ([MenuItemOption.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuItemOption.php),
    [MenuItemOptionValue.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/MenuItemOptionValue.php)).
  - Một nhóm "Topping" khai một lần, mỗi món gắn vào và ghi đè giá, mặc định, min/max riêng.
- **Bagisto:** `product_customizable_options` (2024) là tùy chọn cộng thêm theo từng sản phẩm, kiểu
  text/checkbox/radio/select/multiselect/date/file, mỗi lựa chọn có giá
  ([migration](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Database/Migrations/2024_10_11_135010_create_product_customizable_options_table.php),
  [ProductCustomizableOptionPrice.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductCustomizableOptionPrice.php));
  không có thư viện dùng chung.

**Best practice**

- Tách hai khái niệm: **thuộc tính sinh biến thể** (size → SKU, giá, tồn kho riêng) và **tùy chọn cộng
  thêm** (topping, mức cay, ghi chú → cộng giá vào line, không sinh SKU).
- Tùy chọn cộng thêm dùng thư viện dùng chung + bảng gắn theo sản phẩm có ghi đè (TastyIgniter). Quán có
  hàng chục món dùng chung nhóm "Topping", sửa giá topping một chỗ.
- Có kiểu tùy chọn nhập chữ (khắc tên, lời chúc trên bánh) cho ngành khác (Bagisto).

### C19.2. Combo và bundle

**Các hệ thống làm thế nào**

- **Bagisto bundle:** sản phẩm bundle có các `product_bundle_options` (`type` select/radio/checkbox/
  multiselect, `is_required`, `sort_order`); mỗi option có `product_bundle_option_products` (sản phẩm
  con, `qty`, `is_user_defined` cho khách đổi số lượng, `is_default`)
  ([ProductBundleOption.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductBundleOption.php),
  [ProductBundleOptionProduct.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductBundleOptionProduct.php)).
  Kiểm tồn kho của bundle bằng tồn của từng sản phẩm con × số lượng
  ([Bundle.php#L537-L550](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Type/Bundle.php#L537-L550)).
- **Bagisto grouped** và **WooCommerce grouped:** chỉ là danh sách sản phẩm hiển thị chung, khách thêm
  từng cái vào giỏ như dòng riêng
  ([ProductGroupedProduct.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductGroupedProduct.php)).
- **Medusa:** variant liên kết nhiều inventory item với `required_quantity`, nên một SKU combo trừ tồn
  của nhiều thành phần (C12), nhưng không có lựa chọn của khách trong combo.

**Best practice**

- Combo = sản phẩm có các **nhóm chọn** (chọn 1 món chính, chọn 1 nước), mỗi nhóm có quy tắc chọn
  (radio/checkbox, bắt buộc, min/max) và danh sách thành phần có số lượng, mặc định, giá chênh khi đổi
  (Bagisto bundle). Combo cố định là trường hợp mỗi nhóm chỉ có một thành phần.
- Tồn kho/"tạm hết" của combo tính từ thành phần: một thành phần bắt buộc hết thì combo hết.
- Line lưu snapshot thành phần đã chọn (`componentsSnapshot`), để bếp thấy đúng món và báo cáo theo món.

### C19.3. Giá theo ngữ cảnh

**Các hệ thống làm thế nào**

- **Medusa pricing:** `PriceSet` gắn với variant, chứa nhiều `Price` (`currency_code`, `amount`,
  `min_quantity`, `max_quantity`); mỗi price có `PriceRule` (`attribute`, `value`, `operator`,
  `priority`), ví dụ theo region hay nhóm khách; `PriceList` (sale/override, trạng thái, `starts_at`,
  `ends_at`) gom giá theo đợt
  ([price.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/pricing/src/models/price.ts),
  [price-rule.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/pricing/src/models/price-rule.ts),
  [price-list.ts](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/pricing/src/models/price-list.ts)).
- **Vendure:** `ProductVariantPrice` là giá theo channel và currency
  ([product-variant-price.entity.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/product-variant/product-variant-price.entity.ts));
  `ProductVariantPriceSelectionStrategy` chọn giá, `ProductVariantPriceCalculationStrategy` tính giá
  ([config/catalog](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/catalog)).
- **Saleor:** `ProductVariantChannelListing` giữ `price_amount`, `cost_price_amount`,
  `prior_price_amount`, `discounted_price_amount` theo channel
  ([product/models.py#L485-L510](https://github.com/saleor/saleor/blob/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/product/models.py#L485-L510)).
- **Bagisto:** `product_customer_group_prices` (nhóm khách, `qty`, `value_type` cố định hoặc giảm %,
  `value`) ([ProductCustomerGroupPrice.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductCustomerGroupPrice.php)).

**Best practice**

- Giá không phải một cột duy nhất mà là danh sách bản ghi giá có điều kiện (chi nhánh, kênh, nhóm khách,
  số lượng tối thiểu, khoảng thời gian). Bộ chọn giá lấy bản ghi cụ thể nhất khớp ngữ cảnh (Medusa).
- V1 chỉ cần giá gốc, nhưng bảng giá nên là bảng riêng ngay từ đầu, để thêm giá theo chi nhánh, giờ vàng
  hay nhóm khách sau này không phải đổi schema.
- Lưu giá gốc và giá trước khi giảm (Saleor `prior_price`) để hiển thị giá gạch.

### C19.4. Tồn kho

**Các hệ thống làm thế nào**

- **Medusa inventory:** `InventoryItem` là hàng vật lý (SKU, kích thước, `requires_shipping`), tách khỏi
  variant; `InventoryLevel` theo location có `stocked_quantity`, `reserved_quantity`,
  `incoming_quantity`, `available_quantity` tính ra; `ReservationItem` giữ hàng cho line theo location,
  có `allow_backorder`
  ([inventory models](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/inventory/src/models)).
- **Vendure:** `StockLevel` (`stockOnHand`, `stockAllocated`) theo variant × location; `StockMovement`
  là sổ với các loại Allocation, Sale, Release, Cancellation, StockAdjustment; variant có
  `trackInventory`, `outOfStockThreshold`; `StockLocationStrategy` chọn kho, `StockDisplayStrategy`
  quyết định khách thấy số lượng hay chỉ "còn/hết"
  ([stock-level.entity.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/stock-level/stock-level.entity.ts),
  [stock-movement](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/stock-movement)).
- **WooCommerce (GPL):** bảng `wc_reserved_stock` (order, product, số lượng, `expires`); giữ tồn khi
  checkout (mặc định 60 phút trong `reserve_stock_for_order`), chỉ tính bản ghi chưa hết hạn
  ([ReserveStock.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php)).
- **TastyIgniter:** `Stock` đa hình (`stockable_type`: món **hoặc giá trị tùy chọn**) theo location, có
  `is_tracked`, `low_stock_alert`, `low_stock_threshold`; `StockHistory` là sổ biến động
  ([Stock.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Models/Stock.php)).
- **Bagisto:** tồn theo nguồn hàng (`product_inventories`), số đã đặt theo channel
  (`product_ordered_inventories`), số bán được = tồn − đã đặt
  ([ProductInventory.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductInventory.php),
  [ProductOrderedInventory.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductOrderedInventory.php)).

**Best practice**

- Tồn kho là module riêng, cắm vào catalog qua tham chiếu (`inventoryRef`), không phải cột `qty` trên
  sản phẩm. Theo dõi tồn là cờ bật/tắt theo từng mục (`trackInventory`/`is_tracked`).
- Số lượng theo location gồm có sẵn, đã giữ, sắp về; số bán được tính ra. Mọi thay đổi ghi vào sổ biến
  động (Vendure, TastyIgniter).
- Giữ hàng có thời hạn (WooCommerce `expires`), khớp với `hold` của lõi.
- F&B cần theo dõi tồn cả tùy chọn (hết trân châu) và có cảnh báo sắp hết (TastyIgniter).
- Hiển thị cho khách là chiến lược riêng: số lượng hay chỉ "còn/hết" (Vendure).

### C19.5. Mở rộng theo ngành: loại sản phẩm và field riêng

**Các hệ thống làm thế nào**

- **Vendure custom fields:** khai trong config, theo entity, các kiểu `string`, `localeString`, `text`,
  `localeText`, `int`, `float`, `boolean`, `datetime`, `relation`, `struct`; lưu thành cột thật nên
  cần migration
  ([custom-field-types.ts](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/custom-field/custom-field-types.ts)).
- **Bagisto:** EAV với `Attribute`, `AttributeFamily`, `AttributeGroup`, `AttributeOption`; giá trị lưu
  ở `product_attribute_values` theo `locale` và `channel`; mỗi loại sản phẩm là một class `Type`
  ([Attribute models](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Attribute/src/Models),
  [ProductAttributeValue.php](https://github.com/bagisto/bagisto/blob/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Models/ProductAttributeValue.php)).
- **Strapi:** app thêm field bằng extension `strapi-server` (C18); plugin đăng ký được custom field
  kiểu `json`, `string`, `integer`... (`@strapi/core/dist/registries/custom-fields.js`, danh sách
  `ALLOWED_TYPES`).

**Best practice**

- Hai tầng mở rộng: dev thêm field bằng code (Vendure custom field, Strapi extension); người quản trị
  khai thuộc tính theo bộ thuộc tính/loại sản phẩm (Bagisto attribute family) cho ngành bán lẻ nhiều
  thuộc tính.
- Hành vi theo loại sản phẩm nằm trong registry có code (Bagisto `Type`, `ProductTypeDefinition` của
  lõi), không suy ra từ dữ liệu.
- EAV linh hoạt nhưng truy vấn chậm và khó ràng buộc; chỉ dùng cho thuộc tính mô tả/lọc, không dùng cho
  giá, tồn kho hay quan hệ.

### C19.6. Dựng catalog trên Strapi 5.51.1

Đọc source local:

- **i18n coi mọi quan hệ là dữ liệu theo từng ngôn ngữ.** `isLocalizedAttribute` trả `true` cho field có
  `localized`, cho **mọi relation** và cho `uid`
  (`@strapi/i18n/dist/server/services/content-types.js`). Field thường có `localized: false` thì được
  chép sang các ngôn ngữ khác (`copyNonLocalizedAttributes`, `fillNonLocalizedAttributes`), nhưng
  relation thì không. Nếu sản phẩm bật i18n, quan hệ tới danh mục, biến thể, tùy chọn phải nối riêng ở
  từng ngôn ngữ và dễ lệch giữa VI/EN. `docs/cms-content-model.md` của Salanca đã gặp giới hạn cùng loại
  (field kỹ thuật trong component localized không tự đồng bộ).
- **Plugin không nạp được component theo đường chuẩn.** Loader component chỉ đọc
  `strapi.dirs.dist.components` của app (`@strapi/core/dist/loaders/components.js`); loader plugin không
  có bước nạp component. Thêm component từ `register()` của plugin không có tài liệu: **Chưa kiểm**.
- **Plugin đăng ký được custom field** (registry custom field, kiểu cho phép gồm `json`), kèm ô nhập
  riêng trong Admin.

**Best practice cho plugin**

- Dữ liệu thương mại (giá, SKU, quan hệ, tồn kho) không được nhân theo ngôn ngữ. Content type catalog
  để không bật i18n; chữ cần dịch (tên, mô tả, slug) lưu trong custom field kiểu `json`
  `{ vi, en, ... }` có ô nhập theo từng ngôn ngữ. Cách này giống bảng translation của Vendure và field
  `translatable()` của Medusa: một bản ghi, nhiều bản dịch.
- Không dựa vào component cho cấu trúc lồng của plugin; dùng content type + relation, hoặc custom field
  `json` có validate ở service.
- Trạng thái sản phẩm dùng field `status` (nháp/đang bán/lưu trữ) như Medusa và cờ `enabled` của
  Vendure, thay vì Draft & Publish của Strapi. Draft & Publish nhân bản ghi thành bản nháp và bản đã
  đăng; với nhiều content type có quan hệ, việc đăng phải theo thứ tự (**Chưa kiểm** bằng fixture).
  Snapshot trên line đã bảo vệ đơn cũ khi giá đổi.

## C20. Các plugin thương mại có sẵn trên Strapi 5

Tìm trên Strapi Marketplace và npm (2026-10-10). Chưa có plugin Strapi 5 nào làm trọn catalog + đơn +
thanh toán ở mức production. Đã đọc 4 plugin Strapi 5, giấy phép MIT:

| Plugin | Commit | Làm gì |
| --- | --- | --- |
| [`@strapi-community/shopify`](https://github.com/strapi-community/shopify/tree/8821013cb081196fc41a740bf6a07b33b5a30fb9) | `8821013` | custom field "Shopify product", webhook, đồng bộ sản phẩm |
| [`@sensinum/strapi-plugin-open-mercato`](https://github.com/VirtusLab-Open-Source/strapi-plugin-open-mercato/tree/ae30c8bc69e0b70bd89844a93ada190034c4ca63) | `ae30c8b` | cùng khung với plugin Shopify, nối Open Mercato |
| [`@creem_io/strapi`](https://github.com/armitage-labs/creem/tree/cbb07d19b10efdb64399bf924d2cb838da170089/packages/integrations/strapi) | `cbb07d1` | sản phẩm, checkout và webhook của Creem trong Admin |
| [WebbyCommerce](https://github.com/webbycrown/webbycommerce/tree/27451514df7b9167df1a3d0a8f92c2c45f62a5de) | `2745151` | bộ thương mại đầy đủ kiểu WooCommerce (đã chấm ở A12) |

Các plugin cho Strapi 4 (`strapi-plugin-payments`, `strapi-stripe`, `@dbbs/strapi-stripe-payment`)
không đọc sâu vì khác đời Strapi và lâu không cập nhật.

**Cách các plugin làm**

- **Đóng gói:** plugin Shopify build bằng `@strapi/sdk-plugin` (`strapi-plugin build`, `verify`,
  `watch:link`), TypeScript cho cả server và admin, test bằng Jest
  ([package.json](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/package.json)).
- **Config:** `default` + `validator` dùng zod `safeParse`, ném lỗi gom mọi issue
  ([config/index.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/config/index.ts),
  [config/schema.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/config/schema.ts)).
  Khớp với cách Strapi nạp config ở C11.
- **Content type nội bộ:** `collectionName` có tiền tố `plugins_shopify_`, `draftAndPublish: false`, ẩn
  khỏi cả Content Manager lẫn Content-Type Builder (`content-manager.visible: false`,
  `content-type-builder.visible: false`)
  ([shops/schema.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/content-types/shops/schema.ts)).
- **Secret do admin nhập:** khóa API của shop lưu trong DB dạng mã hóa AES-256-CBC với
  `encryptionKey` 32 ký tự từ config
  ([utils/encrypt.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/utils/encrypt.ts)).
  Open Mercato mã hóa cả cấu hình rồi lưu bằng `strapi.store({ type: 'plugin' })`; Creem lưu setting
  bằng `strapi.store` nhưng secret webhook lấy từ env.
- **Custom field từ plugin:** `strapi.customFields.register({ name: 'product', plugin, type: 'json' })`
  trong `register()`. App đặt field này vào content type của mình; một Document Service middleware
  (`strapi.documents.use`) gắn dữ liệu sản phẩm vào kết quả `findOne`/`findMany` của các content type
  có field đó ([register.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/register.ts)).
  Đây là cách nối content của app với sản phẩm của plugin mà plugin không cần biết content type của app.
- **Quyền:** đăng ký action bằng `strapi.admin.services.permission.actionProvider.registerMany` trong
  bootstrap ([permissions.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/permissions.ts)).
- **Webhook và body gốc:**
  - Plugin Shopify đọc `ctx.request.body[UNPARSED]` (`koa-body/lib/unparsed`) để kiểm HMAC bằng SDK của
    Shopify; README yêu cầu app bật `includeUnparsed: true` cho `strapi::body`
    ([webhook.validator.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/validators/webhook.validator.ts),
    [README](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/README.md)).
    Controller gọi service xử lý mà **không `await`** và luôn trả `{}`, nên lỗi xử lý bị mất
    ([webhook.controller.ts](https://github.com/strapi-community/shopify/blob/8821013cb081196fc41a740bf6a07b33b5a30fb9/server/src/controllers/webhook.controller.ts)).
  - Creem so chữ ký bằng `crypto.timingSafeEqual`, nhưng khi không có body gốc thì **dùng
    `JSON.stringify(ctx.request.body)` thay thế**; chuyển tiếp event sang URL khác ngay trong request
    webhook với timeout 10 giây
    ([creem-controller.ts#L280-L320](https://github.com/armitage-labs/creem/blob/cbb07d19b10efdb64399bf924d2cb838da170089/packages/integrations/strapi/server/src/controllers/creem-controller.ts#L280-L320)).
- **WebbyCommerce:**
  - Lúc bootstrap, plugin **ghi file schema** content type và component vào `src/api` và
    `src/components` của app rồi yêu cầu khởi động lại
    ([bootstrap.js](https://github.com/webbycrown/webbycommerce/blob/27451514df7b9167df1a3d0a8f92c2c45f62a5de/server/src/bootstrap.js),
    khoảng dòng 196–410 và 3070–3160). Đây là cách lách việc plugin không nạp được component (C19.6).
  - Product và variation có `price`/`sale_price` kiểu `decimal`, `stock_quantity` nằm ngay trên sản
    phẩm; danh mục không có cây; product bật Draft & Publish
    ([product/schema.json](https://github.com/webbycrown/webbycommerce/blob/27451514df7b9167df1a3d0a8f92c2c45f62a5de/server/src/content-types/product/schema.json)).
  - Thư viện thuộc tính dùng chung (`product-attribute` có `type`, `is_variation`, `is_visible`,
    `is_filterable`; `product-attribute-value` có `color_hex`), variation trỏ tới giá trị thuộc tính
    ([product-attribute/schema.json](https://github.com/webbycrown/webbycommerce/blob/27451514df7b9167df1a3d0a8f92c2c45f62a5de/server/src/content-types/product-attribute/schema.json)).
  - Coupon đếm lượt dùng bằng cột `used_count`
    ([coupon/schema.json](https://github.com/webbycrown/webbycommerce/blob/27451514df7b9167df1a3d0a8f92c2c45f62a5de/server/src/content-types/coupon/schema.json)).

**Best practice**

- Build bằng `@strapi/sdk-plugin`, TypeScript, validate config bằng schema (zod) và gom lỗi.
- Bảng nội bộ có tiền tố tên bảng của plugin, tắt Draft & Publish, ẩn khỏi Content Manager. Mọi content
  type của plugin, kể cả catalog đang hiện ở Content Manager, phải ẩn khỏi **Content-Type Builder** để
  admin không sửa được schema của plugin.
- Không bao giờ ghi file vào thư mục của app lúc chạy (WebbyCommerce): container production thường chỉ
  đọc, và schema của plugin phải đi theo phiên bản plugin.
- Secret do admin nhập thì mã hóa khi lưu bằng khóa từ env; nên dùng chế độ có xác thực (AES-256-GCM)
  thay vì CBC không có MAC. Secret trong env vẫn là cách ưu tiên.
- Webhook: kiểm chữ ký trên body gốc, so bằng `timingSafeEqual`. Không có body gốc thì từ chối, **không
  serialize lại JSON** (Creem). Không gọi tiếp ra ngoài trong request webhook, không gọi service mà
  không `await` (Shopify); ghi event bền vững rồi xử lý qua outbox.
- Nối content của app với sản phẩm của plugin bằng custom field + Document Service middleware (Shopify)
  khi app muốn; không bắt buộc.
- Tiền là số nguyên, không dùng `decimal`. Tồn kho tách khỏi sản phẩm. Lượt dùng coupon phải có khóa
  hoặc bản ghi lượt dùng riêng, không chỉ tăng một cột.
- Thư viện thuộc tính có cờ "sinh biến thể / hiện cho khách / dùng để lọc" (WebbyCommerce, WooCommerce)
  là mẫu tốt cho module thuộc tính bán lẻ về sau.

## U3. Giao diện Admin cho O3: các hệ thống làm thế nào

Theo quy tắc từ 2026-10-10: mọi màn hình của plugin phải dựa trên cách các hệ thống có sẵn đã làm, để mockup đủ
chính xác cho người khác code. Mục này phục vụ mockup O3. Nguồn ở commit cố định:

| Nguồn | Commit | Giấy phép |
| --- | --- | --- |
| [TastyIgniter cart](https://github.com/tastyigniter/ti-ext-cart/tree/99fcb6208031bf20f9df4cda69f861080339ac62) | `99fcb62` | MIT |
| [TastyIgniter local](https://github.com/tastyigniter/ti-ext-local/tree/b8e31850c6168e4195c15f3049944bad354b7e92) | `b8e3185` | MIT |
| [Medusa admin dashboard](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages/admin/dashboard) | `146c46b` | MIT |
| [Saleor dashboard](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84) | `8b0e4c9` | BSD-3-Clause |
| [Vendure dashboard](https://github.com/vendure-ecommerce/vendure/tree/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard) | `e5146b1` | GPLv3 (chỉ học thiết kế) |
| [WooCommerce admin](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Internal/Admin/Orders) | `5fb08bd` | GPLv3 (chỉ học thiết kế) |

### U3.1. Danh sách đơn

- **TastyIgniter** ([order.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/resources/models/order.php)):
  cột mã, chi nhánh, khách, loại đơn (tự lấy/giao), ASAP, giờ, ngày, trạng thái (badge màu, đổi trạng thái
  ngay tại danh sách), thanh toán, tổng; cột ẩn mặc định: người được giao, SĐT, email, ngày tạo/sửa (vẫn tìm
  được). Bộ lọc: người được giao (chưa giao / của tôi / người khác), trạng thái, loại đơn, cách trả, khoảng ngày.
  Tìm một ô cho mọi cột tìm được.
- **Saleor** ([OrderListDatagrid](https://github.com/saleor/saleor-dashboard/blob/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/orders/components/OrderListDatagrid/datagrid.ts)):
  cột số đơn, ngày, khách, thanh toán, trạng thái, giao hàng, tiền trước thuế, tổng, kênh.
- **Medusa** ([order-list const](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/admin/dashboard/src/routes/orders/order-list/const.ts)):
  mã hiển thị, ngày, khách, kênh, trạng thái thanh toán, trạng thái giao, tổng.
- **Vendure** ([orders.tsx](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard/src/app/routes/_authenticated/_orders/orders.tsx)):
  người dùng tự bật/tắt cột (`defaultVisibility`), lọc theo state lấy từ chính quy trình đơn.
- **WooCommerce** ([ListTable.php](https://github.com/woocommerce/woocommerce/blob/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php)):
  tab trạng thái kèm số đếm, nút **Xem nhanh** mở hộp thoại ngay trên danh sách, cột thao tác nhanh trên dòng.

**Best practice:** tab trạng thái có số đếm; cột chính = mã, giờ lấy/giao, khách (SĐT che), loại đơn, tổng, thanh
toán (badge), trạng thái (badge), thời gian chờ; cột phụ ẩn mặc định nhưng tìm được; bộ lọc chi nhánh, ngày kinh
doanh, cách trả, loại đơn; xem nhanh không rời danh sách; trạng thái thanh toán và trạng thái xử lý là hai badge riêng.

### U3.2. Đơn mới tới: hộp thoại nhận/từ chối

- **TastyIgniter** ([status_workflow_modal](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/resources/views/_partials/orders/status_workflow_modal.blade.php),
  [InjectStatusWorkflow](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/src/Http/Middleware/InjectStatusWorkflow.php)):
  hộp thoại hiện **trên mọi trang Admin** khi có đơn mới: "chi nhánh: #mã · loại lúc giờ · món · tổng", nút
  **Nhận**, **Nhận và lùi N phút** (danh sách số phút cấu hình), **Từ chối** (chọn lý do từ danh sách cấu hình).
  Bật/tắt và giới hạn người dùng nhận hộp thoại bằng setting.

**Best practice:** đơn mới hiện ngay một thẻ tóm tắt với 3 hành động, không bắt nhân viên mở chi tiết; lý do từ
chối và số phút lùi là danh sách cấu hình; chỉ người trong scope chi nhánh nhận.

### U3.3. Chi tiết đơn và đổi trạng thái

- **Medusa** ([order-detail.tsx](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/admin/dashboard/src/routes/orders/order-detail/order-detail.tsx)):
  hai cột. Cột chính: thông tin chung (mã, ngày, badge, menu thao tác, hủy có hộp thoại xác nhận), tóm tắt món và
  tiền, thanh toán, giao nhận. Cột phụ: khách, **hoạt động** (dòng thời gian + ô ghi chú nội bộ
  `order-note-form`). Có `copy-payment-link`.
- **Saleor** ([orders/components](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/orders/components)):
  `OrderHistory` có ô ghi chú và thời gian tương đối ("5 phút trước"), `OrderCustomerNote`, `OrderAlerts`,
  `OrderCancelDialog` ("Hủy đơn #… / Giữ đơn / Hủy đơn"), `OrderMarkAsPaidDialog`, `OrderManualTransactionDialog`.
- **Vendure** ([state-transition-control](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard/src/app/routes/_authenticated/_orders/components/state-transition-control.tsx),
  [refund-order-dialog](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard/src/app/routes/_authenticated/_orders/components/refund-order-dialog.tsx),
  [add-manual-payment-dialog](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard/src/app/routes/_authenticated/_orders/components/add-manual-payment-dialog.tsx)):
  nút chuyển trạng thái lấy từ các bước kế tiếp hợp lệ của quy trình; hoàn tiền chọn số lượng từng dòng, hiện
  "tối đa được hoàn", lý do; ghi thanh toán tay gồm cách trả + mã giao dịch.
- **TastyIgniter** ([orderstatus.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/resources/models/orderstatus.php)):
  đổi trạng thái kèm **ghi chú** và công tắc **báo khách** (mặc định bật); lịch sử trạng thái có cột ngày, trạng
  thái, ghi chú, đã báo khách chưa, nhân viên.

**Best practice:** hai cột (món + tiền + thanh toán bên trái; khách, giờ lấy, lịch sử + ghi chú nội bộ bên phải);
nút chính đổi theo bước kế tiếp của workflow; mỗi lần chuyển bước cho thêm ghi chú và chọn báo khách; mọi thao
tác phá hủy (hủy, từ chối, hủy món, hoàn tiền) có hộp thoại xác nhận nêu rõ hậu quả và số tiền; hoàn tiền theo
dòng hiện số tối đa.

### U3.4. Tạo đơn hộ

- **Saleor** `OrderDraftPage`, `OrderProductAddDialog`, `OrderCustomerChangeDialog`, nút **Finalize**; lịch sử ghi
  "Đã tạo đơn nháp".
- **Vendure** [`orders_.draft.$id.tsx`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/dashboard/src/app/routes/_authenticated/_orders/orders_.draft.$id.tsx):
  trang nháp với tìm sản phẩm, chọn khách, cách giao, trạng thái nháp.
- **Medusa** có route `draft-orders` riêng.

**Best practice:** tạo đơn nháp → thêm món bằng ô tìm (hộp thoại chọn biến thể và tùy chọn) → khách → cách nhận
→ **Xác nhận** để thành đơn thật; đơn nháp có danh sách riêng.

### U3.5. Cài đặt chi nhánh cho tự lấy

- **TastyIgniter** ([collectionsettings.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/resources/models/collectionsettings.php),
  [workinghour.php](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/resources/models/workinghour.php)):
  bật nhận tự lấy; cộng lead time vào slot; khoảng slot (15'); thời gian chuẩn bị (25'); giới hạn giờ đặt
  (**chỉ ASAP / chỉ đặt trước / cả hai**); **hạn khách tự hủy** (phút trước giờ lấy); **đơn tối thiểu**; cho đặt
  trước, số ngày tối thiểu/tối đa. Giờ mở chọn kiểu 24/7, hằng ngày, theo bảng giờ từng ngày, linh hoạt.

**Best practice:** chia tab theo cách nhận (tự lấy, giao); mỗi tab có: bật/tắt, ASAP/đặt trước, thời gian chuẩn bị,
khoảng slot, sức chứa slot, đặt trước tối đa N ngày, đơn tối thiểu, hạn khách tự hủy, thời điểm trả tiền, cách trả.
Giờ mở dùng bảng theo ngày trong tuần, cho phép nhiều ca và ca qua nửa đêm.

### U3.6. Gán nhân viên vào chi nhánh

- **Saleor** (`PermissionGroupDetailsPage`): khung "Channels permissions" có ô **"Allow access to orders of all
  channels"** và danh sách chọn kênh có ô tìm ("Select visible order channels").
- **TastyIgniter** (`ti-ext-user` `User`): staff có danh sách location và `sale_permission` (mọi đơn / đơn nhóm /
  đơn được giao) — đã đọc ở C17.1.

**Best practice:** trong màn sửa nhân viên: một công tắc "Xem mọi chi nhánh" và, khi tắt, ô chọn nhiều chi nhánh có
tìm; danh sách nhân viên hiện cột chi nhánh và cảnh báo người chưa được gán.

### U3.7. Component của Strapi Design System dùng cho các màn trên

Có sẵn trong `@strapi/design-system` 2.2.3 của repo: `Table`/`RawTable`, `Tabs`, `Badge`, `Status`, `Button`,
`IconButton`, `Modal`, `Dialog` (xác nhận), `Field` + `TextInput`/`Textarea`/`NumberInput`/`Select`/`Combobox`/
`Checkbox`/`Switch`/`Toggle`/`DatePicker`/`TimePicker`, `Searchbar`, `Pagination`, `SimpleMenu` (menu thao tác),
`Popover`, `Tooltip`, `Alert`, `EmptyStateLayout`, `Loader`, `Card`, `Box`/`Flex`/`Grid`, `Typography`. Màn Admin của
app (hộp thư đặt bàn, nhật ký hoạt động) dùng `Box`, `Flex`, `Typography`, `Button`, `Tag`, `Alert`; plugin dùng
cùng bộ để giao diện đồng nhất. Bố cục trang dùng `Layouts`/`Page` của `@strapi/strapi/admin`; thông báo dùng
`useNotification`; gọi API dùng `useFetchClient`; ẩn hiện theo quyền dùng `useRBAC`.

## U4. Giao diện thanh toán và duyệt chuyển khoản (O4)

Nguồn thêm: [TastyIgniter payregister](https://github.com/tastyigniter/ti-ext-payregister/tree/86d0a991351718c250c9326bf0f741b508e196e6)
`86d0a99` (MIT).

- **Saleor** ([OrderTransaction](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/orders/components/OrderTransaction),
  [OrderTransactionTile](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/orders/components/OrderTransactionTile),
  [OrderManualTransactionDialog](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/orders/components/OrderManualTransactionDialog)):
  mỗi giao dịch là một khối: tên ("Transaction #1 on <ngày>"), tổng theo loại (đã giữ, đã thu, đã hoàn, đang chờ),
  danh sách sự kiện (loại, số tiền, mã tham chiếu bên cổng, thời gian, trạng thái Success/Failure/Pending/Info,
  link "View in payment provider"); trống thì "This transaction doesn't have any events". Hộp thoại "Manual
  transaction" cho cách trả không tích hợp (số tiền + mô tả/mã); nút "Mark as Paid".
- **Medusa** (`order-payment-section`, `copy-payment-link`): danh sách payment có badge trạng thái, nút thu
  (capture), hoàn; sao chép link thanh toán.
- **Vendure** (`add-manual-payment-dialog`, `settle-refund-dialog`): thêm thanh toán tay = cách trả + mã giao dịch;
  hoàn tiền có bước "settle" nhập mã giao dịch hoàn.
- **TastyIgniter** ([paymentlog.php](https://github.com/tastyigniter/ti-ext-payregister/blob/86d0a991351718c250c9326bf0f741b508e196e6/resources/models/paymentlog.php),
  [payment.php](https://github.com/tastyigniter/ti-ext-payregister/blob/86d0a991351718c250c9326bf0f741b508e196e6/resources/models/payment.php)):
  nhật ký thanh toán trong đơn; hoàn tiền chọn **Toàn phần / Một phần**, số tiền (hiện khi một phần), lý do. Danh
  sách cách trả: tên, mô tả, trạng thái, mặc định, bật/tắt hàng loạt.
- **Hàng duyệt chuyển khoản không khớp:** không hệ thống nào ở trên có (họ dùng cổng thẻ trả kết quả chắc chắn).
  Mẫu gần nhất là khối giao dịch của Saleor (sự kiện + mã tham chiếu) và hộp thoại giao dịch tay của Saleor/Vendure.

**Best practice:** thanh toán trong chi tiết đơn hiển thị theo khối giao dịch có sự kiện và mã tham chiếu; ghi tay luôn
có mã giao dịch; hoàn tiền chọn toàn phần/một phần, hiện số tối đa, bắt buộc lý do, và có bước ghi mã giao dịch hoàn
khi hoàn ngoài hệ thống. Hàng duyệt là danh sách riêng (giống hộp đơn) mỗi dòng mở hộp thoại xử lý có tab theo cách
xử lý.

## U5. Giao diện vùng giao và đơn đang giao (O5)

- **TastyIgniter** ([locationarea.php](https://github.com/tastyigniter/ti-ext-local/blob/b8e31850c6168e4195c15f3049944bad354b7e92/resources/models/locationarea.php),
  [deliverysettings.php](https://github.com/tastyigniter/ti-ext-cart/blob/99fcb6208031bf20f9df4cda69f861080339ac62/resources/models/deliverysettings.php)):
  mỗi vùng có tên, cờ mặc định, kiểu vùng (đa giác / bán kính / **theo thành phần địa chỉ**: danh sách
  "loại thành phần + giá trị"), bảng **điều kiện phí** lặp lại (phí, điều kiện: mọi đơn / trên / dưới, số tiền),
  bảng phí theo khoảng cách. Tab giao hàng có cùng bộ field với tự lấy (bật, ASAP/đặt trước, lead time, slot, hạn
  hủy, đơn tối thiểu, đặt trước N ngày).
- **Saleor** ([shipping/components](https://github.com/saleor/saleor-dashboard/tree/8b0e4c9875779dd5395c243f50ab31abb0616c84/src/shipping/components)):
  vùng → danh sách nước/khu vực được gán (trống: "Currently, there are no countries assigned…"), khoảng mã bưu
  chính gồm/trừ, các mức phí theo **giá trị đơn tối thiểu/tối đa** từng kênh.
- **Medusa** (`routes/locations`): location → service zone → geo zone (quốc gia, tỉnh, thành phố, mã bưu chính) →
  shipping option có giá theo điều kiện tổng đơn.
- **Người giao:** TastyIgniter dùng "người được giao" (assignee) trên đơn và lọc theo người được giao; không có
  màn riêng cho tài xế.

**Best practice:** vùng = danh sách địa bàn chọn từ danh mục (không gõ tự do) + bảng điều kiện phí xét theo thứ tự;
vùng trống có thông báo hướng dẫn; danh sách đơn giao lọc theo người giao (tái dùng mẫu assignee).

## U6. Giao diện vận hành, chốt tiền, báo cáo (O6)

- **Odoo POS 18.0** ([closing_popup.xml](https://github.com/odoo/odoo/blob/8749886bd765b1bf03af9cf423f92c9beaf52a0a/addons/point_of_sale/static/src/app/navbar/closing_popup/closing_popup.xml),
  LGPLv3): "Closing Register": mỗi cách trả một dòng **Đầu ca · Tiền vào · Đếm được · Chênh lệch**; ô đếm tiền mặt
  (có công cụ đếm theo mệnh giá); ghi chú mở/đóng ca; nút thu/chi tiền mặt; tải báo cáo bán trong ngày; "Close
  Register" / "Discard".
- **Action Scheduler** ([ActionScheduler_ListTable.php](https://github.com/woocommerce/action-scheduler/blob/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes/ActionScheduler_ListTable.php),
  GPLv3): danh sách job: tên, trạng thái (tab Chờ/Đang chạy/Lỗi/Xong/Hủy), tham số, nhóm, lặp, lịch, nhật ký; nút
  **Chạy ngay** và **Hủy** trên dòng; cảnh báo việc quá hạn ở đầu trang (C17.3).
- **Saleor** `AppProblem` (C17.3): cảnh báo có số lần, mức nghiêm trọng, nút bỏ qua (dismiss) ghi người bỏ qua.

**Best practice:** chốt tiền = bảng theo cách trả với cột hệ thống tính / đếm được / chênh lệch tô màu khi khác 0 và
ô ghi chú bắt buộc khi lệch; trang vận hành có thẻ tổng quan + bảng job có thao tác "chạy ngay"; cảnh báo là danh sách
có số lần, mức độ, "đã biết" ghi người.

## UW. Giao diện web đặt món (OW)

Nguồn thêm: [Medusa Next.js storefront](https://github.com/medusajs/nextjs-starter-medusa/tree/9818886f06e493cb2249733d114d339aa216ef00)
`9818886` (MIT); [TastyIgniter Orange theme](https://github.com/tastyigniter/ti-theme-orange/tree/b741f1e60a7cb449536d79024a413ae04095f248)
`b741f1e` (MIT).

- **TastyIgniter Orange** ([livewire](https://github.com/tastyigniter/ti-theme-orange/tree/b741f1e60a7cb449536d79024a413ae04095f248/resources/views/livewire),
  [includes](https://github.com/tastyigniter/ti-theme-orange/tree/b741f1e60a7cb449536d79024a413ae04095f248/resources/views/includes)):
  hộp **chọn cách nhận** ở đầu trang menu (giao/tự lấy, tìm hoặc đánh dấu địa chỉ, chọn giờ); món mở **hộp thoại
  món** (tùy chọn, ghi chú, "Thêm vào đơn"/"Cập nhật"); **giỏ cố định** bên cạnh (nhắc đơn tối thiểu, phí); checkout
  một bước hoặc hai bước, field theo cấu hình; trang đơn sau khi đặt có mã, chi tiết, món, quán, trạng thái, nút hủy
  và đặt lại.
- **Medusa storefront** ([checkout components](https://github.com/medusajs/nextjs-starter-medusa/tree/9818886f06e493cb2249733d114d339aa216ef00/src/modules/checkout/components)):
  checkout chia bước có thể mở lại (địa chỉ → giao hàng → thanh toán → xem lại), mã giảm giá, nút đặt hàng ở bước
  cuối, trang xác nhận đơn.

**Best practice:** chọn chi nhánh/cách nhận/giờ trước khi xem menu (giá và tạm hết phụ thuộc chi nhánh); món mở hộp
thoại tùy chọn; giỏ luôn thấy được và nhắc đơn tối thiểu; checkout một trang chia khối rõ (liên hệ → nhận hàng → thanh
toán → đồng ý → đặt); trang trạng thái có nút hủy khi còn được hủy.

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

### Vòng 4

- Strapi database local `@strapi/database/dist/index.js`, `transaction-context.d.ts`,
  `query/query-builder.js`: callback transaction, Knex `getConnection`, `forUpdate` và transaction
  context; đối chiếu [Strapi v5.51.1 database](https://github.com/strapi/strapi/tree/v5.51.1/packages/core/database).
- Strapi core local `services/document-service/index.js` và
  `services/document-service/middlewares/middleware-manager.js`: middleware chỉ bọc Document Service;
  direct `strapi.db.query` bypass wrapper; đối chiếu [Document Service middleware](https://docs.strapi.io/cms/api/document-service/middlewares).
- Strapi content-manager local `services/data-mapper.js` và `services/content-types.js`:
  `pluginOptions.content-manager.visible` mặc định true và tạo `isDisplayed`; đối chiếu
  [content-manager source](https://github.com/strapi/strapi/tree/v5.51.1/packages/core/content-manager).
- Strapi admin/permissions local `domain/action/provider.js`, `domain/condition/provider.js`,
  `permissions/dist/engine/index.js`: đăng ký action/condition trước bootstrap và evaluate condition
  thành ability/query; đối chiếu [Strapi admin source](https://github.com/strapi/strapi/tree/v5.51.1/packages/core/admin).
- Strapi core local `providers/cron.js`, `services/cron.js`: `server.cron.tasks` tạo
  `node-schedule` job trên từng process, không có claim dùng chung; đối chiếu [cron docs](https://docs.strapi.io/cms/configurations/cron).
- Medusa: [`product-option.ts`](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models/product-option.ts),
  [`product-variant.ts`](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models/product-variant.ts),
  [`product-type.ts`](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/product/src/models/product-type.ts),
  [`product-variant-inventory-item.ts`](https://github.com/medusajs/medusa/blob/146c46b0ad1146b40595c8ef586c4d5890982603/packages/modules/link-modules/src/definitions/product-variant-inventory-item.ts): option, variant, product type và required quantity cho kit.
- Vendure: [`product-option-group.entity.ts`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/product-option-group/product-option-group.entity.ts),
  [`facet.entity.ts`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/entity/facet/facet.entity.ts),
  [`order-item-price-calculation-strategy.ts`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/order-item-price-calculation-strategy.ts),
  [`order-line-discount-distribution-strategy.ts`](https://github.com/vendure-ecommerce/vendure/blob/e5146b14b080809b5d4b3bc429eb87b771aa843c/packages/core/src/config/order/order-line-discount-distribution-strategy.ts): option/facet/custom field, giá dòng và weight phân bổ discount.
- WooCommerce: `WC_Product_Factory` và `WC_Cart::generate_cart_id`: class product và cart identity
  tách variation khỏi cart data; [source](https://github.com/woocommerce/woocommerce/tree/5fb08bdc3cd394aa3748f1e74e46bf0681e85183/plugins/woocommerce/includes).
- Bagisto: `packages/Webkul/Product/src/Type/{Simple,Configurable,Grouped,Bundle,Virtual,Downloadable,Booking}.php`
  và booking helpers: product type và slot; [source](https://github.com/bagisto/bagisto/tree/3fb8300b6343baefcf57bec5b6a9c188a2177d57/packages/Webkul/Product/src/Type).
- Saleor: `saleor/payment/models.py`, `transaction_item_calculations.py`: các amount đã charge,
  authorize, refund, cancel và event cộng dồn; [source](https://github.com/saleor/saleor/tree/782a751f622c4a047798ce7084b7c66c0877ec6f/saleor/payment).
- Sylius: `sylius_order.yaml`, `OrderPaymentStates.php`, `OrderShippingStates.php`: state machine
  order/checkout/payment/shipping tách trục; [source](https://github.com/Sylius/Sylius/tree/39313695548c709756ee9073bf309fa4ae89365a/src/Sylius/Bundle/CoreBundle/Resources/config/app/workflow).
- Medusa: event-bus local, workflow execution, `locking-postgres/src/services/advisory-lock.ts`,
  `order-change.ts`, `tax-provider.ts`, `payment-collection.ts`; các file xác nhận event/retry/lock,
  order change, tax provider và collection; [source](https://github.com/medusajs/medusa/tree/146c46b0ad1146b40595c8ef586c4d5890982603/packages).
- Action Scheduler: `ActionScheduler_QueueRunner.php`, `ActionScheduler_DBStore.php`,
  `ActionScheduler_DBLogger.php`: claim batch, retry và log; [source](https://github.com/woocommerce/action-scheduler/tree/3a8178faa44f5b6dc2c7e56eb4a0195f80f86c64/classes).
- TastyIgniter local: `WorkingSchedule.php`, `WorkingTimeslot.php`: giờ mở, timeslot và policy theo
  local; [source](https://github.com/tastyigniter/ti-ext-local/tree/b8e31850c6168e4195c15f3049944bad354b7e92/src/Classes).
- SePay: các trang [tích hợp webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook),
  [xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
  [bảo mật](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat),
  [xử lý lỗi](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi),
  [đối soát](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich): payload, ACK exact,
  HMAC/API Key, replay, retry, API `GET /v2/transactions` và đối soát định kỳ.

### Sau review vòng 4 (C17)

- Vendure `role.entity.ts`, `get-user-channels-permissions.ts`, `request-context.ts`,
  `list-query-builder.ts`: quyền theo cặp role–channel, lọc list theo channel của request.
- Saleor `account/models.py`, `graphql/account/dataloaders.py`, `graphql/order/resolvers.py`,
  `graphql/core/mutations.py`: cờ hạn chế channel lưu rõ ràng, lọc truy vấn và kiểm object khi sửa.
- TastyIgniter `ti-ext-local` `Location.php`, `LocationAwareController.php`; `ti-ext-user`
  [`User.php`](https://github.com/tastyigniter/ti-ext-user/blob/3077e34fc9b6ee7a2df3beed79bf5d6171df9fbc/src/Models/User.php):
  lọc theo location chỉ ở màn hình Admin, danh sách rỗng thì không lọc; `sale_permission` 1/2/3.
- Medusa `rbac-policy.ts`, `rbac-role.ts`: RBAC theo resource/operation, không có chiều chi nhánh.
- Strapi local `@strapi/permissions/dist/engine/index.js`: handler async được await; kết quả không hợp
  lệ bị loại; khi mọi kết quả bị loại thì quyền bị từ chối (đã chứng minh ở spike O0).
- TastyIgniter `WorkingRange.php`, `WorkingSchedule.php`, `HasWorkingHours.php`, `ti-ext-cart`
  `OrderManager.php`: giờ qua nửa đêm, một timezone toàn hệ thống, lưu ngày/giờ địa phương trên đơn.
- Odoo 18.0 (LGPLv3) `pos_session.py`, `pos_order.py`, `pos_config.py`: đơn thuộc ca, một ca mở mỗi
  điểm bán, ngày đóng ca hiển thị theo timezone người xem.
- WooCommerce `class-wc-webhook.php`: tự tắt webhook sau 5 lần lỗi liên tiếp, thành công thì đặt lại.
- Action Scheduler `ActionScheduler_AdminView.php`, `ActionScheduler_QueueCleaner.php`: cảnh báo việc
  quá hạn, timeout claim/chạy 300 giây, thời hạn lưu 1 tháng/3 tháng.
- Saleor `app/models.py`, `graphql/app/mutations/app_problem_create.py`, `core/models.py`: cảnh báo
  gộp theo key và cửa sổ thời gian, ngưỡng critical, giới hạn số bản ghi.
- Vendure `job.ts`, `health-check.controller.ts`; Strapi local `services/server/index.js`: retry/trạng
  thái job, health check theo strategy; `/_health` của Strapi chỉ báo process còn sống.

### Sau review vòng 4 (C18–C20)

- Medusa `product-category.ts`, pricing (`price.ts`, `price-rule.ts`, `price-list.ts`), inventory
  (`inventory-item.ts`, `inventory-level.ts`, `reservation-item.ts`): danh mục dạng cây, giá theo quy tắc,
  tồn theo location tách khỏi variant.
- Vendure `collection.entity.ts`, `product-variant-price.entity.ts`, `stock-level.entity.ts`,
  `stock-movement/*`, `config/catalog/*`, `custom-field-types.ts`: collection dạng cây có filter, giá theo
  channel, sổ biến động tồn, các strategy chọn giá/kho/hiển thị tồn, custom field theo config.
- Saleor `product/models.py`: giá theo channel kèm giá vốn và giá trước giảm.
- TastyIgniter `Category.php`, `Mealtime.php`, `Menu.php`, `MenuOption*.php`, `MenuItemOption*.php`,
  `Stock.php`: danh mục cây, khung giờ bán, thư viện tùy chọn + ghi đè theo món, tồn đa hình theo location.
- Bagisto `ProductBundleOption*.php`, `Type/Bundle.php`, `ProductCustomizableOption*`,
  `ProductCustomerGroupPrice.php`, `ProductInventory.php`, `ProductOrderedInventory.php`, Attribute models:
  combo có nhóm chọn, tùy chọn cộng thêm theo sản phẩm, giá theo nhóm khách, tồn theo nguồn hàng, EAV.
- WooCommerce `ReserveStock.php`: giữ tồn có hạn khi checkout.
- Strapi local `@strapi/i18n/dist/server/services/content-types.js`, `@strapi/core/dist/loaders/components.js`,
  `registries/custom-fields.js`, `loaders/plugins/index.js` (`applyUserExtension`): relation luôn theo
  ngôn ngữ, plugin không nạp component, custom field của plugin, gộp schema mở rộng nông.
- Plugin Strapi 5: Shopify (`register.ts`, `config/*`, `shops/schema.ts`, `encrypt.ts`,
  `webhook.validator.ts`, `webhook.controller.ts`, `permissions.ts`), Open Mercato (`admin.service.ts`),
  Creem (`creem-controller.ts`), WebbyCommerce (`bootstrap.js`, schema product/attribute/coupon).

### Chưa kiểm được

- Chưa chạy plugin fixture với PostgreSQL để xác nhận lock transaction, Document Service middleware
  ordering/direct DB bypass, relation schema, cron concurrency, Admin permission và Content Manager UI.
- Chưa có tài khoản SePay live để xác nhận delivery/retry và dữ liệu thực tế; các field/response trên
  là contract tài liệu chính thức.
- Chưa có quyết định kế toán/pháp lý cho hóa đơn, VAT, retention cụ thể, phát hành voucher và deposit.
- Chưa chạy fixture để xác nhận permission condition lọc theo branch, behavior khi gọi trực tiếp
  `strapi.db.query`, claim/lease giữa hai Strapi process, và build TypeScript bằng `@strapi/sdk-plugin`.
- Chưa có tài khoản SePay live để xác nhận API reconciliation, replay thực tế, whitelist IP và hành vi
  khi response timeout; tài liệu chính thức mới xác nhận contract và lịch retry đã ghi ở C10.
