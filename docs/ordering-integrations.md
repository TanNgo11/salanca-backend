# Ordering integrations — webhook ra ngoài, OpenAPI, CSV catalog, mẫu email (O10)

Tài liệu cho hệ thống bên ngoài và người vận hành muốn tích hợp với plugin `ordering` mà không sửa
code. Bốn khối: **webhook sự kiện ra ngoài** (có ký HMAC, thử lại, tự tắt), **OpenAPI** cho toàn bộ
API, **nhập/xuất catalog CSV**, và **mẫu email sửa được trong Admin**.

Phạm vi: chỉ webhook *ra* (plugin → hệ ngoài). Webhook *vào* ngoài phạm vi O10. Anonymous/public API
vẫn deny-by-default; các route Admin đều chạy qua RBAC plugin.

## 1. Webhook sự kiện ra ngoài

### Đăng ký endpoint

Admin → **Bán hàng → Cấu hình → Webhook** (quyền `plugin::ordering.webhook.manage`), hoặc Admin API:

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/ordering/webhooks` | Danh sách endpoint + thống kê 24 giờ |
| POST | `/ordering/webhooks` | Tạo `{ url, description, events, includeCustomer }` → trả `secret` **một lần** |
| PUT | `/ordering/webhooks/:id` | Sửa URL/mô tả/sự kiện/includeCustomer |
| POST | `/ordering/webhooks/:id/rotate-secret` | Bí mật mới; bí mật cũ còn ký thêm 24 giờ |
| POST | `/ordering/webhooks/:id/active` | Bật/tắt `{ active }` — bật lại reset bộ đếm lỗi |
| POST | `/ordering/webhooks/:id/test` | Gửi `ordering.ping` đồng bộ, trả `{ ok, statusCode, durationMs }` |
| GET | `/ordering/webhooks/:id/deliveries?status=&page=` | Nhật ký gửi (tối đa 50/trang) |
| POST | `/ordering/webhook-deliveries/:id/resend` | Đưa một delivery lỗi về pending |
| GET | `/ordering/webhooks/events` | Danh mục sự kiện + mô tả VI/EN + payload mẫu |

`secret` có dạng `whsec_…`, hiện đúng **một lần** lúc tạo/xoay — hãy sao chép ngay. Bên server nó được
mã hóa bằng `ORDERING_ENCRYPTION_KEY`; list/get/response không bao giờ trả lại.

### Sự kiện

`GET /ordering/webhooks/events` trả danh mục công khai đầy đủ (sự kiện đơn hàng, giao hàng, thanh
toán, hoàn tiền, cảnh báo vận hành — `ops-alert.*`, khách hàng — `customer.erased` (O11), và
`ordering.ping` nội bộ cho "Gửi thử"). Endpoint chỉ nhận các loại đã tick trong `events`.

`customer.erased` phát khi một yêu cầu xóa hoàn tất — `data` chỉ mang `customerId` (documentId) và
`customerHash` (HMAC của SĐT), **không** tên/SĐT/email. `includeCustomer` không thêm gì vào sự kiện
này — sau xóa không còn PII để gửi.

### Payload

```json
{
  "id": 1234,
  "type": "order.created",
  "apiVersion": "2026-10",
  "occurredAt": "2026-10-13T01:20:18.000Z",
  "data": { "orderId": 42, "code": "A1B2C3", "locationRef": "Q1", "status": "awaiting-acceptance" }
}
```

- `id` = `webhook-delivery` id — một `(sự kiện × endpoint)` chỉ tạo một delivery; gửi lại tay tạo thêm
  **attempt**, không tạo delivery mới.
- `data` mặc định chỉ chứa id, mã đơn, chi nhánh, trạng thái, số tiền, mã phương thức — **không** tên,
  SĐT, email, địa chỉ. Bật `includeCustomer` (cần xác nhận trong UI, ghi change-log) mới có
  `data.customer { name, phone, email?, address? }`.

### Chữ ký

Mỗi request POST tới `url` có headers:

```
X-Ordering-Event: order.created
X-Ordering-Delivery: <deliveryId>
X-Ordering-Signature: t=<unix_seconds>,v1=<hex64>[,v1=<hex64>]
Content-Type: application/json
```

`v1` = hex HMAC-SHA256 của `"<t>.<raw body>"` với bí mật endpoint. Trong 24 giờ sau khi xoay có hai
`v1` (bí mật mới + cũ) — chấp nhận nếu **bất kỳ** `v1` nào khớp. Nên từ chối khi `t` lệch quá 5 phút.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody) {
  const t = /^t=(\d+)/.exec(header)?.[1];
  const sigs = [...header.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return sigs.some((sig) => timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}
```

