# Lộ trình module bán hàng (`ordering`)

Ngày lập: 2026-10-10. Thiết kế chi tiết ở `ordering-core-contracts.md`, nghiên cứu ở
`ordering-reference.md`. Ước lượng là thô, tính cho 1 dev có AI hỗ trợ, chỉ để xếp thứ tự.

## Tổng quan

| Mốc | Nội dung | Ước lượng thô |
| --- | --- | --- |
| 0 | Spike plugin trống: kiểm kỹ thuật | 3–5 ngày |
| 1 | Lõi + catalog + khách tự đến lấy (MVP Salanca) | 5–7 tuần |
| 2 | Giao tận nơi, quán tự giao | 1–2 tuần |
| 3 | Vận hành và chuẩn bị go-live | 1–2 tuần |
| Sau go-live | Bật từng module khi cần | theo module |

## Chia phase

Chủ dự án chốt cách làm (2026-10-10): roadmap trước, chia phase, **viết spec cho mọi phase trước**,
chủ dự án duyệt rồi mới code. Mỗi phase đóng được độc lập (test tự động + UAT tay), spec nằm ở
`docs/phases/phase-ordering-<số>-<tên>.md`, kế hoạch thực hiện chi tiết (nếu cần) ở `docs/plans/`.
Kết quả của phase trước có thể làm sửa spec phase sau; sửa spec trước khi code phase đó.
Mockup giao diện từng phase: [`mockups/index.html`](mockups/index.html). O0 đóng ngày 2026-10-10 (chủ dự án bỏ gate staging).

| Phase | Nội dung | Thuộc mốc | Ước lượng thô | Spec | Kế hoạch thực hiện |
| --- | --- | --- | --- | --- | --- |
| O0 | Spike plugin trống | 0 | 3–5 ngày | [phase-ordering-0-spike](../phases/phase-ordering-0-spike.md) (**đóng**) | [ordering-spike](ordering-spike.md) |
| O1 | Lõi đơn hàng: dữ liệu, tiền, pipeline giá, workflow, outbox, khóa job, idempotency, timeline, scope chi nhánh ở service | 1 | 1,5–2 tuần | [phase-ordering-1-core](../phases/phase-ordering-1-core.md) | [ordering-o1-core](ordering-o1-core.md) |
| O2 | Module catalog: content type, custom field, "tạm hết", khung giờ bán, adapter mặc định, API đọc catalog | 1 | 1–1,5 tuần | [phase-ordering-2-catalog](../phases/phase-ordering-2-catalog.md) | [ordering-o2-catalog](ordering-o2-catalog.md) |
| O3 | Đặt hàng tự lấy + tiền mặt: setting chi nhánh, quote, tạo/tra cứu đơn, 3 workflow tự lấy, Admin xử lý đơn, "Thu tiền và giao", gán nhân viên, email | 1 | 1,5–2 tuần | [phase-ordering-3-pickup-cash](../phases/phase-ordering-3-pickup-cash.md) | [ordering-o3-pickup-cash](ordering-o3-pickup-cash.md) |
| O4 | SePay: QR, webhook, tự khớp, duyệt chuyển khoản, ghi tay, đối soát | 1 | 1 tuần | [phase-ordering-4-sepay](../phases/phase-ordering-4-sepay.md) | [ordering-o4-sepay](ordering-o4-sepay.md) |
| O5 | Giao tận nơi (quán tự giao) | 2 | 1–2 tuần | [phase-ordering-5-delivery](../phases/phase-ordering-5-delivery.md) | [ordering-o5-delivery](ordering-o5-delivery.md) |
| O6 | Vận hành và go-live: trang tình trạng, đủ cảnh báo, báo cáo, chốt tiền mặt, CSV, xóa dữ liệu theo hạn, Cloudflare, runbook | 3 | 1–2 tuần | [phase-ordering-6-ops-golive](../phases/phase-ordering-6-ops-golive.md) | [ordering-o6-ops-golive](ordering-o6-ops-golive.md) |
| OW | Web đặt món (repo web, cần duyệt phase frontend riêng); làm song song khi API của O2–O3 ổn | 1 | theo repo web | [phase-ordering-w-web](../phases/phase-ordering-w-web.md) | trong repo web |

