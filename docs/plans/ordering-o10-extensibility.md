# O10 — Nền mở rộng: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-10-extensibility.md`](../phases/phase-ordering-10-extensibility.md)

Đặc tả màn hình: [`ordering-o10-screens.md`](ordering-o10-screens.md) (X1–X4, reference U10). Mockup:
[`mockups/ordering-o10-extensibility.html`](mockups/ordering-o10-extensibility.html).

## Goal

Webhook ra ngoài có ký và thử lại, OpenAPI, nhập/xuất catalog CSV, mẫu email sửa trong Admin.

## Non-goals

- App store/OAuth, GraphQL, SDK, nhập ảnh, trình soạn email kéo thả, webhook vào.

## Current evidence

- Outbox (`services/outbox.ts`): `enqueue` trong transaction nghiệp vụ, `dispatch` claim `FOR UPDATE SKIP LOCKED` +
  lease, consumer đăng ký bằng `registry.registerOutboxConsumer(type, fn)`; backoff, `failed_at`, retry tay (O6).
  Loại sự kiện đang phát: `order.created`, `order.placed`, `order.confirmed`, `order.updated`, `order.transitioned`,
  `order.line.canceled`, `fulfillment-group.transitioned`, `payment.initiated`, `payment.captured`,
  `payment.event.received`, `refund.settled`, `hold.released`, `ops-alert.opened/escalated` (+ O7–O9 thêm
  `order.edited`, `rating.*`, `gift-card.issued`).
- Routes: `routes/index.ts` (`publicRoute`, `adminRoute(method, path, handler, action)`); input công khai parse bằng
  zod trong `domain/storefront/parse.ts`; `@strapi/utils` dùng zod 4 API (`.prefault`) — kiểm có `z.toJSONSchema`.
- CSV: `domain/csv.ts` (`buildCsv`, `escapeCsvCell`, BOM) — chỉ ghi, chưa đọc.
- Catalog: content type `catalog-category`, `catalog-product` (`productType`, `name/description/slug` custom field
  localized, `sellOnline`, `minQuantity`, `fulfillmentKinds`, `taxGroupRef`, `rank`, `metadata`), `catalog-variant`
  (SKU unique), `catalog-modifier-group`, `catalog-modifier`, `catalog-price`, `catalog-slug`; service
  `catalog-category`, `catalog-slug`; quyền `catalog.manage`.
- Email: `domain/notifications/templates.ts` (`TemplateCode` 14 mẫu + `staff.ops-alert`, `renderTemplate`,
  `renderOpsAlert`), `services/notification.ts` (`deliver` dedupe theo event/template/người nhận, ghi
  `notification-delivery`), provider `email-notification.ts`.
- Alert engine O6 (`services/alert.ts`, `alert-rules.ts`, `domain/alert-codes.ts`).

## Decisions and assumptions

- Decision: webhook ra ngoài là **một outbox consumer** (`webhooks.fanout`) cho mọi loại sự kiện có trong danh mục
  công khai; consumer chỉ ghi `webhook-delivery` (pending) cho từng endpoint đăng ký — việc gọi HTTP do job riêng
  `webhook-dispatcher` (không làm chậm consumer khác, không giữ lease outbox lâu).
- Decision: payload `{ id: deliveryId, type, apiVersion: '2026-10', occurredAt, data }`; `data` chỉ có id, mã đơn,
  chi nhánh, trạng thái, số tiền, mã phương thức — **không** tên/số điện thoại/email/địa chỉ, trừ khi endpoint bật
  `includeCustomer` (cần quyền `webhook.manage` + xác nhận trong UI; ghi change-log).
- Decision: ký `X-Ordering-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>`; header
  `X-Ordering-Event`, `X-Ordering-Delivery`; người nhận nên từ chối lệch > 5 phút. Bí mật 32 byte, hiện một lần, lưu
  mã hóa (`token-cipher`), xoay được (giữ bí mật cũ 24 giờ, ký cả hai `v1=…,v1=…`).
- Decision: thử lại khi lỗi mạng/timeout (10 giây)/HTTP ≠ 2xx: lịch 1, 5, 15, 30 phút, 1, 2, 4, 8, 12, 24 giờ (10 lần) rồi
  `failed`; 50 lần thất bại liên tiếp của một endpoint → tự tắt + alert `webhook-endpoint-disabled` (người nhận
  `ops.read`). Không theo redirect.