PHP (lấy raw body bằng `file_get_contents('php://input')`, không `json_decode` trước khi ký):

```php
function verifyOrdering(string $secret, string $header, string $rawBody): bool {
  if (!preg_match('/t=(\d+)/', $header, $tm)) return false;
  preg_match_all('/v1=([0-9a-f]{64})/', $header, $sm);
  if (abs(time() - (int)$tm[1]) > 300) return false;
  $expected = hash_hmac('sha256', $tm[1] . '.' . $rawBody, $secret);
  foreach ($sm[1] as $sig) if (hash_equals($expected, $sig)) return true;
  return false;
}
```

### Thử lại và tự tắt

Lỗi mạng, timeout (10 giây mặc định) hoặc HTTP ≠ 2xx → thử lại theo lịch **1, 5, 15, 30 phút; 1, 2,
4, 8, 12, 24 giờ** (10 lần) rồi `failed`. Endpoint không theo redirect. **50 lỗi liên tiếp** → endpoint
tự tắt (`disabledReason: auto-failures`) + alert `webhook-endpoint-disabled` tới người có `ops.read`.
Nhật ký delivery giữ `attempts`, `nextAttemptAt`, `lastStatusCode`, `lastError` (≤ 300 ký tự, không
body phản hồi).

### Chống SSRF

Chỉ chấp nhận `https:` (`http:` chỉ khi `plugin::ordering.webhooks.allowHttp` — dành cho dev/test).
Trước khi gọi, plugin resolve DNS và từ chối mọi IP loopback/private/link-local/CGNAT/multicast
(IPv4 + IPv6, kể cả hostname trỏ về IP nội bộ); request gọi bằng IP đã kiểm (`lookup` ghim — chống DNS
rebinding). Ngoại lệ dev: `plugin::ordering.webhooks.allowHosts`. Log/nhật ký bỏ query string của URL.

## 2. OpenAPI

- `GET /api/v1/ordering/openapi.json` — tài liệu **public** (storefront), OpenAPI 3.1, cache 1 giờ.
- `docs/ordering-admin-openapi.json` — tài liệu **Admin API** đầy đủ, sinh bằng `pnpm run
  ordering:openapi`; `scripts/ordering/openapi.mjs` trong `check:ordering` bắt route thiếu mô tả.

## 3. Nhập/xuất catalog CSV