Thứ tự: O0 → O1 → O2 → O3 → O4 → O5 → O6. Kết quả spike (O0) có thể đổi phạm vi các phase sau; khi
đó sửa bảng này trước khi viết spec phase kế tiếp.

## Trước khi bắt đầu viết code

- Mở phase chính thức theo `AGENTS.md`: spec ở `docs/phases/`, kế hoạch thực hiện theo `PLANS.md`,
  cập nhật `docs/STATUS.md`, `docs/product-context.md` và roadmap. Hiện `AGENTS.md` còn ghi payment và
  booking-engine là "deferred", nên phải có quyết định mở phase trước.
- Phần giao diện web (menu, giỏ, checkout) là tích hợp frontend, cần phase được duyệt riêng.

## Mốc 0. Spike plugin trống

**Mục tiêu:** chứng minh Strapi 5.51.1 làm được các việc lõi cần, trước khi viết nghiệp vụ.

Kiểm 19 mục ở contracts mục 17 "Cần kiểm bằng plugin trống", gồm:

- local plugin TypeScript build được, `resolve` + `default`/`validator` chạy đúng, thứ tự
  register/bootstrap;
- `strapi.db.transaction`, `FOR UPDATE`, sequence PostgreSQL, relation giữa các bảng plugin;
- Document Service middleware và việc gọi thẳng `strapi.db.query`, ẩn khỏi Content Manager;
- permission của plugin và condition theo chi nhánh (async, không mở quyền khi lỗi);
- cron + claim `SKIP LOCKED` khi chạy 2 process;
- đọc body gốc cho webhook (`includeUnparsed`), CORS cho `X-Order-Token` và `Idempotency-Key`;
- `businessDate` qua nửa đêm khi server chạy UTC;
- custom field của plugin trong Content Manager (chữ đa ngôn ngữ, nhóm tùy chọn, combo), catalog không
  bật i18n, app thêm field qua extension;
- deploy lên Dokploy.

**Xong khi:** có báo cáo spike, mỗi mục đạt hoặc có cách thay thế. Code spike có thể bỏ hoặc giữ làm
khung.

## Mốc 1. Lõi + khách tự đến lấy

**Mục tiêu:** khách đặt món online, tự đến lấy, trả bằng chuyển khoản SePay hoặc tiền mặt; nhân viên
xử lý đơn trong Admin theo chi nhánh.

Chia thành các lát, mỗi lát demo được:

1. **Lõi dữ liệu:** content type `plugin::ordering.*` (order, line, group, fulfillment, adjustment,
   payment, payment-event, refund, timeline, outbox, idempotency, hold, job lock, staff scope, alert),
   tiền VND số nguyên, pipeline giá (chưa khuyến mãi, thuế tắt), workflow engine + 3 workflow tự lấy
   theo `paymentTiming`, outbox dispatcher. Chỉ có test, chưa có UI.
2. **Module catalog của plugin** (contracts mục 20): danh mục dạng cây, sản phẩm, biến thể, bảng giá,
   thư viện tùy chọn cộng thêm có ghi đè theo món, combo có nhóm chọn, khung giờ bán, "tạm hết" theo chi
   nhánh; chữ đa ngôn ngữ trong custom field; nhân viên sửa bằng Content Manager. API đọc catalog cho
   storefront. Plugin là generic như WooCommerce; Salanca
   chỉ là một trường hợp dùng.
3. **Setting chi nhánh và báo giá:** timezone, giờ mở, lead time "tối thiểu 3 giờ", trả trước/sau.
   API `GET /ordering/config` và `POST /ordering/quote`.
4. **Tạo và tra cứu đơn:** `POST /ordering/orders` với captcha Turnstile, rate limit, `Idempotency-Key`;
   tra cứu bằng `X-Order-Token`, link `#t=`; khách hủy khi còn cho phép.
5. **Admin xử lý đơn:** hộp đơn mới có báo realtime (dùng lại cách làm của hộp thư đặt bàn), chi tiết
   đơn, chuyển bước, "Thu tiền và giao", lọc theo chi nhánh, 14 permission + 2 quyền catalog, màn gán nhân viên vào chi
   nhánh.
