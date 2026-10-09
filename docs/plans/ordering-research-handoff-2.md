# Handoff vòng 2: sửa thiết kế + khám phá source có mục tiêu

Bạn tiếp tục việc nghiên cứu plugin bán hàng generic. Đọc theo thứ tự, đọc hết trước khi làm:

1. `docs/plans/ordering-research-handoff.md` (vòng 1: bối cảnh, quyết định đã chốt, nguồn, quy tắc).
   Mọi quy tắc ở mục 7 của file đó vẫn áp dụng.
2. `docs/plans/ordering-reference.md` và `docs/plans/ordering-core-contracts.md` (kết quả vòng 1).
3. File này.

Nhắc lại hướng sản phẩm: plugin dùng cho **nhiều khách, nhiều ngành hàng**. Salanca chỉ là khách đầu
tiên. Lõi và các adapter phải generic; nhà hàng chỉ là một trong các cách dùng.

## 1. Nhận xét về vòng 1

Vòng 1 đạt mức bản nháp: đủ 13 góc nhìn, giữ đúng quy tắc, phần VNPAY và MoMo khớp tài liệu chính thức.
Nhưng:

- Mục 13–25 của `ordering-reference.md` chủ yếu viết lại ghi chú có sẵn trong handoff vòng 1, ít đọc
  thêm source mới. Vòng này mỗi mục phải có file source mới đọc, kèm link.
- Còn một sai sót thực tế về SePay và nhiều lỗi thiết kế, liệt kê ở mục 2.

## 2. Lỗi phải sửa

**A. SePay: thiếu yêu cầu phản hồi và payload**

Tài liệu chính thức có tại
[tích hợp webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook):

- Endpoint phải trả HTTP `200` hoặc `201`, body đúng `{"success": true}`, trong vòng 30 giây. Mọi phản
  hồi khác (kể cả 200 thiếu body đó) bị coi là lỗi và SePay gửi lại.
- Payload có `id` (dùng để chống trùng, giữ nguyên qua các lần gửi lại), `gateway`, `transactionDate`,
  `accountNumber`, `subAccount`, `code` (mã thanh toán SePay tách từ nội dung theo tiền tố đã cấu hình,
  có thể `null`), `content`, `transferType` (`in`/`out`), `description`, `transferAmount`,
  `accumulated`, `referenceCode`.

Việc cần làm:

