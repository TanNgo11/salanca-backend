# Handoff: nghiên cứu lõi + adapter cho plugin bán hàng generic (Strapi 5)

Bạn nhận tiếp một việc nghiên cứu đang làm dở. Đọc hết file này trước khi làm.

## 1. Bối cảnh

- Repo: `D:\outsource\salanca\salanca-backend` (Strapi 5.51.1, TypeScript, pnpm, Vitest, PostgreSQL).
  Web: `D:\outsource\salanca\salanca-web` (Next.js). Đọc `AGENTS.md` của repo trước.
- Mục tiêu sản phẩm: một **plugin bán hàng generic cho Strapi 5**, dùng lại cho **nhiều khách, nhiều
  ngành hàng** (nhà hàng, bán lẻ, mỹ phẩm, đồ điện tử, dịch vụ…). Salanca (chuỗi nhà hàng nhiều chi
  nhánh) chỉ là khách đầu tiên, cần tính năng đặt món online.
- Vì vậy phải **chuẩn hoá từ chức năng lõi đến các adapter tích hợp bên ngoài** (catalog, thanh toán,
  giao nhận, thông báo, cấu hình). Nhà hàng (F&B) chỉ là một "industry module", không được là hình dạng
  của lõi. Quyết định này của chủ dự án, không tranh luận lại.

### Quyết định đã chốt

- Plugin là **local plugin** trong `salanca-backend/src/plugins/ordering`, UID `plugin::ordering.*`, tên
  bảng cố định từ ngày đầu. Chưa tách repo.
- Viết như plugin độc lập: code trong plugin **không import gì ngoài thư mục plugin**, không hardcode UID
  của Salanca (`api::menu-item.menu-item`…). Khác biệt giữa các app đi qua `config/plugins.ts`. Phần
  riêng của Salanca (email qua trang "Email thông báo", audit log) nghe event do plugin bắn.
- Plugin **không sở hữu bảng sản phẩm của app**: đọc qua catalog adapter, chụp (snapshot) dữ liệu vào dòng
  hàng.
- Đặt bàn (`reservation-request`) là tính năng riêng của Salanca, không thuộc plugin.
- Tiền lưu số nguyên VND. Giá tính lại hoàn toàn ở server.
- Workflow trạng thái đơn khai báo dạng dữ liệu trong code (module ngành khai báo), app chỉ được tắt bước
  tùy chọn; chủ shop không tự tạo trạng thái.
- Thanh toán đầu tiên: SePay (chuyển khoản ngân hàng, webhook biến động số dư) + tiền mặt/COD.

### Đặc điểm của Salanca cần nhớ khi áp vào

- Nhiều chi nhánh (`api::location.location`, có `operatingHours` theo chi nhánh).
- `api::menu-item.menu-item`: i18n (vi/en), draftAndPublish, `price` kiểu `decimal`, `isActive`.
- Đổi schema content type của Salanca kéo theo phải cập nhật seed `bundle.json` + `schemaHash`.
  **Tuyệt đối không chạy `pnpm export:cms-seed`.**

## 2. Đã làm xong

`docs/plans/ordering-reference.md`: đọc source 5 hệ thống, 12 best practice cho các mục trạng thái đơn,
thanh toán/hoàn tiền, snapshot dòng hàng, tính tiền/khuyến mãi, giữ hàng/giới hạn đơn, checkout an toàn,
mã đơn, lịch sử/ghi chú, thông báo, điểm mở rộng, phần F&B (TastyIgniter), khung plugin Strapi
(WebbyCommerce).

**Lưu ý:** tài liệu đó viết khi còn nghĩ "làm F&B trước". Các đoạn "Áp vào plugin" và bảng "Mô hình dữ
liệu gợi ý" có chỗ mang giả định nhà hàng (ví dụ "hết món", "bước bếp" nằm trong lõi). Phải rà lại theo
hướng đa ngành.

## 3. Nguồn tham khảo (ghim commit)