- Decision: chặn SSRF: chỉ `https:` (cho `http:` khi `config.webhooks.allowHttp` cho môi trường dev); resolve DNS
  trước khi gọi, từ chối IP loopback/private/link-local/CGNAT/multicast (IPv4 + IPv6), rồi gọi bằng `node:https`
  `request` với tùy chọn `lookup` trả đúng IP đã kiểm (giữ SNI/chứng chỉ theo hostname, không resolve lại — chống DNS
  rebinding); `config.webhooks.allowHosts` cho ngoại lệ dev.
- Decision: OpenAPI sinh từ bảng route + schema zod (`z.toJSONSchema` nếu có trong zod của `@strapi/utils`; không có
  thì viết schema tay trong `server/src/openapi/`), không thêm dependency. Công khai phục vụ
  `GET /api/v1/ordering/openapi.json`; Admin API ghi file `docs/ordering-admin-openapi.json` bằng script.
- Decision: CSV catalog: 2 file — `products.csv` (mỗi dòng một biến thể: category path, product slug VI, tên VI/EN,
  mô tả VI/EN, productType, sellOnline, rank, taxGroupRef, variant SKU, tên biến thể VI/EN, isDefault, giá, nhóm tùy
  chọn gắn — theo mã) và `modifiers.csv` (nhóm: mã, tên VI/EN, min/max chọn; tùy chọn: mã, tên, giá, rank). Khớp:
  biến thể theo SKU, món theo slug VI, nhóm theo mã. Không xóa khi nhập (chỉ tạo/sửa); muốn ngừng bán dùng cột
  `sellOnline=false`. Ảnh giữ nguyên.
- Decision: mẫu email lưu `notification-template` (code, locale, subject, body markdown giới hạn); render: thay
  `{{var}}` theo danh sách biến cho phép của từng mẫu, escape HTML, markdown giới hạn (đoạn, **đậm**, link https,
  danh sách) → HTML; không lặp/điều kiện. Thiếu/hỏng → mẫu mặc định trong code.
- Decision: quyền mới `webhook.manage`; nhập/xuất catalog dùng `catalog.manage` (+ `export` cho xuất); mẫu email dùng
  `settings.manage`.
- Assumption: Salanca chưa cần webhook ngay; O10 chủ yếu để plugin dùng chung. UAT bằng endpoint thử.

## Invariants

- Không gửi dữ liệu cá nhân qua webhook khi chưa bật `includeCustomer`.
- Một sự kiện × một endpoint = một `webhook-delivery`; gửi lại tay tạo `attempt` mới, không tạo delivery mới.
- Bí mật webhook không bao giờ trả lại sau lần tạo/xoay; không log URL query string (có thể chứa token).
- Nhập CSV: hoặc áp tất cả dòng hợp lệ của lần nhập, hoặc không áp gì; change-log ghi số dòng tạo/sửa.
- Mẫu email chỉ dùng biến cho phép; không thể chèn HTML/script từ dữ liệu khách.

## Data model

| Bảng | Field |
| --- | --- |
| `webhook-endpoint` | `url`, `description`, `events` JSON string[], `active`, `includeCustomer` bool, `secretSealed`, `previousSecretSealed?`, `previousSecretUntil?`, `consecutiveFailures` int, `disabledAt?`, `disabledReason?`, `createdBy` |
| `webhook-delivery` | `endpoint`, `eventId` (outbox id), `eventType`, `payload` JSON (đã lọc PII), `status` pending\|succeeded\|failed, `attempts`, `nextAttemptAt`, `lastStatusCode?`, `lastError?` (≤ 300, không body phản hồi), `lastDurationMs?`, `leaseUntil?`, `lockedBy?`, `succeededAt?`; unique (endpoint, eventId) |
| `notification-template` | `code`, `locale` (field tên `messageLocale` — `locale` bị i18n chiếm), `subject`, `body`, `updatedBy`; unique (code, messageLocale) |
| `catalog-import` | `kind` products\|modifiers, `fileName`, `rowCount`, `status` validated\|applied\|failed, `report` JSON (lỗi theo dòng, tối đa 500), `createdBy`, `appliedAt?` |

Migration `0008-o10-extensibility.ts` (đánh số sau O9 `0007`): unique index trên, index delivery
(status, next_attempt_at).

## API