6. **SePay:** QR VietQR + memo, webhook (HMAC trên body gốc, chống trùng), tự khớp, màn "Duyệt chuyển
   khoản", ghi nhận chuyển khoản thủ công, job đối soát `GET /v2/transactions`.
7. **Thông báo:** email cho nhân viên khi có đơn mới, email cho khách theo các bước công khai, qua SMTP
   hiện có.
8. **Nhập sản phẩm Salanca:** khách tự nhập món bán online vào catalog plugin. `menu-item`,
   `menu-category`, `menu-package` và seed bundle giữ nguyên làm content (contracts mục 20.5).
9. **Web (cần phase frontend được duyệt):** trang đặt món đọc catalog plugin → giỏ → checkout → trang
   trạng thái đơn.

**Xong khi:** test tự động đạt, UAT tay trên staging với 1 giao dịch SePay thật số tiền nhỏ, thử đủ 3
kiểu trả tiền, fixture 2 chi nhánh.

## Mốc 2. Giao tận nơi (quán tự giao)

- Vùng giao theo xã/phường, bảng phí theo giá trị đơn, đơn tối thiểu, thời gian giao cộng thêm.
- Nhập địa chỉ 2 cấp (tỉnh/thành, xã/phường) theo danh mục hành chính từ 01/07/2025.
- Workflow giao: sẵn sàng → đang giao (gán người giao) → đã giao / giao thất bại; người giao thu tiền
  mặt.

**Xong khi:** đặt và giao thử được trong vùng; địa chỉ ngoài vùng bị từ chối đúng.

## Mốc 3. Vận hành và chuẩn bị go-live

- Trang "Tình trạng vận hành", đủ các rule cảnh báo ở contracts mục 12.
- Báo cáo theo ngày kinh doanh, chốt tiền mặt cuối ngày, xuất CSV đơn.
- Job xóa field cá nhân trong raw payload theo thời hạn đã chốt.
- Cloudflare: route webhook không bị cache/WAF chặn; backup; runbook cho nhân viên và kỹ thuật.

**Cổng go-live** (cần người khác xác nhận, xem contracts mục 19.9):

- Tài khoản SePay thật: số tài khoản, API key, webhook secret.
- Kế toán: đơn online có bắt buộc xuất hóa đơn điện tử không; giá đã gồm VAT chưa.
- Pháp lý: thời hạn lưu dữ liệu; nội dung đồng ý xử lý dữ liệu cá nhân ở trang checkout.

## Sau go-live: bật khi cần

| Module | Ghi chú |
| --- | --- |
| Tồn kho đếm số lượng | module `inventory`: tồn theo chi nhánh, giữ hàng, sổ biến động, cảnh báo sắp hết |
| VAT và hóa đơn điện tử | khi kế toán chốt; `TaxConfig` + `InvoiceProvider` (VNPT, Viettel, MISA...) |
| Voucher buffet (`menu-package`) | kế toán chốt cách ghi doanh thu |
| Đặt lịch hẹn | dùng `SchedulingProvider`, cọc tùy chọn |
| Tích hợp hãng giao | GHN, Ahamove, Grab Express qua `FulfillmentProvider` |
| Cổng VNPAY, MoMo | `PaymentProvider` mới, không đổi lõi |
| Khuyến mãi, mã giảm giá | dùng `order-adjustment` đã có |
| Tài khoản khách, tích điểm | dùng `customerRef` đã có |
| Ca bán hàng đầy đủ | kiểu Odoo POS session |
| Tách repo/npm | khi có khách thứ hai |

## Thông tin còn thiếu

Trước khi viết spec Mốc 1 (đã có mặc định, chủ dự án chỉ cần xác nhận hoặc sửa):

- Món nào có tùy chọn (size, topping, mức cay)? Catalog plugin hỗ trợ sẵn; chỉ cần danh sách để nhập.
  **Mặc định:** chưa có tùy chọn, chỉ có ghi chú cho từng món.
- Món nào bán online và giá bán online: khách tự nhập vào catalog plugin.

Trước Mốc 2: danh sách xã/phường quán giao, bảng phí, đơn tối thiểu.

Trước go-live: các mục ở "Cổng go-live" của Mốc 3, cùng nội dung email gửi khách.