| Hệ thống | Repo | Commit | Giấy phép |
| --- | --- | --- | --- |
| Medusa v2 | `medusajs/medusa` | `146c46b0ad1146b40595c8ef586c4d5890982603` | MIT (trừ phần Enterprise) |
| Vendure v3 | `vendure-ecommerce/vendure` | `e5146b14b080809b5d4b3bc429eb87b771aa843c` | GPLv3 / thương mại |
| WooCommerce | `woocommerce/woocommerce` | `5fb08bdc3cd394aa3748f1e74e46bf0681e85183` | GPLv3 |
| TastyIgniter cart (4.x) | `tastyigniter/ti-ext-cart` | `99fcb6208031bf20f9df4cda69f861080339ac62` | MIT |
| TastyIgniter local (4.x) | `tastyigniter/ti-ext-local` | `b8e31850c6168e4195c15f3049944bad354b7e92` | MIT |
| TastyIgniter payregister (4.x) | `tastyigniter/ti-ext-payregister` | `86d0a991351718c250c9326bf0f741b508e196e6` | MIT |
| WebbyCommerce | `webbycrown/webbycommerce` | `27451514df7b9167df1a3d0a8f92c2c45f62a5de` | MIT |

**Giấy phép:** Vendure và WooCommerce là GPL, chỉ học thiết kế, **không chép code**. Nguồn MIT chép được
nếu giữ thông báo bản quyền, nhưng ở giai đoạn này chỉ cần mô tả thiết kế.

