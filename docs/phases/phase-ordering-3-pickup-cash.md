# Phase O3 — Đặt hàng tự đến lấy, trả tiền mặt

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Kế hoạch thực hiện: [`plans/ordering-o3-pickup-cash.md`](../plans/ordering-o3-pickup-cash.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 9, 11, 14,
19.2, 19.3, 19.5, 19.6, 19.7).

## Goal

Khách đặt món qua API, tự đến lấy, trả tiền mặt khi nhận hoặc theo cấu hình; nhân viên nhận và xử lý đơn
trong Admin theo chi nhánh của mình, có báo đơn mới gần như tức thì; khách nhận email theo các bước công
khai. Đây là luồng chạy được đầu tiên từ đầu đến cuối (chưa có chuyển khoản).

## Điều kiện bắt đầu

- O1 và O2 đóng.

## Scope

- **Màn hình "Chi nhánh"** (content type `branch` từ O1, contracts 21.1; setting `LocationOrderingSettings`
  mục 19.6): thông tin chi nhánh, bật bán online, timezone, giờ mở (cho phép
  qua nửa đêm), giờ chốt ngày (mặc định 04:00), lead time "tối thiểu 3 giờ" (180 phút), `paymentTiming`,
  provider thanh toán, hạn thanh toán; sửa trong Admin với quyền `settings.manage`, có audit; đổi chỉ áp
  cho đơn mới.
- **SchedulingProvider cho tự lấy:** danh sách slot theo giờ chi nhánh, lead time lớn nhất giữa chi
  nhánh và line, sức chứa slot, hold slot có hạn.
- **3 workflow tự lấy có version** (mục 19.6): `prepay`, `accept-then-pay`, `pay-on-pickup`; bước có
  `isPublic` và `slaMinutes`. Ở O3 chỉ chạy được `pay-on-pickup` từ đầu đến cuối; hai workflow còn lại
  dừng ở bước chờ thanh toán cho tới O4.
- **API storefront** (mục 11): `GET /ordering/config`, `POST /ordering/quote`, `POST /ordering/orders`
  (`Idempotency-Key`, captcha Turnstile qua `CaptchaProvider`, rate limit theo IP), `GET
  /ordering/orders` + `/payment` + `POST /ordering/orders/cancel` bằng header `X-Order-Token`; link gửi
  khách dạng `#t=<token>`. Lỗi chuẩn: `PRICE_CHANGED`, `SELLABLE_UNAVAILABLE`, `SLOT_TOO_EARLY`,
  `LOCATION_UNAVAILABLE`, `MIXED_WORKFLOW_UNSUPPORTED`.
- **App Salanca:** thêm `X-Order-Token`, `Idempotency-Key` vào header CORS; bật ordering trên staging.
- **Admin xử lý đơn:**
  - Hộp đơn mới báo realtime (SSE, cùng cách hộp thư đặt bàn), có âm báo tùy chọn.
  - Danh sách lọc theo chi nhánh, trạng thái, ngày kinh doanh; chi tiết đơn với timeline.
  - Nút theo bước workflow: nhận, từ chối (bắt buộc lý do), chuẩn bị, sẵn sàng, **"Thu tiền và giao"**
    (ghi tiền mặt và chuyển bước trong cùng transaction), hủy.
  - Hoàn tiền mặt (provider `cash`) khi hủy sau khi đã thu.
- **Quyền và vai trò** (mục 19.2): đăng ký 14 action + 2 action catalog (contracts 19.2, 21.3, 21.5); Super Admin có hết; tài liệu
  hướng dẫn tạo 5 vai trò; màn hình gán nhân viên vào chi nhánh (`scope.manage`).
- **Thông báo** (`NotificationProvider` email qua SMTP hiện có): email nhân viên khi có đơn mới, email
  khách ở các bước `isPublic` (VI/EN theo locale lúc đặt); gửi từ outbox, có delivery log, không log địa
  chỉ người nhận.
- **Cảnh báo `order-awaiting-acceptance`** (đơn chờ nhận quá `slaMinutes`) gửi nhân viên/quản lý chi
  nhánh.

## Non-goals