- Đọc thêm các trang
  [xác thực](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
  [bảo mật](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat),
  [xử lý lỗi / lịch retry](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi), và API tra cứu
  giao dịch (dùng cho job đối soát) nếu có.
- Sửa cả hai tài liệu: bỏ câu "chưa kiểm payload"; ghi rõ những gì tài liệu xác nhận và những gì chỉ
  kiểm được khi có tài khoản thật.

**B. Hai tài liệu mâu thuẫn nhau**

- Mục 1–12, bảng "Mô hình dữ liệu gợi ý" và "Còn mở" của `ordering-reference.md` vẫn theo hướng nhà
  hàng; vòng 1 chỉ thêm đoạn "Quyết định cập nhật" ở cuối.
- Phân vai lại:
  - `ordering-reference.md` **chỉ chứa nghiên cứu**: mỗi hệ thống làm thế nào, best practice.
  - `ordering-core-contracts.md` là **nguồn duy nhất cho thiết kế**.
- Bỏ phần "Áp vào plugin" mang giả định nhà hàng và bảng mô hình dữ liệu cũ khỏi reference, thay bằng
  link sang contracts. Cập nhật lại 12 best practice ở đầu theo kết quả mới.

**C. Event có thể mất, và một event phát sai thời điểm**

- "Phát event sau commit": nếu server chết giữa lúc lưu đơn và lúc phát event thì mất event (mất
  thông báo, mất xác nhận thanh toán).
- Thiết kế **outbox**: ghi event vào bảng trong cùng transaction, job định kỳ đọc ra và giao, có
  retry và đánh dấu đã giao. Strapi không có hàng đợi job (kiểm cron của Strapi).
- `ordering.order.created` đang ghi là phát "trong transaction": sửa cho khớp.

**D. Tính giá và kiểm tùy chọn nằm nhiều chỗ chồng nhau**

- Giá ở 3 chỗ: `CatalogAdapter.getPrice`, `IndustryModule.priceLine`, `PricingStrategy.quote`.
- Kiểm tùy chọn ở 2 chỗ: `CatalogAdapter.validateOptions`, `IndustryModule.validateLine`.
- Chỉ định rõ: ai trả giá niêm yết, ai tính giá theo cấu hình của dòng, ai chạy pipeline tổng của đơn,
  thứ tự gọi. Vendure tách sẵn ba lớp này.

**E. Mỗi app chỉ có một industry module (`industry.module`)**

- Thực tế một khách bán nhiều loại hàng: Salanca có món ăn và voucher buffet (`menu-package`); shop mỹ
  phẩm bán sản phẩm và dịch vụ.
- Thiết kế lại: hành vi theo **loại hàng ở từng dòng** (registry kiểu product type), workflow chọn theo
  đơn hoặc hình thức nhận. Đối chiếu WooCommerce product type, Bagisto product type, Medusa
  `product_type`.

**F. `Sellable` thiếu so với chính phần nghiên cứu**

- Combo/kit (reference nói có, contract không có).
- Tách **biến thể** (SKU và tồn kho riêng) với **tùy chọn cộng giá** (topping, khắc chữ).
- Tùy chọn: lựa chọn mặc định, số lượng miễn phí, lựa chọn chỉ hiện khi đã chọn lựa chọn khác.
- Giới hạn số lượng (min, max, bước), nhóm thuế, khả dụng theo chi nhánh hoặc khung giờ.
- `kind` là một enum đơn, trong khi các nguồn dùng cờ (`requires_shipping`, virtual, downloadable,
  gift card). Chọn lại có lý do.

**G. Tiền dùng `bigint`**

- `JSON.stringify` lỗi với `bigint`; Strapi trả cột `biginteger` về dạng chuỗi.
- Tiền VND nằm gọn trong số nguyên an toàn của JavaScript.
- Chọn một cách (ví dụ number + `Number.isSafeInteger`, cột `biginteger` đọc ra rồi chuyển đổi), ghi lý
  do và rủi ro.

**H. `PaymentProvider` thiếu**

- Dữ liệu hiển thị cho chuyển khoản: QR, số tài khoản, nội dung, hạn thanh toán.
- Phản hồi riêng mỗi cổng đòi (SePay JSON, VNPAY `RspCode`, MoMo 204): contract phải cho provider trả
  về phản hồi HTTP.
- Hàm huỷ; hàm truy vấn/liệt kê giao dịch cho job đối soát.
- Một webhook có thể chứa nhiều sự kiện; bỏ qua tiền ra.
- Cách core cấu hình mẫu mã đơn để provider tách mã (SePay có sẵn `code`).
- Quy tắc khi chuyển thiếu, chuyển thừa, chuyển hai lần.

**I. Khung giờ, giờ nhận, thời gian chuẩn bị chưa có chỗ chứa**

Chúng không nằm trong `FulfillmentProvider` lẫn `IndustryModule`. Thêm contract lịch nhận hàng
(scheduling): giờ mở theo chi nhánh × hình thức nhận, lead time, khung giờ, sức chứa, đặt trước, ngày
nghỉ.

**J. Còn lại**

- Kênh thông báo đang là union cứng: đổi sang registry. Ghi rõ ai quyết định người nhận (khách hay nhân
  viên) và template render ở đâu.
- Các bảng trong cùng plugin nối bằng chuỗi `orderRef`: dùng relation thật trong plugin, chỉ tham chiếu
  ra ngoài plugin mới là chuỗi.
- Bảng `order` thiếu cột tổng để lọc và báo cáo.
- Cổng thanh toán chỉ bật/tắt bằng code: trình bày phương án cho admin bật/tắt kèm điều kiện (đơn tối
  thiểu, phí) như Vendure, WooCommerce, TastyIgniter. **Không tự chốt**; ghi vào "Câu hỏi còn mở".

## 3. Khám phá source có mục tiêu

Mỗi dòng dưới đây đọc để gỡ một quyết định. Ghi kết quả vào reference theo khuôn "mỗi hệ thống làm thế
nào → best practice", rồi áp vào contracts. Đường dẫn file là gợi ý theo bản mới; nếu không thấy thì tìm
trong repo và ghi đường dẫn thật.

### Ưu tiên 1 (bắt buộc)

**1. Source Strapi 5.51.1 của chính project**

Có sẵn trong `node_modules/.pnpm/@strapi+*`, chỉ đọc, **không sửa `node_modules`**. Trả lời:

- `strapi.db.transaction` hoạt động thế nào; có lấy được knex transaction để `forUpdate()` không.
- Document Service middleware (`strapi.documents.use`) có chặn được ghi trực tiếp vào bảng đơn không.
- Tuỳ chọn ẩn content type khỏi Content Manager.
- Plugin đăng ký quyền Admin thế nào.
- Cron của Strapi (`config/server` `cron`).
- `@strapi/sdk-plugin`: cách build plugin TypeScript.

Ghi rõ chỗ nào chỉ kiểm được bằng chạy thử plugin trống. Vòng này **không** dựng plugin, không viết code.

**2. Mô hình sản phẩm đa ngành**

- Medusa: product module (option, variant, `product_type`), link `product-variant-inventory-item`
  (`required_quantity` cho combo/kit).
- Vendure: `ProductOptionGroup`, `Facet`, custom field, `OrderItemPriceCalculationStrategy`.
- WooCommerce: variable / grouped / virtual / downloadable.
- **Bagisto (mới)**: các loại sản phẩm trong `packages/Webkul/Product/src/Type/`, bundle, booking.

Kết quả: chốt lại `Sellable`, biến thể vs tùy chọn, combo, registry loại hàng theo dòng.

**3. Sổ cái thanh toán: Saleor (mới)**

`TransactionItem` / `TransactionEvent`: số đã authorize, đã thu, đã hoàn, đã huỷ; mã tham chiếu của
cổng; cách cộng dồn. Đối chiếu với payment collection của Medusa. Kết quả: contract `PaymentProvider` và
bảng `payment` / `payment-event` đủ chung cho SePay, tiền mặt, VNPAY, MoMo.

**4. Event và job đáng tin cậy**

- Medusa: module event bus (local / redis), workflow engine (cách lưu bước, retry), provider
  `locking-postgres`.
- WooCommerce: Action Scheduler (repo `woocommerce/action-scheduler`, GPL, chỉ học thiết kế).

Kết quả: thiết kế outbox + job định kỳ + khoá trên PostgreSQL trong Strapi.

**5. Lịch nhận hàng và khung giờ**

- TastyIgniter: `ti-ext-local/src/Classes/WorkingSchedule.php`, `WorkingTimeslot.php`,
  `ti-ext-cart/src/Classes/AbstractOrderType.php`, phần giới hạn số đơn theo khung giờ.
- Bagisto: slot của sản phẩm booking.

Kết quả: contract scheduling.

### Ưu tiên 2 (giữ đường lui trong thiết kế dữ liệu)

**6. Sửa đơn, huỷ một phần, đổi/trả**

Vendure `OrderModifier` và trạng thái `Modifying`; Medusa order change và các cột số lượng trên dòng (đã
giao, đã trả…). Kết quả: dòng hàng có sẵn các cột số lượng để sau này thêm tính năng không phải migrate
lớn. Không thiết kế đầy đủ tính năng.

**7. Trạng thái nhiều trục: Sylius (mới)**

Sylius tách trạng thái đơn, checkout, thanh toán, giao hàng. Đối chiếu với quyết định "chỉ lưu trạng
thái đơn, thanh toán tính ra".

**8. Thuế VAT và hoá đơn điện tử**

- Vendure `TaxCategory` / `TaxRate` / tax zone; Medusa tax provider.
- Nghị định 70/2025/NĐ-CP về hoá đơn: đọc từ văn bản chính thức. Chỉ cần xác định ai phải xuất hoá đơn
  điện tử từ máy tính tiền và dữ liệu đơn cần có gì.

Kết quả: chỗ cắm `InvoiceProvider`; giá đã gồm VAT hay chưa.

**9. Khách hàng và khách vãng lai**

Medusa customer / account holder; Vendure `GuestCheckoutStrategy`. Kết quả: bảng khách theo SĐT có
cần ở v1 không.

### Đã chốt: đặt lịch hẹn và bán voucher sẽ có sau này

Chủ dự án xác nhận (2026-10-10): **sau này plugin sẽ có cả bán voucher / thẻ quà tặng và dịch vụ đặt
lịch hẹn.** Chưa chắc làm ở v1, nhưng mô hình dữ liệu và contract lõi **không được chặn đường** hai tính
năng này. Chi tiết việc cần khám phá ở mục 7.

## 4. Nguồn mới

Clone **ngoài repo** (ví dụ `D:\outsource\_refs`), `--depth 1` hoặc sparse; chỉ đọc, không cài, không
chạy. Với mỗi repo: ghi SHA commit đã đọc và **kiểm giấy phép tại đúng commit đó** (theo tôi biết Bagisto
và Sylius là MIT, Saleor là BSD-3; phải xác nhận). Thêm vào bảng "Nguồn đã đọc".

- `bagisto/bagisto`
- `Sylius/Sylius`
- `saleor/saleor`
- `woocommerce/action-scheduler` (nếu cần)

Với Medusa đã clone, mở thêm sparse path: `packages/modules/product`, `packages/modules/inventory`,
`packages/modules/customer`, `packages/modules/event-bus-local`, `packages/modules/event-bus-redis`,
`packages/modules/workflow-engine-inmemory`, `packages/modules/providers/locking-postgres` (giữ đúng
commit `146c46b`).

Nguồn GPL (Vendure, WooCommerce, Action Scheduler): chỉ học thiết kế, không chép code.

## 5. Kết quả cần giao

1. **`docs/plans/ordering-reference.md`**
   - Chỉ còn phần nghiên cứu: các mục cũ đã gỡ giả định nhà hàng, cộng các mục mới ở mục 3.
   - 12 best practice cập nhật.
   - Cuối file thêm phụ lục **"Đã đọc"**: liệt kê từng file source / trang tài liệu đã mở trong vòng này
     (link), để người review kiểm được độ sâu.
2. **`docs/plans/ordering-core-contracts.md`**
   - Sửa đủ các lỗi A–J.
   - Thêm: outbox, contract scheduling, registry loại hàng theo dòng, `Sellable` mới, phân vai tính giá
     có thứ tự gọi, `PaymentProvider` mới, quyết định kiểu tiền, mô hình dữ liệu có relation và các cột
     số lượng trên dòng, chỗ cắm `InvoiceProvider`.
   - Cập nhật mapping Salanca (món ăn + voucher buffet `menu-package`, nhiều chi nhánh, SePay, tiền mặt,
     nhận tại quán).
   - "Câu hỏi còn mở" tách 2 nhóm: **cần chủ dự án quyết định**, và **cần kiểm bằng plugin trống**.
3. **Tin nhắn cuối:**
   - Các quyết định thiết kế đã đổi so với vòng 1, mỗi cái một dòng kèm lý do.
   - Những gì vẫn chưa kiểm được.
   - Các câu hỏi cần chủ dự án trả lời.

## 6. Quy tắc

- Như mục 7 của handoff vòng 1: chỉ sửa 2 file tài liệu ở mục 5; không sửa code, không tạo plugin,
  không đổi schema, không commit, không push, không stage; không đụng các thay đổi không liên quan
  trong working tree; không publish.
- Mọi khẳng định có link tới source (đúng commit) hoặc tài liệu chính thức. Không chắc thì ghi
  **Chưa kiểm**.
- Viết tiếng Việt, giữ thuật ngữ kỹ thuật và tên API bằng tiếng Anh. Câu ngắn; xuống dòng để file dễ đọc
  khi diff (không viết đoạn một dòng dài hàng trăm ký tự).

## 7. Bổ sung: nghiệp vụ còn thiếu

Phần này bổ sung sau khi review tổng thể. Làm cùng vòng này. Kết quả ghi vào 2 file ở mục 5, theo
cùng khuôn: nghiên cứu → reference; thiết kế → contracts. Mỗi mục có link source hoặc tài liệu chính
thức, ghi vào phụ lục "Đã đọc".

### 7.1 Phải khám phá ngay (ảnh hưởng tới lõi)

**1. Giá hoặc khả dụng đổi giữa lúc khách xem và lúc đặt**

Khách đang ở giỏ thì giá đổi hoặc hàng hết: báo lại, chặn, hay giữ giá cũ.

- Tham khảo: Vendure `ChangedPriceHandlingStrategy`
  (`packages/core/src/config/order/changed-price-handling-strategy.ts`), WooCommerce kiểm cart hash và
  `validate_order_before_payment` trong Store API.
- Kết quả: quy tắc trong `quote` / create order, mã lỗi trả cho client.

**2. Nhân viên tạo đơn hộ và gửi link thanh toán** (đơn qua điện thoại, Zalo)

- Tham khảo: Medusa draft order (`packages/core/core-flows/src/draft-order`), trạng thái `Draft` của
  Vendure, trang thanh toán đơn (`order-pay`) của WooCommerce.
- Kết quả: luồng đơn nháp do nhân viên tạo, ai được sửa giá tay (có audit), link thanh toán dùng
  `publicToken`.

**3. API cho phía khách (storefront)**

Web Next.js của Salanca và web của các khách sau dùng chung API này.

- Tham khảo: WooCommerce Store API (`plugins/woocommerce/src/StoreApi`), Medusa store API routes
  (`packages/medusa/src/api/store`, mở thêm sparse), cách Vendure trả lỗi có kiểu (`ErrorResult`) ở Shop
  API.
- Kết quả trong contracts:
  - Danh sách endpoint: config, quote, tạo đơn, tra cứu đơn, trạng thái thanh toán, huỷ.
  - Khuôn lỗi chuẩn có mã.
  - Cách web theo dõi tiền về (polling hay cách khác).
  - Quy tắc locale.

**4. Nâng cấp plugin khi đã cài cho nhiều khách**

- Kiểm Strapi 5 (docs chính thức và source trong `node_modules`): plugin đổi schema thì dữ liệu cũ ra
  sao; plugin có tự mang migration theo được không.
- Tham khảo: Medusa (mỗi module tự mang migration).
- Kết quả: chiến lược version, migration, changelog, quy tắc không phá dữ liệu khách đang chạy.

**5. Luật bảo vệ dữ liệu cá nhân Việt Nam**

Đơn lưu tên, SĐT, địa chỉ.

- Đọc từ văn bản chính thức: Nghị định 13/2023/NĐ-CP và luật mới về bảo vệ dữ liệu cá nhân nếu đã có
  hiệu lực (xác nhận số hiệu và ngày hiệu lực từ nguồn chính thức, không đoán).
- Kết quả: thời hạn lưu, quyền yêu cầu xoá / ẩn danh, đồng ý của khách lúc đặt, che dữ liệu trong log
  và trong `payment-event.rawPayload`.

**6. Phí cộng thêm**

Phí dịch vụ (nhà hàng thường thu 5%), phí đóng gói, tip.

- Tham khảo: cart condition của TastyIgniter (`ti-ext-cart/src/CartConditions`), `WC_Cart_Fees` của
  WooCommerce.
- Kết quả: kiểm pipeline giá trong contracts chứa được các loại phí này; phí tính trước hay sau giảm
  giá, có chịu VAT không.

### 7.2 Voucher và đặt lịch hẹn: đã chốt sẽ có, lõi không được chặn đường

**7. Bán voucher / thẻ quà tặng**

Ví dụ Salanca bán voucher buffet (`api::menu-package.menu-package`) online.

- Tham khảo: gift card của Saleor; `is_giftcard` và gift card của Medusa (kiểm phần nào thuộc
  Enterprise, không dùng phần đó).
- Trả lời:
  - Phát hành mã khi nào: lúc thanh toán xong hay lúc nhân viên xác nhận.
  - Mã ngẫu nhiên, chống đoán.
  - Hạn dùng; dùng một lần hay trừ dần số dư.
  - Ghi nhận đã dùng ở quầy (nhân viên quét hoặc nhập mã).
  - Hoàn tiền voucher chưa dùng.
  - Doanh thu ghi nhận lúc bán hay lúc dùng.
- Kết quả: loại hàng "voucher" trong registry loại hàng theo dòng, fulfillment kiểu "phát mã", bảng
  mã voucher và lịch sử dùng. Ghi rõ phần nào là lõi, phần nào là module.

**8. Dịch vụ đặt lịch hẹn**

- Tham khảo: các loại booking của Bagisto (default / appointment / event / rental / table).
- Trả lời:
  - Slot theo tài nguyên (nhân viên, phòng, bàn) và sức chứa.
  - Thời lượng dịch vụ, khoảng nghỉ giữa các lượt.
  - Đặt cọc (thanh toán một phần).
  - Chính sách huỷ / đổi lịch.
  - Giữ chỗ khi chờ thanh toán.
- Kết quả: contract scheduling ở mục 2-I phải đủ chung cho cả giờ nhận món lẫn lịch hẹn dịch vụ; dòng
  hàng có thể mang thông tin thời gian / tài nguyên; payment hỗ trợ thanh toán nhiều lần (cọc + phần
  còn lại).
- Lưu ý: đặt bàn hiện có của Salanca (`reservation-request`) vẫn là tính năng riêng của app. Chỉ ghi chú
  sau này có nên chuyển sang plugin không, không thiết kế việc chuyển.

### 7.3 Module tùy chọn: chỉ cần giữ đường lui

Với mỗi module dưới đây: ghi best practice ngắn từ nguồn tham khảo và **dữ liệu lõi cần lưu sẵn từ bây
giờ** để sau này thêm không phải migrate lớn. Không thiết kế đầy đủ.

| Module | Tham khảo |
| --- | --- |
| Báo cáo doanh thu (định nghĩa doanh thu, món bán chạy, theo chi nhánh / khung giờ) | Bảng thống kê riêng của WooCommerce Analytics (`wc_order_stats`, `wc_order_product_lookup`, tìm trong `plugins/woocommerce/src/Admin`) |
| Khuyến mãi đầy đủ (giảm tự động, freeship theo ngưỡng, mua X tặng Y, ngân sách) | Medusa promotion rule / campaign budget, Vendure condition / action |
| Phân đơn cho nhân viên, cảnh báo đơn chờ quá lâu | Assignee và `StatusWorkflowManager` của TastyIgniter |
| Chống đơn ảo (chặn SĐT, OTP cho đơn giá trị cao) | Ghi best practice; không cần nguồn lớn |
| Webhook ra hệ thống ngoài (POS, kế toán) | Webhook của Saleor |
| Tài khoản khách, tích điểm | Medusa customer / account holder |

### 7.4 Ngoài phạm vi

Ghi rõ trong contracts để không bị kéo vào: gói định kỳ (subscription), nhiều người bán (marketplace),
đa tiền tệ, in phiếu bếp.

### 7.5 Kết quả bổ sung vào mục 5

- Contracts thêm các mục:
  - Storefront API.
  - Đơn nháp do nhân viên tạo.
  - Xử lý đổi giá.
  - Phí cộng thêm.
  - Voucher.
  - Đặt lịch.
  - Chiến lược version / migration.
  - Dữ liệu cá nhân.
  - Bảng "module tùy chọn và dữ liệu cần lưu sẵn".
- Tin nhắn cuối liệt kê thêm: phần nào của voucher / đặt lịch làm thay đổi lõi so với bản trước.