Bản clone cũ có thể còn ở
`C:\Users\tan_ngo\AppData\Local\Temp\claude\D--outsource-salanca\b80be30d-1441-4fcb-b669-6b08efc50aa6\scratchpad\refs\`.
Nếu không còn, clone lại **ngoài repo** (ví dụ `D:\outsource\_refs`), checkout đúng commit, chỉ đọc,
không cài, không chạy code đã tải về. Medusa và WooCommerce lớn, dùng sparse checkout:

```bash
git clone --filter=blob:none --sparse https://github.com/medusajs/medusa medusa
git -C medusa checkout 146c46b0ad1146b40595c8ef586c4d5890982603
git -C medusa sparse-checkout set packages/modules packages/core/core-flows/src packages/core/utils/src packages/core/types/src
# Vendure: packages/core/src (thêm packages/email-plugin/src nếu cần phần thông báo)
# WooCommerce: plugins/woocommerce/includes plugins/woocommerce/src
```

Được thêm nguồn khác nếu thật sự cần (ví dụ Saleor, Sylius, Bagisto, Shopware, Orderable), ghi rõ commit
và giấy phép.

## 4. Phát hiện đã có nhưng CHƯA ghi vào tài liệu

Đã đọc trong phiên trước, dùng lại, không cần đọc lại từ đầu (nên mở file để lấy link chính xác):

**Ranh giới module (Medusa)**
- Mỗi module sở hữu bảng riêng, không FK chéo module. Dòng hàng chỉ lưu `product_id` / `variant_id`
  dạng text + snapshot.
- Quan hệ giữa module là bảng link riêng (`packages/modules/link-modules/src/definitions/*`). Ví dụ
  `product-variant-inventory-item` có `required_quantity`: một biến thể tiêu hao nhiều inventory item,
  tức là hỗ trợ combo/kit.
- Có provider `locking-postgres` (`packages/modules/providers/locking-postgres`).

**Catalog / dòng hàng**
- Medusa `prepareLineItemData` (`core-flows/src/cart/utils/prepare-line-item-data.ts`) dựng snapshot từ
  variant; `findMatchingLineItem`: gộp dòng chỉ khi cùng variant + cùng `metadata` (cấu hình) + cùng
  trạng thái giá tuỳ chỉnh.
- WooCommerce `WC_Cart::generate_cart_id` = hash(product + variation + attributes + `cart_item_data`);
  `WC_Product_Factory` chọn class theo loại sản phẩm (simple/variable/grouped/external), có filter để thêm loại.
- Vendure: `ProductVariantPriceCalculationStrategy` (giá niêm yết) tách khỏi
  `OrderItemPriceCalculationStrategy.calculateUnitPrice(ctx, variant, orderLineCustomFields, order, qty)`
  (giá theo cấu hình của dòng, ví dụ khắc chữ/topping). Có custom fields cho entity và cho order line.
- TastyIgniter: interface `Buyable` (`getBuyableIdentifier/Name/Price`), `OrderTypeInterface`.

**Cổng thanh toán**
- Medusa `AbstractPaymentProvider`
  (`packages/core/utils/src/payment/abstract-payment-provider.ts`):
  - `static validateOptions`
  - `initiatePayment`, `authorizePayment`, `capturePayment`, `cancelPayment`, `deletePayment`
  - `getPaymentStatus`, `refundPayment`, `retrievePayment`, `updatePayment`
  - `getWebhookActionAndData(payload) → { action, data: { session_id, amount } }`
  - Action: `authorized | captured | failed | pending | requires_more | canceled | not_supported`.
- Vendure:
  - `PaymentMethodHandler`: `createPayment`, `settlePayment`, `cancelPayment`, `createRefund`, hook
    chuyển trạng thái.
  - `PaymentMethodEligibilityChecker`.
  - Entity `PaymentMethod { code, enabled, handler: {code,args}, checker: {code,args}, translations }`.
  - Mẫu chung `ConfigurableOperationDef`: code đăng ký "loại" kèm schema tham số (`type`, `required`,
    `defaultValue`, `list`, `label`, `description`, `ui`), admin tạo "instance" với giá trị tham số.
    Mẫu này dùng chung cho payment, shipping, promotion.
- WooCommerce `WC_Payment_Gateway`:
  - `supports[]` khai báo khả năng (products, refunds…), `is_available()` (bật, `max_amount`, quốc gia).
  - `process_payment`, `process_refund`, `can_refund_order`.
  - Settings API `form_fields` (gateway tự khai báo form cài đặt).
  - Webhook qua `wc-api`.
- TastyIgniter `BasePaymentGateway`:
  - `defineFieldsConfig`, `registerEntryPoints` (URL webhook), `completesPaymentOnClient`,
    `processPaymentForm`.
  - Khả năng tách thành trait: `WithApplicableFee` (`isApplicable(total)`, phí cộng thêm),
    `WithAuthorizedPayment`, `WithPaymentProfile`, `WithPaymentRefund`.
  - Model `Payment` (instance do admin tạo): `class_name`, `data` (config), `status`, `is_default`,
    `priority`, `order_total` tối thiểu, `order_fee` + kiểu phí.
  - `PaymentLog` lưu request/response thô.

**Giao nhận**
- Medusa `AbstractFulfillmentProviderService`:
  - `getFulfillmentOptions`, `validateFulfillmentData`, `validateOption`, `canCalculate`, `calculatePrice`
  - `createFulfillment`, `cancelFulfillment`, documents/labels, return.
  - Model: `fulfillment_set` (shipping/pickup) theo stock location → `service_zone` → `geo_zone`;
    `shipping_option` có provider, rules, price type.
  - `fulfillment` lưu trạng thái bằng mốc thời gian `packed_at` / `shipped_at` / `delivered_at` /
    `canceled_at`, kèm labels (tracking).
- Vendure: `ShippingCalculator` (trả `price`, `priceIncludesTax`, `taxRate`, `metadata`),
  `ShippingEligibilityChecker`, `FulfillmentHandler`. Đều là `ConfigurableOperationDef`.
- TastyIgniter: order type (delivery/collection) là class đăng ký được; vùng giao theo chi nhánh với điều
  kiện phí theo tổng đơn.

**Thông báo**
- Medusa notification:
  - Bảng `notification`: `to`, `from`, `channel`, `template`, `data`, `trigger_type`, `resource_id/type`,
    `receiver_id`, `idempotency_key` unique, `external_id`, `status`.
  - Provider khai báo `channels` (email, sms, feed…); trùng `idempotency_key` thì không gửi lại.

**Cấu hình**
- Strapi plugin: `config: { default, validator }` ở server; app truyền qua `config/plugins.ts`; đọc bằng
  `strapi.plugin('<id>').config(key)`; setting sửa được lúc chạy thì để trong `strapi.store`.
- Medusa: module/provider options trong `medusa-config`, provider tự `validateOptions`; secret lấy từ env.
- Vendure:
  - `VendureConfig` trong code + entity instance trong DB (PaymentMethod, ShippingMethod, Promotion).
  - `SettingsStore` (`config/settings-store/settings-store-types.ts`): field có `scope` (global, user,
    channel…), `readonly`, `requiresPermission`, `validate`.
- WooCommerce: settings API theo gateway/method. TastyIgniter: `defineFieldsConfig` + bản ghi instance.
- WebbyCommerce: `validator` rỗng; lưu cả SMTP password trong `strapi.store`. Đây là ví dụ không nên làm.

## 5. Việc cần làm: khám phá với nhiều góc nhìn

Với mỗi góc nhìn: đọc source thật ở cả các hệ thống liên quan → mô tả mỗi hệ thống làm thế nào (link file
ở đúng commit) → rút best practice chung → đề xuất áp vào plugin (lõi generic + industry module + adapter).
**Không ghép mỗi chủ đề với một repo**: so tất cả nguồn liên quan rồi tổng hợp.

1. **Ranh giới module và chiều phụ thuộc**: lõi gồm những module nào; cái gì là module ngành, cái gì là
   provider; module nào được biết module nào; dữ liệu ai sở hữu.
2. **Hàng bán được generic (Sellable)** cho nhiều ngành: biến thể (size/màu), modifier/topping, combo/kit,
   hàng số/dịch vụ, hàng không cần giao. Contract của catalog adapter để map content type bất kỳ của app
   Strapi (field mapping hay resolver function; i18n; draft/publish; giá decimal). Danh tính dòng hàng và
   quy tắc gộp dòng.
3. **Giá và tiền**: chiến lược giá niêm yết vs giá theo cấu hình dòng; giá gạch; làm tròn; giá đã gồm VAT;
   một tiền tệ (VND) nhưng không đóng chết; bảng giá theo chi nhánh/kênh.
4. **Tồn kho / khả dụng** theo nhiều mức: không theo dõi / bật-tắt hết hàng / đếm số lượng / sức chứa theo
   khung giờ; theo chi nhánh; giữ chỗ có hạn.
5. **Contract PaymentProvider** đủ chung cho: SePay (chuyển khoản + webhook biến động số dư, không có
   authorize), COD/tiền mặt, sau này VNPay/MoMo/ZaloPay/thẻ (redirect + IPN, có refund API). Khả năng
   (capabilities), luồng webhook (lưu sự kiện thô → chuẩn hoá → lõi khớp đơn), idempotency, job đối soát,
   giao dịch chưa khớp, hoàn tiền tay và qua API. **Kiểm từ tài liệu chính thức** (ghi URL): định dạng
   webhook SePay (field, cách xác thực, retry, phản hồi mong đợi), link QR (VietQR/SePay); luồng IPN của
   VNPay và MoMo ở mức đủ để kiểm contract.
6. **Contract FulfillmentProvider**: nhận tại cửa hàng, cửa hàng tự giao, hãng (GHN/GHTK/Viettel
   Post/Ahamove/Grab). Tính phí, vùng giao, khung giờ, tạo vận đơn, theo dõi. Địa chỉ Việt Nam 2 cấp từ
   1/7/2025: kiểm nguồn dữ liệu và ghi lại.
7. **Contract NotificationProvider**: email, Telegram, Zalo OA/ZNS, SMS; template theo sự kiện; chống gửi
   trùng; nhật ký gửi.
8. **Cấu hình nhiều tầng**:
   - code (`config/plugins.ts` + validator, secret từ env)
   - setting vận hành do admin sửa (global / theo chi nhánh)
   - instance provider có tham số kiểu ConfigurableOperation
   - bật/tắt module tùy chọn

   Mỗi loại đặt ở đâu trong Strapi (`strapi.store`, content type cài đặt, env). Ai được sửa (RBAC).
9. **Điểm mở rộng**: strategy, hook validate, filter giá, event sau commit; contract của một industry module
   (khai báo workflow, validate cấu hình dòng, tính giá dòng, khả dụng).
10. **Khách hàng**: khách vãng lai theo SĐT, tài khoản sau này, sổ địa chỉ; quyền xem đơn của khách.
11. **Workflow theo ngành**: bán lẻ ship vs F&B nhận tại quán/giao vs dịch vụ; lõi chỉ hiểu cờ chung.
12. **Bề mặt admin/nhân viên và RBAC** trong Strapi admin; màn hình xử lý đơn.
13. **Kiểm thử để đảm bảo độc lập**: app Strapi trống làm fixture, test contract cho adapter.

Không làm multi-tenant (mỗi khách một app Strapi riêng), chỉ ghi chú nếu có điểm cần giữ đường lui.

## 6. Kết quả cần giao

1. **Cập nhật `docs/plans/ordering-reference.md`:**
   - Rà lại theo hướng đa ngành; thêm các mục mới theo góc nhìn ở mục 5.
   - Giữ cấu trúc "mỗi hệ thống làm thế nào → best practice → áp vào plugin".
   - Giữ link ghim commit; đánh dấu rõ chỗ nào chưa kiểm được.
2. **Tạo `docs/plans/ordering-core-contracts.md`** (đề xuất thiết kế, chưa phải code):
   - Sơ đồ module, chiều phụ thuộc.
   - Phác thảo interface TypeScript cho: `CatalogAdapter` / `Sellable`, `IndustryModule`,
     `PaymentProvider`, `FulfillmentProvider`, `NotificationProvider`, `PricingStrategy` (nếu cần).
   - Schema cấu hình plugin (`config/plugins.ts`) và setting vận hành.
   - Danh sách event.
   - Mô hình dữ liệu lõi.
   - Mapping cụ thể cho Salanca: `menu-item`, `location`, SePay, tiền mặt, nhận tại quán.
   - Mục "Câu hỏi còn mở".
3. Tin nhắn cuối: tóm tắt các quyết định đề xuất quan trọng nhất, chỗ nào mâu thuẫn với tài liệu cũ,
   chỗ nào chưa kiểm được.

## 7. Quy tắc làm việc

- Viết tài liệu bằng **tiếng Việt**, giữ nguyên thuật ngữ kỹ thuật, tên API, tên file bằng tiếng Anh.
- **Chỉ tạo/sửa 2 file tài liệu ở mục 6.** Không sửa code, không tạo plugin, không đổi schema.
- **Không commit, không push.** Working tree đang có thay đổi không liên quan (webhook
  `src/domain/cms-webhook/*`, `docs/cms-api-contract.md`, dòng webhook trong `docs/STATUS.md`, các file
  đang xoá `data/media/salanca/*`, `scripts/seed-menu-decor.mjs`, `scripts/verify-source-content.mjs`):
  không đụng, không stage.
- Không publish ra ngoài; tài liệu chỉ để trong repo.
- Mọi khẳng định về hệ thống tham khảo phải từ source đã đọc (kèm link) hoặc tài liệu chính thức (kèm
  URL). Không chắc thì ghi "chưa kiểm".
- Không chép code từ nguồn GPL. Không chạy code tải về.
- Không log hay ghi dữ liệu cá nhân thật của khách vào tài liệu.