| Method | Path | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/ordering/webhooks` | `webhook.manage` | endpoint + thống kê 24 giờ (thành công/lỗi) |
| POST | `/ordering/webhooks` | `webhook.manage` | tạo `{ url, description, events, includeCustomer }` → trả `secret` **một lần** |
| PUT | `/ordering/webhooks/:id` | `webhook.manage` | sửa (không sửa bí mật) |
| POST | `/ordering/webhooks/:id/rotate-secret` | `webhook.manage` | bí mật mới một lần; bí mật cũ còn 24 giờ |
| POST | `/ordering/webhooks/:id/active` | `webhook.manage` | bật/tắt (bật lại reset `consecutiveFailures`) |
| POST | `/ordering/webhooks/:id/test` | `webhook.manage` | gửi `ordering.ping` ngay, trả kết quả |
| GET | `/ordering/webhooks/:id/deliveries?status=&page=` | `webhook.manage` | nhật ký |
| POST | `/ordering/webhook-deliveries/:id/resend` | `webhook.manage` | đưa về pending ngay |
| GET | `/ordering/webhooks/events` | `webhook.manage` | danh mục sự kiện + mô tả + payload mẫu |
| GET | `/api/v1/ordering/openapi.json` | public | OpenAPI API công khai |
| GET | `/ordering/catalog/export?kind=products\|modifiers` | `catalog.manage` + `export` | CSV |
| POST | `/ordering/catalog/import?kind=&dryRun=true` | `catalog.manage` | body CSV (`text/csv`, ≤ 2 MB) → `catalog-import` + báo cáo |
| POST | `/ordering/catalog/import/:id/apply` | `catalog.manage` | áp lần nhập đã chạy thử (file lưu tạm trong `catalog-import.payload`, xóa sau áp/24 giờ) |
| GET | `/ordering/notification-templates` | `settings.manage` | danh sách mẫu × ngôn ngữ, cờ "đã sửa" |
| GET/PUT | `/ordering/notification-templates/:code/:locale` | `settings.manage` | xem (kèm mặc định + biến cho phép) / lưu |
| POST | `/ordering/notification-templates/:code/:locale/preview` | `settings.manage` | render với dữ liệu mẫu |
| POST | `/ordering/notification-templates/:code/:locale/test` | `settings.manage` | gửi tới email người đang đăng nhập |
| DELETE | `/ordering/notification-templates/:code/:locale` | `settings.manage` | khôi phục mặc định |

Mã lỗi mới: `WEBHOOK_URL_INVALID` 400 (`details.reason`: `scheme`\|`private-address`\|`unresolvable`),
`WEBHOOK_NOT_FOUND` 404, `CSV_INVALID` 400 (`details.line`), `CATALOG_IMPORT_NOT_FOUND` 404,
`CATALOG_IMPORT_STALE` 409 (catalog đổi sau khi chạy thử), `TEMPLATE_VARIABLE_UNKNOWN` 400 (`details.variables`),
`TEMPLATE_NOT_FOUND` 404.

## Implementation steps

1. **Danh mục sự kiện công khai + payload**
   - Files: `domain/webhooks/events.ts` (danh sách loại sự kiện công khai, mô tả VI/EN, hàm `publicPayload(event,
     { includeCustomer })` lọc field theo allowlist), unit test (không có key PII khi tắt).
   - Verification: `events.test.ts` cho từng loại sự kiện.
2. **Bảng, quyền, service endpoint**
   - Files: content type `webhook-endpoint`, `webhook-delivery`, migration `0008`, `register.ts` (`webhook.manage`),
     `domain/webhooks/url-guard.ts` (parse URL, resolve DNS `dns.promises.lookup({ all: true })`, kiểm từng IP theo
     dải cấm), `services/webhook-endpoint.ts` (tạo/sửa/xoay/bật tắt, change-log).
   - Verification: `url-guard.test.ts` (127.0.0.1, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7,
     fe80::/10, `localhost`, IP viết dạng thập phân `2130706433`, IPv4-mapped IPv6).
3. **Fanout + dispatcher**
   - Files: outbox consumer `webhooks.fanout` (đăng ký cho mọi loại công khai), `jobs/webhook-dispatcher.ts`
     (`ORDERING_JOBS`, mỗi 15 giây; claim `SKIP LOCKED` + lease như outbox; gọi `node:https`/`node:http` `request` với
     `lookup` ghim IP đã kiểm, timeout 10 giây, không theo redirect, đọc tối đa 4 KB phản hồi rồi bỏ; ghi kết quả; tính `nextAttemptAt`; đếm lỗi liên tiếp →
     tắt + alert `webhook-endpoint-disabled` thêm vào `alert-codes.ts`/`alert-rules.ts`).
   - Verification: `scripts/ordering/webhooks-out.mjs` (mới, server nhận thử trong cùng script trên cổng ngẫu nhiên +
     `allowHosts`): ký đúng (kiểm lại bằng HMAC), lịch thử lại (giả `now`), 2xx dừng, tự tắt sau 50 lỗi, không PII,
     2 process dispatcher (barrier) không gửi trùng, `ordering.ping` test, resend.
4. **Admin webhook (X1)**
   - Files: `controllers/webhooks.ts`, routes, `admin/src/pages/Webhooks/`, nhóm menu **Cấu hình**, `translations/o10.ts`.
   - Verification: script HTTP 403/404; bí mật chỉ trả lúc tạo/xoay.
5. **OpenAPI**
   - Files: `server/src/openapi/` (`build.ts` đi qua bảng route + schema → document 3.1), route
     `GET /api/v1/ordering/openapi.json` (public, cache 1 giờ), `scripts/ordering/openapi.mjs` (so mọi `publicRoute`/
     `adminRoute` có operation; kiểm cấu trúc 3.1 bằng kiểm tra tay các key bắt buộc — không thêm validator), script
     `pnpm run ordering:openapi` ghi `docs/ordering-admin-openapi.json`. `docs/ordering-api-contract.md` link tới spec.
   - Verification: `openapi.mjs` trong `check:ordering`; thêm route mới mà thiếu tài liệu → script fail.
6. **CSV đọc + nhập/xuất catalog**
   - Files: `domain/csv.ts` thêm `parseCsv` (RFC 4180: ngoặc kép, xuống dòng trong ô, BOM, CRLF/LF), test;
     `services/catalog-csv.ts`: `export(kind)`, `validate(kind, text)` (từng dòng: cột bắt buộc, kiểu, giá ≥ 0, SKU
     trùng trong file, slug trùng, nhóm tùy chọn tồn tại hoặc có trong `modifiers.csv` đã nhập trước) → `catalog-import`
     `validated` + `catalogVersion` (hash `updatedAt` max của catalog); `apply(id)`: kiểm `catalogVersion` không đổi
     (`CATALOG_IMPORT_STALE`), áp trong một transaction qua service catalog hiện có (giữ slug, Document Service
     middleware), change-log `catalog.import` (số tạo/sửa).
   - Verification: `parseCsv` test (Excel VI có BOM, ô có dấu phẩy/xuống dòng/ngoặc kép); `scripts/ordering/catalog-csv.mjs`
     (mới): xuất → nhập lại → không đổi (so JSON); 1 dòng lỗi → không áp; chạy thử không ghi; stale → 409; 5001 dòng → lỗi.
7. **Admin nhập/xuất (X3)**
   - Files: `admin/src/pages/CatalogImport/` (trong nhóm **Món**), nút "Xuất CSV" ở màn Danh mục.
   - Verification: script HTTP; UAT với Excel thật.
8. **Mẫu email**
   - Files: `domain/notifications/template-vars.ts` (biến cho phép theo mẫu, dữ liệu mẫu), `domain/notifications/
     render-custom.ts` (thay biến, escape, markdown giới hạn), content type `notification-template`,
     `services/notification-template.ts`, `notification.ts` dùng mẫu tùy biến nếu có (lỗi render → mặc định + alert
     `notification-template-broken`), Admin X4 trong **Cài đặt bán hàng**.
   - Verification: `render-custom.test.ts` (escape `<script>`, biến lạ, link `javascript:` bị bỏ);
     `scripts/ordering/email-templates.mjs` (lưu biến lạ → 400; mẫu tùy biến được dùng khi gửi; khôi phục mặc định).
9. **Tài liệu, gate**
   - Files: `docs/ordering-integrations.md` (mới: đăng ký webhook, kiểm chữ ký mẫu Node/PHP, danh mục sự kiện, OpenAPI,
     CSV mẫu), staff guide (nhập/xuất menu, sửa email), API contract, security baseline (SSRF, dữ liệu ra ngoài),
     screens "Đã đổi khi code", `run-all.mjs`, STATUS, Completion record.
   - Verification: gate đầy đủ, `check:ordering` 2 lượt.

## Data and rollback

- Migration `0008`: bảng mới. Rollback: tắt endpoint, xóa mẫu tùy biến; bảng giữ lại.

## Verification

- Automated: lint, typecheck, test, `check:ordering` 2 lượt, `check:phase3` tắt/bật, smoke, build tắt/bật.
- Manual UAT: theo spec.

## Documentation impact

- Spec/screens/mockup O10, reference U10, `docs/ordering-integrations.md` (mới), API contract, staff guide, security
  baseline, STATUS, roadmap.

## Risks and blockers

- SSRF và rò dữ liệu qua webhook — test url-guard đầy đủ; mặc định không PII.
- `z.toJSONSchema` không có trong bản zod hiện tại → viết schema tay cho route công khai (tốn thêm 1–2 ngày).

Ước lượng thô: 2–3 tuần (1–4: 6–7 ngày; 5: 2–3 ngày; 6–7: 4 ngày; 8: 3 ngày; 9: 1–2 ngày).

## Completion record

- Chưa bắt đầu.