Admin → **Bán hàng → Món → Nhập/xuất menu** (hoặc "Xuất CSV" trên màn Danh mục). Quyền:
`catalog.manage` cho nhập; `catalog.manage` + `export` cho xuất.

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/ordering/catalog/export?kind=products\|modifiers` | CSV tải về (UTF-8 BOM, Excel VI mở đúng dấu) |
| POST | `/ordering/catalog/import?kind=&dryRun=true` | body `text/csv`/`application/octet-stream` ≤ 2 MB → `catalog-import` + báo cáo từng dòng |
| POST | `/ordering/catalog/import/:id/apply` | Áp lần nhập đã chạy thử — từ chối `CATALOG_IMPORT_STALE` nếu catalog đổi sau khi kiểm |
| GET | `/ordering/catalog/import` | Lịch sử nhập |

Quy ước: một dòng `products.csv` = **một biến thể** (món khớp theo slug VI, biến thể theo SKU, nhóm
tùy chọn theo mã trong `modifierCodes`). `modifiers.csv` mô tả nhóm + tùy chọn theo mã. Nhập **không
xóa** — chỉ tạo/sửa; ngừng bán dùng `sellOnline=false`. Ảnh giữ nguyên. Áp trong một transaction —
lỗi bất kỳ thì không ghi gì; change-log `catalog.import` ghi số tạo/sửa. Giới hạn 5000 dòng, báo cáo
giữ tối đa 500 lỗi, file payload xóa sau áp hoặc 24 giờ. Ô bắt đầu `=`, `+`, `-`, `@` được trung hòa
khi xuất (formula-injection guard).

Nhập **modifiers trước, products sau** — dòng món tham chiếu nhóm tùy chọn theo `code`.

## 4. Mẫu email trong Admin

Admin → **Bán hàng → Cài đặt bán hàng → Mẫu email** (quyền `settings.manage`): 16 mẫu × VI/EN, mỗi
mẫu sửa `subject` + `body`. Bảng liệt kê badge Mặc định/Đã sửa; sửa có xem trước bằng dữ liệu mẫu,
"Gửi thử tới tôi", "Khôi phục mặc định" (xóa override, ghi change-log `notification-template.save` /
`.reset`).

Cú pháp nội dung là **markdown giới hạn**: đoạn văn, `**đậm**`, danh sách `- `, link
`[nhãn](https://…)`. Biến `{{name}}` chỉ nhận danh sách cho phép của từng mẫu — `{{x}}` lạ → 400
`TEMPLATE_VARIABLE_UNKNOWN` (màn hình tô đỏ đúng biến). HTML/script trong dữ liệu được escape. Dòng
chỉ chứa một biến rỗng tự mất (dòng "Giờ lấy" biến mất khi đơn không có giờ lấy).

Biến chung cho mẫu đơn: `code`, `branch`, `total`, `items`, `customer` (chỉ mẫu nhân viên), `pickup`,
`delivery`, `ready`, `reason`, `note`, `link`, `footer`. Mẫu `staff.ops-alert`: `label`, `severity`,
`severityMark`, `count`, `firstSeen`, `lastSeen`, `branch`, `ref`, `action`. Mẫu O11: `customer.otp`
(`otp`, `minutes`) gửi mã đăng nhập; `customer.cart-reminder` (`branch`, `items`, `total`) nhắc giỏ
bỏ dở — chỉ gửi khi khách opt-in tiếp thị và chi nhánh bật `cartReminderEnabled`.

**Không chết mail:** override lỗi lúc render (vd mẫu cũ còn biến đã bị bỏ) → hệ thống dùng bản mặc
định, gửi mail bình thường, đồng thời mở alert `notification-template-broken` (người nhận `ops.read`,
escalate critical ở 10 lần trong 60 phút).

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/ordering/notification-templates` | Mọi mẫu × locale + cờ `customized` |
| GET | `/ordering/notification-templates/:code/:locale` | Source hiệu lực + `defaults` + `variables` |
| PUT | `/ordering/notification-templates/:code/:locale` | Lưu `{ subject, body }` (validate bằng render mẫu) |
| POST | `/ordering/notification-templates/:code/:locale/preview` | Render `{ subject?, body? }` trên dữ liệu mẫu |
| POST | `/ordering/notification-templates/:code/:locale/test` | Gửi tới email admin đang đăng nhập |
| DELETE | `/ordering/notification-templates/:code/:locale` | Xóa override, về mặc định |

## Quyền tóm tắt

| Quyền | Cho phép |
| --- | --- |
| `webhook.manage` | Mọi route `/ordering/webhooks*` + resend + đọc secret một lần |
| `catalog.manage` | Nhập CSV (`/catalog/import*`) |
| `export` (cùng `catalog.manage`) | Xuất CSV (`/catalog/export`) |
| `settings.manage` | Mẫu email (`/notification-templates*`) |
| `customer.read` (O11) | `GET /ordering/customers*` — danh bạ + chi tiết, đã che |
| `customer.manage` (O11) | `PUT /customers/:id`, `POST /customers/:id/reveal-phone`, `GET /customers/:id/export` |
| `customer.erase` (O11) | `GET|POST /ordering/data-requests`, `:id/process`, `:id/reject` |

Kiểm chứng tự động: `scripts/ordering/webhooks-out.mjs` (fanout, chữ ký, PII, lịch retry, timeout,
tự tắt, ping, resend, xoay), `webhooks-admin.mjs` (quyền/SSRF ở route), `openapi.mjs` (coverage +
3.1), `catalog-csv.mjs` (round-trip, stale, caps), `email-templates.mjs` (lưu/gửi thử/lỗi→mặc định+
alert/reset). Tất cả chạy trong `pnpm run check:ordering`.