- Chuyển khoản/SePay (O4), giao tận nơi (O5), chốt tiền mặt cuối ngày và báo cáo (O6), web (OW).

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3
node scripts/smoke-ordering-pickup.mjs   # mới: quote → tạo đơn → xử lý → giao, trên DB riêng
```

Test bắt buộc:

- Quote và tạo đơn tính lại giá ở server; client gửi `amount` bị bỏ qua; giá đổi giữa quote và tạo đơn
  trả `PRICE_CHANGED`.
- Slot sớm hơn lead time trả `SLOT_TOO_EARLY`; chi nhánh tắt bán online trả `LOCATION_UNAVAILABLE`.
- Gửi lại cùng `Idempotency-Key` không tạo đơn thứ hai; captcha sai bị từ chối; vượt rate limit trả 429.
- Token chỉ đọc được đơn của chính nó, token trong query/path không được chấp nhận.
- "Thu tiền và giao" lỗi giữa chừng thì không có tiền mà cũng không đổi bước.
- Nhân viên chi nhánh A không đọc/xử lý được đơn chi nhánh B qua mọi route Admin.
- Email gửi một lần cho mỗi bước dù dispatcher chạy lại.

### Manual UAT

- [ ] Đặt đơn bằng `curl`/Postman với slot hợp lệ; Admin hiện báo đơn mới trong vài giây.
- [ ] Nhận → chuẩn bị → sẵn sàng → "Thu tiền và giao"; đơn thành `completed`.
- [ ] Từ chối đơn có lý do; khách nhận email đúng ngôn ngữ (Mailpit).
- [ ] Hai nhân viên hai chi nhánh chỉ thấy đơn của mình; quản lý chuỗi thấy cả hai.
- [ ] Đổi lead time trong setting chỉ ảnh hưởng đơn mới.

## Bổ sung sau review (2026-10-10)

Theo contracts mục 21:

- Đường dẫn công khai trong tài liệu này là tương đối; với Salanca chúng nằm dưới `/api/v1` (contracts 21.7).
- `GET /branches` cho web chọn chi nhánh (21.1).
- Email tùy chọn, số điện thoại bắt buộc và chuẩn hóa số Việt Nam (21.2, 21.9).
- `POST /orders/lookup` bằng mã đơn + số điện thoại: chỉ xem trạng thái, captcha, rate limit, lỗi chung
  `ORDER_LOOKUP_FAILED` (21.2).
- `POST /orders` bắt buộc `consent` khớp phiên bản chính sách; thiếu thì `CONSENT_REQUIRED` (21.4).
- Khách chỉ tự hủy khi mọi group ở bước `customerCancellable` (21.9); ghi chú cả đơn (`customerNote`).
- **"Tạo đơn hộ"** trong Admin cho khách gọi điện, quyền `order.create`, trả khi lấy hàng, ghi đồng ý kênh
  `phone-staff` (21.3).
- **Hủy một phần món** sau khi đặt, quyền `order.edit-lines`, hoàn tiền mặt nếu đã thu (21.5).
- Bản dịch Admin VI/EN; route công khai mới ghi vào `docs/security-baseline.md` (21.8).
- Thay đổi chi nhánh, setting, scope ghi `admin-change-log` (21.6).
- V1 chạy 1 instance vì SSE và rate limit trong process (21.9).

Acceptance thêm:

- [ ] Đặt đơn không có email; tra cứu bằng mã + số điện thoại thấy trạng thái, không thấy tên/địa chỉ; sai
  số điện thoại 6 lần liên tiếp bị chặn.
- [ ] Nhân viên tạo đơn hộ cho khách gọi điện, đơn chạy tới "Thu tiền và giao".
- [ ] Hủy 1 món trong đơn đã thu tiền mặt → tổng và hoàn tiền đúng.

## Rollback

Tắt `ORDERING_ENABLED`; bỏ hai header CORS nếu cần. Đơn thử trên staging xóa được vì chưa có khách thật.

## Rủi ro

- SSE qua proxy/Cloudflare có thể bị buffer (đã gặp ở hộp thư đặt bàn): dùng lại cách cấu hình đã có,
  có polling dự phòng.
- Một process Strapi giữ SSE; nhiều instance cần pub/sub (đã hoãn ở hộp thư đặt bàn) — ghi rõ giới hạn.
