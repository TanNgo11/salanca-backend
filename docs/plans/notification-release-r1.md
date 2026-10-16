# Thông báo cho release Salanca (R0 và R1): kế hoạch thực hiện

Status: Draft (chờ chủ dự án duyệt mục "Quyết định cần chốt")
Owner: tan_ngo (duyệt + chốt quyết định), AI thực hiện
Last updated: 2026-10-15
Related: [`notification-core-overview.html`](notification-core-overview.html) (bức tranh lớn, mục 0 và 12), [`ordering-decisions-2026-10-13.md`](ordering-decisions-2026-10-13.md) (O13: provider, Zalo ZNS, eSMS, dailyLimit), [`../resend-email-operations.md`](../resend-email-operations.md), [`../admin-roles.md`](../admin-roles.md), [`ordering-o13-handoff.md`](ordering-o13-handoff.md) (các điều đã chứng minh về repo, đọc mục "Những điều đã chứng minh" trước khi code).

Nhánh: `feat/ordering-notify-release`, tách từ `feat/ordering` tại `de77da5`, worktree `D:\outsource\salanca\salanca-notify`. Gộp về `feat/ordering` khi gate xong, **không** vào `main`. DB test riêng `salanca_ordering_notify`. Gate gọn theo quy ước hiện tại: lint, typecheck, `typecheck:admin`, vitest và các script liên quan, **không** chạy `check:ordering` đầy đủ, `check:phase3` hay smoke. **Không commit khi chủ dự án chưa nói.** Bảng gợi ý commit ở cuối.

## Ghi chú cho AI thực hiện (đọc trước)

- Làm đúng từng bước theo thứ tự. Mỗi bước xong thì chạy phần "Verification" của bước đó rồi mới sang bước sau.
- Chạy `git status --short` trước khi sửa. Cây làm việc này sạch trừ file HTML plan. Không đụng file ngoài phạm vi từng bước.
- Gặp chỗ plan mâu thuẫn với code: dừng, ghi vào "Điều lệch kế hoạch" ở cuối file, hỏi chủ dự án nếu nó đổi phạm vi, bảo mật hoặc dữ liệu. Không tự đoán.
- Mọi chuỗi hiển thị trong Admin là tiếng Việt (có bản en). Không ghi địa chỉ email, số điện thoại hay token vào log, vào bảng hay vào response.
- Plugin `src/plugins/ordering` **không được import code app Salanca** (`src/domain`, `src/api`...). Phần thông báo form liên hệ và đặt bàn (`src/domain/notification-settings`, `form-intake`) là hệ khác, **ngoài phạm vi** tài liệu này.
- Lệnh trong tài liệu viết cho PowerShell. Biến môi trường: `$env:ORDERING_TEST_DATABASE = 'salanca_ordering_notify'`.

## Goal

Salanca ra mắt với thông báo **email** chạy được, nhìn được và an toàn:

1. Biết chắc hiện trạng thật (R0), không dựa vào tìm kiếm trong code.
2. Hạn mức ngày của kênh tính phí tính theo **giờ Việt Nam** và đổi được bằng cấu hình (R1e).
3. Môi trường thử không gửi tin cho người lạ, kể cả qua kênh Zalo và SMS (R1a).
4. Owner mở Admin thấy mỗi lần gửi đã đi đâu, lỗi vì sao, và thấy cảnh báo khi chi nhánh chưa có email nhận đơn (R1b).
5. Có checklist UAT (R1c) và checklist đưa email vào hộp thư chính (R1d).

Khi release chỉ bật email. Zalo ZNS và SMS giữ tắt (`enabled = false`) cho tới khi có OA, mẫu duyệt và UAT sandbox (R4, ngoài tài liệu này).

## Non-goals

- Thêm adapter mới (Messenger, Telegram, webhook), mở danh sách kênh động, cấu hình khóa kênh trong Admin (R2).
- Người nhận nhân viên đa kênh, nhiều người theo vai trò (R3). Release dùng `branch.email`, nhập ở Admin → Chi nhánh. Muốn nhiều người nhận thì dùng địa chỉ nhóm.
- Bật Zalo ZNS thật (R4). Tách `notification-core`, cắm BDS, in-app cho khách (R5).
- Nút "Gửi lại" trong Lịch sử gửi (xem "Quyết định cần chốt" D3). Alert mới "gửi lỗi". Xuất CSV nhật ký. Job xóa nhật ký cũ.
- Đổi hành vi thông báo hiện có khi không bật tính năng mới (mặc định `mode = live`, múi giờ mặc định Việt Nam).
- Thông báo form liên hệ, đặt bàn (`src/domain/notification-settings`) và guard `EMAIL_ALLOW_EXTERNAL_DELIVERY` của chúng.

## Current evidence (đã đọc code ngày 2026-10-15)

Số dòng là gần đúng ở `de77da5`; tìm theo tên hàm nếu lệch.

**Gửi và nhật ký** (`src/plugins/ordering/server/src/services/notification.ts`)
- `deliver()` (l.158-303): với mỗi kênh trong chuỗi, lấy giá trị người nhận (`channelValue`, l.97), kiểm `blockedReason` (l.106), ghi/đọc dòng `notification-delivery`, gọi `registry().notificationProvider(channel).send` (l.266). Dòng có trạng thái `pending|sent|failed|skipped`.
- Kênh **không có địa chỉ** cho người nhận thì `continue` **không ghi dòng nào** (l.199). Hệ quả: khách chỉ có SĐT mà chuỗi mặc định là `['email']` thì **không gửi gì và không để lại dấu vết**.
- Nhân viên nhận "đơn mới" chỉ khi `branch.email` có giá trị (`onOrderPlaced`, l.357). Chi nhánh chưa nhập email thì **không có mail và không có dấu vết**.
- `PAID_CHANNELS = {zalo, sms}` (l.53). Ngày của hạn mức: `utcDayStart()` (l.55-59), dùng làm khóa chống trùng alert `notification-daily-limit` (l.186).
- Địa chỉ không bao giờ vào bảng: chỉ có `recipientHash = sha256(channel:value)`.

**Hạn mức ngày** (`services/notification-channel.ts`)
- `paidSentToday()` (l.~120) tính từ `setUTCHours(0,0,0,0)`. `reservePaidSend()` (l.~133) khóa theo `new Date().toISOString().slice(0,10)` (ngày UTC) và lưu bộ đếm trong plugin store `paid-daily-usage` dưới advisory lock `ordering-paid-daily`. Kết quả: bộ đếm reset lúc 07:00 giờ Việt Nam.
- `NOTIFICATION_CHANNELS = ['zalo','sms','email']` (l.19), `overview()` (l.~165) trả `providers`, `dailyLimit`, `sentToday`, `rules`.

**Cấu hình**
- `server/src/config/index.ts`: schema `notifications` (l.139-148: `email.enabled`, `orderLinkTemplate`, `dailyLimit`, `costEstimates`), mặc định (l.361-366).
- `config/plugins.ts` (host, l.280-296): `email.enabled = isTransactionalEmailConfigured(env)`, `ORDERING_NOTIFY_DAILY_LIMIT`, `ORDERING_NOTIFY_COST_ESTIMATES`.
- `config/transactional-email.helper.ts` (l.87-108): ngoài production, host SMTP không phải loopback thì **bắt buộc** `EMAIL_ALLOW_EXTERNAL_DELIVERY=true`, nếu không throw. Đây đã là một guard ở tầng vận chuyển cho email. Guard này **không** bảo vệ Zalo/SMS và không lọc theo người nhận.

**Registry** (`services/registry.ts` l.108-126): `registerNotificationProvider`, `notificationProvider`, `hasNotificationProvider`, `notificationChannels`.
**Nơi gọi trực tiếp provider** (6 chỗ): `notification.ts:266`, `notification-channel.ts:310` (gửi thử kênh), `notification-template.ts:220` (gửi thử template staff), `customer-auth.ts:197` (OTP), `cart.ts:980` (nhắc giỏ), `loyalty-lifecycle.ts:106` (nhắc điểm hết hạn).

**Nhật ký gửi**: content type `notification-delivery` (`content-types/notification-delivery/schema.ts`), bảng `plugins_ordering_notification_delivery`, unique `(event_id, template, recipient_hash)` (migration 0003), cột `provider_message_id` và `cost_estimate` (migration 0012). Cột thời gian Strapi (`created_at`). **Không có route hay màn Admin nào đọc bảng này.** Không tìm thấy job xóa dòng cũ.

**Mẫu để nhân bản**: màn "Lịch sử thay đổi" (O15):
- Server: `services/audit-log.ts` (bộ lọc, phạm vi chi nhánh, phân trang 50, ngày theo `+07:00`), `controllers/audit-log.ts`, routes `routes/index.ts` l.398-401, OpenAPI `openapi/operations.ts` l.843-847.
- Quyền: `register.ts` `adminActions` (l.~100-140), `scripts/ordering/_harness.mjs` `ORDERING_ACTIONS` (l.381), admin `lib/permissions.ts`.
- Admin: `admin/src/pages/AuditLog/index.tsx` (446 dòng), đăng ký trong `pages/App.tsx` (lazy import l.51, khóa hiển thị l.87, nav l.195-205, RBAC l.249-293, route l.384), chuỗi `translations/o15.ts` nối ở `lib/i18n.ts` l.74 và `admin/src/index.ts` l.78, thư mục trang nằm trong `O3_DIRS` của `translations/o3.test.ts` l.22.
- Kiểm: `scripts/ordering/audit-log.mjs` (`withApp`, `seedBranches`, `seedAdminHttpStaff`, gọi HTTP bằng Bearer), danh sách trong `scripts/ordering/run-all.mjs`.

## Decisions and assumptions

Đã chốt (chủ dự án, 2026-10-15):
- Release trước cho Salanca, Việt Nam trước, đổi được sau. Hạn mức ngày theo giờ Việt Nam, cấu hình bằng `notifications.timezone` (tên IANA, mặc định `Asia/Ho_Chi_Minh`).
- Người nhận đơn mới ở release là email chi nhánh nhập ở Admin → Chi nhánh. Nhiều người nhận thì dùng địa chỉ nhóm.
- Messenger và Telegram để sau (R2). Zalo ZNS qua OA (O13), chỉ bật sau UAT sandbox.
- Mọi kênh về lâu dài là adapter có cấu hình trong Admin (R2, không làm ở đây).

Giả định cần kiểm ở R0 (kết quả ghi vào báo cáo R0):
- A1: chưa có màn nào xem nhật ký gửi.
- A2: khách chỉ có SĐT không nhận được gì và không có dòng log.
- A3: chi nhánh không có email thì không có mail nhân viên và không có dấu vết.
- A4: `reservePaidSend` reset theo UTC.
- A5: email `skipped` với lý do `email-disabled` khi chưa cấu hình SMTP.

**Quyết định cần chốt (chặn bước tương ứng):**
- **D1 (bước 2, R1a):** mặc định `ORDERING_NOTIFY_MODE`. Đề xuất `live` (không đổi hành vi). Staging tự đặt `allowlist` theo runbook. Lý do không mặc định `allowlist`: staging thường chạy `NODE_ENV=production` nên mặc định theo môi trường không bắt được staging, và mặc định `allowlist` ở dev làm hỏng cách thử bằng Mailpit hiện có.
- **D2 (bước 3, R1b):** Admin Salanca có đủ chi nhánh nhập email ngay trước release? Nếu không, banner "thiếu email" sẽ hiện thường trực. Đây là mục đích của banner.
- **D3 (bước 3, R1b):** có làm nút "Gửi lại" không. Đề xuất **không** ở release: gửi lỗi đã được outbox thử lại tự động. Nút "Gửi lại" cần phát lại đúng handler của đúng sự kiện chứ không phát lại toàn bộ consumer (sẽ chạy lại cả consumer tích điểm, thống kê khách). Làm sau nếu thật sự cần.
- **D4 (bước 3):** người xem chi tiết lỗi kỹ thuật (`lastError`, `providerMessageId`, `costEstimate`) cần quyền riêng `notification-log.details` (route `/technical`). Đề xuất chỉ Super Admin có sẵn, `Quản lý` không có.

## Invariants

- Không ghi địa chỉ nhận vào log, bảng, response hay file kiểm. Màn Lịch sử gửi **không** hiển thị người nhận cụ thể (bảng chỉ lưu hash) mà hiển thị **vai trò người nhận và kênh**. Đây là chủ ý, khác mockup mục 9.3 của file HTML (mockup có địa chỉ che bớt, không thực hiện được với dữ liệu hiện có).
- Route mới dùng `adminRoute(method, path, handler, ...actions)` (các quyền là tham số rời, không phải mảng), có policy admin và quyền rõ ràng, khai trong `openapi/operations.ts`.
- Phạm vi chi nhánh: nhân viên không `allLocations` chỉ thấy dòng thuộc đơn của chi nhánh mình. Dòng không có đơn (alert) chỉ `allLocations` thấy. Giống O15.
- Mặc định mọi thứ mới **không đổi hành vi hiện có** (`mode = live`, múi giờ Việt Nam). Riêng hạn mức ngày đổi từ UTC sang giờ Việt Nam là thay đổi hành vi có chủ ý đã được chủ dự án chốt.
- Thông báo không bao giờ chặn luồng đặt món (chạy sau commit qua outbox). Giữ nguyên.
- Provider Zalo và SMS vẫn chỉ đăng ký khi đủ env; không đổi.
- Không thêm dependency npm. Không dùng SQLite. Không chạy `export:cms-seed`.
- Nếu thêm quyền: bootstrap chỉ cấp cho Super Admin, plugin không tự tạo role, role khác mặc định bị từ chối.

## Gotchas của repo (đã chứng minh, không đọc lại để cãi)

Lấy từ `ordering-o13-handoff.md`, chỉ những điều liên quan:

- `pnpm run typecheck` ở root **không** kiểm server và admin của plugin: lỗi server chỉ hiện ở `pnpm run build:ordering`, lỗi admin ở `pnpm run typecheck:admin`. Luôn chạy cả ba.
- Script `scripts/ordering/*.mjs` chạy trên bản **đã build** (`src/plugins/ordering/dist/...`): luôn `pnpm run build:ordering` trước khi chạy script.
- Đổi content type thì `build:ordering` **trước**, rồi `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`. Tài liệu này không đổi content type nên thường không cần.
- Route mới phải khai trong `server/src/openapi/operations.ts`, không thì `openapi.mjs` đỏ. Sau khi khai chạy `pnpm run ordering:openapi` để cập nhật `docs/ordering-admin-openapi.json`.
- `change-log.record` mới cần mã trong `domain/audit/actions.ts` (`actions.test.ts` quét source). Tài liệu này không ghi change-log.
- Admin (design-system 2.2.3): **không có `Dialog.Title`** (tiêu đề đặt trong `<Dialog.Header>`); `NumberInput` dùng `min`/`max`; `Table` cần `rowCount`; `Alert` cần children; trong `Modal` không dùng dropdown, `SingleSelect` ngoài Modal thì được; không có ESLint plugin `react-hooks`; code admin **không import `server/**`**, logic dùng chung đặt ở `src/plugins/ordering/shared/`.
- Chuỗi admin: mỗi phase có file `translations/<tên>.ts` dạng `Record<string, [vi, en]>`, nối vào `lib/i18n.ts` và `admin/src/index.ts`; thư mục trang mới phải thêm vào `O3_DIRS` trong `translations/o3.test.ts`, test này quét chuỗi chưa dịch.
- knex/`db.raw` có thể trả JSON dạng chuỗi; parse khi đọc.
- `fetch().text()` bỏ BOM; kiểm bằng `arrayBuffer` nếu cần.
- Field tên `locale` bị Strapi i18n dành.

## Invariants kiểm tra chéo

Sau mỗi bước chạy: `git status --short` (chỉ file của bước) và `git diff --check`.

## Implementation steps

### Bước 0. R0: xác nhận hiện trạng bằng thao tác thật

Không sửa code sản phẩm. Kết quả là **báo cáo** `artifacts/notification-release/r0-report.md` (tạo thư mục nếu chưa có; thư mục `artifacts/` không được commit).

**Đã xác nhận bằng đọc code khi soạn spec (2026-10-15):** V1 (không có route, controller hay trang Admin nào nhắc `notification-delivery`: `rg -l "notification-delivery"` trên `admin/`, `routes/`, `controllers/` rỗng), V2 (`deliver` l.199 `continue` không ghi dòng), V3 (`onOrderPlaced` l.357 chỉ gửi khi `branch.email`), V4 (`reservePaidSend` dùng `toISOString().slice(0,10)` và `paidSentToday` dùng `setUTCHours`), V6 (guard SMTP có ở `transactional-email.helper.ts` l.100), V7 và V8 (đã đọc cả 6 nơi gọi provider, kết quả ở bước 2). **Còn phải chạy thật:** baseline script, V1 duyệt Admin, V2/V3/V5 xác nhận bằng chạy, V4 test hai thời điểm quanh 17:00 UTC, V9 chụp ảnh, V10 đếm dòng. R0 **chưa hoàn thành** cho tới khi báo cáo có bằng chứng chạy thật của các mục này.

Chuẩn bị:
1. `pnpm install` trong worktree. Chú ý ghi chú `minimumReleaseAge` của dự án: nếu gói `@tanngo11/log` mới bị chặn, **dừng và báo** chủ dự án, không tự đổi `.npmrc` hay `pnpm-workspace.yaml`.
2. Tạo DB PostgreSQL `salanca_ordering_notify` (loopback, như các phase trước). `$env:ORDERING_TEST_DATABASE = 'salanca_ordering_notify'`.
3. `pnpm run build:ordering`.
4. Baseline: chạy `node scripts/ordering/notifications.mjs`, `node scripts/ordering/email-templates.mjs`, `node scripts/ordering/customer-auth.mjs`. Ghi pass/fail và số assertion. Nếu fail ở baseline, **dừng và báo** (không phải lỗi của mình, cần biết trước khi sửa).

Kiểm chứng (mỗi dòng ghi: cách làm, kết quả, bằng chứng như lệnh, tên file, ảnh chụp):

| # | Cần xác nhận | Cách kiểm |
|---|---|---|
| V1 | A1: không có màn xem nhật ký gửi | `rg "notification-delivery" src/plugins/ordering/admin src/plugins/ordering/server/src/routes src/plugins/ordering/server/src/controllers` (kết quả mong đợi: rỗng). Mở Admin thật (`node scripts/ordering/uat-server.mjs`, xem đầu file để biết biến môi trường), duyệt toàn bộ menu Ordering và Settings, ghi có/không |
| V2 | A2: khách chỉ có SĐT | Viết script tạm trong scratchpad (không commit) dựa trên `notifications.mjs`: tạo đơn storefront với `contact: { name, phone }` không email, chạy outbox, đếm dòng `notification-delivery` cho đơn đó và `capture.sent`. Mong đợi: 0 dòng, 0 mail cho khách |
| V3 | A3: chi nhánh không email | Cùng script: `branch.email = null`, tạo đơn, chạy outbox. Mong đợi: không có dòng `staff.order-created` |
| V4 | A4: reset theo UTC | Đọc lại `reservePaidSend` và `paidSentToday`; xác nhận bằng test nhỏ gọi hàm ở hai thời điểm quanh 17:00 UTC (có thể giả lập bằng cách sửa đồng hồ hệ thống test hoặc truyền tham số, ghi cách làm) |
| V5 | A5: email-disabled | Chạy app với `notifications.email.enabled = false`, tạo đơn có email, mong đợi dòng `skipped` với `lastError = 'email-disabled'` |
| V6 | Guard hiện có | Xác nhận `EMAIL_ALLOW_EXTERNAL_DELIVERY` chặn host không loopback ngoài production (chạy `config/transactional-email.helper` test hiện có hoặc đọc test) |
| V7 | 6 nơi gọi provider | **Đã đọc khi soạn spec**, kết quả ở bước 2 (bảng "Nơi gọi provider"). AI chỉ cần xác nhận không có nơi gọi thứ 7: `rg "notificationProvider\(" src/plugins/ordering/server/src --glob "!*.test.ts"` |
| V8 | Hành vi OTP khi kênh không khả dụng | **Đã đọc**: `customer-auth.ts` tính `unavailable` (email tắt hoặc kênh chưa đăng ký) thì `mark('skipped', ...)` và `return`; `requestOtp` luôn trả `{challengeId}`. Lỗi ném khi gửi thì `mark('failed')` và challenge vẫn dùng được. Không cần kiểm thêm |
| V9 | Bố cục Admin hiện có | Chụp ảnh màn Settings → Kênh thông báo và Mẫu email để bước 3 đặt màn mới cho hợp |
| V10 | Số dòng nhật ký | Đếm dòng trong `notification-delivery` sau khi chạy baseline (để ước lượng cần index không) |

Báo cáo gồm: bảng V1-V10, danh sách **chênh lệch so với giả định A1-A5**, và đề xuất sửa bước 1-3 nếu bằng chứng khác giả định. **Dừng sau bước này và báo chủ dự án nếu có chênh lệch lớn.**

Verification: file báo cáo tồn tại, mỗi V có kết quả và bằng chứng. `git status --short` sạch.

### Bước 1. R1e: hạn mức ngày theo múi giờ cấu hình

Mục tiêu: `dailyLimit` tính theo ngày dương lịch của `notifications.timezone` thay vì UTC.

Files:
- `server/src/domain/notifications/budget-day.ts` (mới) + `budget-day.test.ts`
- `server/src/config/index.ts` (schema và mặc định)
- `config/plugins.ts` (env) + `config/plugins.test.ts`
- `server/src/services/notification-channel.ts` (`paidSentToday`, `reservePaidSend`)
- `server/src/services/notification.ts` (`utcDayStart` và khóa chống trùng alert)

Chi tiết:
1. `budget-day.ts` xuất hai hàm thuần:
   - `notificationDay(now: Date, timezone: string): string` trả `YYYY-MM-DD` của ngày dương lịch ở múi giờ đó. Gọi lại `businessDate(now, timezone, '00:00')` từ `domain/business-date.ts` (cutoff `00:00` cho ra ngày dương lịch). Không viết lại logic Intl.
   - `notificationDayStart(now: Date, timezone: string): Date` trả thời điểm UTC của 00:00 ngày đó ở múi giờ. Cách làm: lấy `day = notificationDay(now, tz)`; ước lượng `guess = new Date(`${day}T00:00:00Z`)`; tính độ lệch của múi giờ tại `guess` bằng cách format `guess` ở múi giờ đó (`Intl.DateTimeFormat` với `formatToParts`) rồi so với `guess` theo UTC; `start = guess - offset`; kiểm lại độ lệch tại `start` một lần (biên chuyển giờ mùa hè) và hiệu chỉnh nếu khác. Việt Nam không có DST nhưng hàm phải đúng với múi giờ có DST.
2. Config: `notifications.timezone: z.string()` kiểm hợp lệ bằng cách thử `new Intl.DateTimeFormat('en-CA', { timeZone: value })` (sai thì lỗi rõ khi khởi động, thông báo nêu tên biến `ORDERING_NOTIFY_TIMEZONE`, không để lọt vào runtime). Mặc định `'Asia/Ho_Chi_Minh'`. Host: `ORDERING_NOTIFY_TIMEZONE` (mặc định cùng giá trị) trong `config/plugins.ts`, bên cạnh `ORDERING_NOTIFY_DAILY_LIMIT`.
3. `reservePaidSend`: `day = notificationDay(new Date(), tz)` thay cho `toISOString().slice(0,10)`. Chấp nhận tham số tùy chọn `now: Date = new Date()` để test được. `paidSentToday`: `dayStart = notificationDayStart(now, tz)` thay cho `setUTCHours`. Giữ nguyên khóa advisory và khóa plugin store `paid-daily-usage` (giá trị `day` cũ kiểu UTC sẽ không khớp ngày mới, và code đã tự nạp lại từ `paidSentToday` khi `saved.day` khác ngày: đó là hành vi mong muốn khi đổi múi giờ).
4. `notification.ts`: thay `utcDayStart()` bằng cách dùng `notificationDay(new Date(), tz)` cho khóa `notification-daily-limit:<ngày>` (hàm `utcDayStart` hết còn được dùng thì xóa).
5. `overview()` trả thêm `timezone` (để Admin hiện "Hạn mức tính theo giờ ..." sau này). Nếu thêm field vào response thì cập nhật OpenAPI nếu response có schema khai báo.

Tests:
- `budget-day.test.ts` (vitest): với `Asia/Ho_Chi_Minh`: `2026-10-15T16:59:59Z` thuộc ngày `2026-10-15`, `2026-10-15T17:00:00Z` thuộc ngày `2026-10-16`; `notificationDayStart(2026-10-15T20:00Z)` = `2026-10-15T17:00:00.000Z`. Với `UTC`: ngày bằng ngày UTC, start = 00:00Z. Với `America/New_York` quanh ngày chuyển giờ (ví dụ 2026-03-08 và 2026-11-01): start của ngày đó đúng (độ lệch -5h hoặc -4h tùy ngày), và ngày chuyển giờ không bị sai 1 giờ. Múi giờ sai ném lỗi.
- `config/plugins.test.ts`: mặc định có `timezone: 'Asia/Ho_Chi_Minh'`; `ORDERING_NOTIFY_TIMEZONE=UTC` được áp dụng; giá trị sai làm hàm resolve ném lỗi có tên biến. **Test này từng đỏ khi thêm config mới mà quên cập nhật kỳ vọng** (xem core-sales audit): cập nhật kỳ vọng `notifications` đầy đủ.
- Script tích hợp (mở rộng `scripts/ordering/notifications.mjs` hoặc file mới `scripts/ordering/notify-budget-day.mjs` thêm vào `run-all.mjs`): với `dailyLimit = 1`, `reservePaidSend(2026-10-15T16:30Z)` trả true, lần hai trả false; `reservePaidSend(2026-10-15T17:30Z)` (đã sang ngày mới giờ Việt Nam) trả true. Cùng thời điểm với `timezone = 'UTC'` thì hai lần đầu thuộc cùng ngày. Cách đặt `dailyLimit` và `timezone` trong test: harness đã có tiền lệ đổi cấu hình plugin giữa chừng, `app.config.set('plugin::ordering.catalog.adapter', 'test-catalog')` (`scripts/ordering/_harness.mjs` l.267). Dùng `app.config.set('plugin::ordering.notifications.dailyLimit', 1)` và `app.config.set('plugin::ordering.notifications.timezone', 'UTC')`. Cách này chỉ đúng nếu code đọc cấu hình **lười** (mỗi lần gọi `strapi.config.get`), đúng như `notification-channel.ts` đang làm (`const config = () => strapi.config.get(...)`). Không cache `timezone` hay `dailyLimit` ở cấp module hoặc lúc khởi tạo service.

Verification:
```powershell
pnpm exec vitest run src/plugins/ordering/server/src/domain/notifications config
pnpm run lint
pnpm run typecheck
pnpm run build:ordering
node scripts/ordering/notifications.mjs
node scripts/ordering/notify-budget-day.mjs   # nếu làm file mới
```
Acceptance: test trên xanh; một thay đổi `ORDERING_NOTIFY_TIMEZONE` không cần sửa code; mặc định (không đặt biến) cho ngày giờ Việt Nam.

### Bước 2. R1a: chế độ an toàn cho môi trường thử

Mục tiêu: có thể đặt môi trường (staging, UAT) ở chế độ `allowlist`: **không** tin nào tới người nhận ngoài danh sách cho phép, trên **mọi** kênh và **mọi** đường gửi (kể cả OTP, nhắc giỏ, gửi thử).

Thiết kế (theo D1; nếu chủ dự án đổi D1, chỉ đổi mặc định):
- `ORDERING_NOTIFY_MODE`: `live` (mặc định) hoặc `allowlist`.
- `ORDERING_NOTIFY_ALLOWLIST`: danh sách ngăn bằng dấu phẩy. Mỗi mục là một trong: địa chỉ email đầy đủ (không phân biệt hoa thường), `@domain.tld` (mọi địa chỉ thuộc miền đó), số điện thoại (chuẩn hóa về E.164 bằng `shared/contact/phone` `normalizeVietnamesePhone`; mục không chuẩn hóa được là lỗi cấu hình).
- Chế độ `allowlist` với danh sách rỗng chặn **tất cả** (fail closed) và ghi cảnh báo khi khởi động.
- Mục không hợp lệ: lỗi khởi động, thông báo nêu tên biến và **vị trí mục** (số thứ tự), không in giá trị.
- Khởi động ghi một dòng log mức info: `notification mode: live|allowlist (N entries)`. Không in mục.

Files:
- `server/src/domain/notifications/notify-guard.ts` (mới, thuần) + `notify-guard.test.ts`
- `server/src/config/index.ts` (`notifications.mode`, `notifications.allowlist`)
- `config/plugins.ts` + `config/plugins.test.ts`
- `server/src/services/registry.ts` (bọc provider)
- `server/src/services/notification.ts` (`deliver`: kiểm trước khi tốn hạn mức)
- `server/src/services/notification-channel.ts` (`overview()` trả `mode`, `allowlistCount`)
- `server/src/register.ts` hoặc nơi khởi động: log dòng chế độ
- `admin/src/pages/Settings/NotificationChannels.tsx` (banner chế độ), `admin/src/pages/Providers/index.tsx` (banner chế độ), `admin/src/translations/` (chuỗi mới)
- `docs/ordering-ops-runbook.md`, `docs/ordering-integrations.md` (nếu có bảng env)

Chi tiết:
1. `notify-guard.ts`: `parseAllowlist(entries: string[]): { ok: true; matcher } | { ok: false; invalid: number[] }` và `createGuard({ mode, allowlist })` trả `{ allows(channel: string, value: string): boolean }`. `live` luôn `true`. `allowlist`: `email` so khớp mục email hoặc miền; `sms` và `zalo` so khớp mục số điện thoại sau chuẩn hóa. Giá trị không thuộc loại của kênh thì `false`.
2. **Bọc ở registry bằng `Proxy`, không bằng đối tượng mới.** Test hiện có lấy provider email bằng `plugin.service('registry').notificationProvider('email')` rồi đọc `capture.sent` và đặt `capture.failNext` (`scripts/ordering/notifications.mjs`). Nếu `notificationProvider()` trả một đối tượng bọc thường thì `.sent` là `undefined` và `failNext = 1` không có tác dụng: **mọi script thông báo hiện có sẽ hỏng**. Vì vậy:
   - `notificationProvider(channel)` trả `new Proxy(provider, { get, set })`: `get` cho `send` trả hàm kiểm guard rồi gọi `provider.send`; mọi thuộc tính khác (kể cả `sent`, `failNext`) chuyển thẳng tới `provider`; `set` ghi thẳng vào `provider`.
   - `send` đã bọc kiểm `guard.allows(channel, input.recipient.email ?? input.recipient.phone)`; không khớp thì ném `OrderingError('NOTIFICATION_BLOCKED', 'recipient is not on the allowlist', { details: { channel } })`, không đưa giá trị người nhận vào lỗi.
   - **Guard đọc cấu hình lười**: mỗi lần `send` và mỗi lần `isNotificationAllowed` đều lấy `strapi.config.get('plugin::ordering').notifications` hiện tại (tạo guard từ đó, rẻ), để `app.config.set(...)` trong test có tác dụng ngay và để không cache lúc `register()`. Registry hiện không có `strapi`; thêm tham số `getNotifyConfig: () => { mode; allowlist }` khi tạo registry (xem `services/index.ts` và cách `register.ts` lấy `strapi.config`).
   - Thêm vào registry hàm `isNotificationAllowed(channel: string, value: string): boolean` để các nơi gọi **kiểm trước** (mục 4) mà không cần bắt lỗi.
   - Test bảo đảm: `registry.notificationProvider('email').sent` vẫn là mảng của provider capture và `registry.notificationProvider('email').failNext = 1` làm lần gửi kế tiếp thất bại, **khi đã bọc**.
3. `deliver()`: ngay sau khi có `value` và trước `blockedReason`, nếu `!registry().isNotificationAllowed(channel, value)`: `markSkipped(..., 'not-allowlisted')` rồi `continue`. Đặt **trước** `paidLimitHit` để người bị chặn không tốn một suất hạn mức. Lớp Proxy chỉ là chốt cuối.
4. **Xử lý tại từng nơi gọi provider.** Cả 5 nơi còn lại **kiểm trước bằng `isNotificationAllowed` và ghi `skipped`, không để lỗi bay lên**, vì nếu để `NOTIFICATION_BLOCKED` bay lên thì OTP và job nhắc sẽ ghi `failed` và có thể bị thử lại. Đã đọc từng nơi:

   | Nơi | Hiện làm gì khi kênh không dùng được | Thay đổi |
   |---|---|---|
   | `customer-auth.ts` (~l.160-205, OTP) | Tính `unavailable`; nếu có thì `mark('skipped', { lastError })` rồi `return`. Lỗi ném khi gửi thì `mark('failed')`, challenge vẫn dùng được. `requestOtp` luôn trả `{challengeId}` | Sau khối `unavailable`, **trước** `reservePaidSend`: `if (!registry().isNotificationAllowed(input.channel, input.target)) { await mark('skipped', { lastError: 'not-allowlisted' }); return; }`. Không làm lộ việc địa chỉ có trong danh sách hay không (response vẫn là `{challengeId}`) |
   | `cart.ts` `sendReminder` (~l.952-990) | `if (!email.enabled) return finish('skipped')`; lỗi ném thì `mark('failed')` | Sau dòng kiểm email bật: `finish('skipped', 'not-allowlisted')`. Mở rộng `finish(status, reason?)` để ghi `lastError: reason` cho `skipped`. `finish` đã dán `reminderSentAt` nên **không tạo vòng thử lại** |
   | `loyalty-lifecycle.ts` `deliver` (~l.100) | `if (!email.enabled) { mark('skipped'); return 'skipped' }`; lỗi ném thì `mark('failed')` | Sau dòng kiểm email bật: `await mark('skipped', { lastError: 'not-allowlisted' }); return 'skipped';`. Lưu ý: `skipped` là trạng thái cuối, rerun trả `'already'`; nếu sau này mở rộng danh sách, mail đã bỏ qua **không tự gửi lại** (chấp nhận được ở môi trường thử, ghi vào runbook) |
   | `notification-channel.ts` gửi thử kênh (~l.285-340) | Kiểm hạn mức rồi tạo dòng, gọi `send`, lỗi thì ghi `failed` và ném | Trước `reservePaidSend`: `if (!registry().isNotificationAllowed(channel, String(recipient.email ?? recipient.phone))) return validation('the test recipient is not on the notification allowlist', { channel });` |
   | `notification-template.ts` `sendTest` (~l.200-222) | Gửi tới email của admin đang đăng nhập | Trước `send`: nếu không được phép thì `throw new OrderingError('VALIDATION_ERROR', 'the signed-in admin is not on the notification allowlist', { details: {} })`. Ở `allowlist`, admin muốn gửi thử phải có email trong danh sách |

   Nơi gọi thứ sáu là `deliver()` (mục 3). Test mỗi nơi bằng cách làm provider `send` ném khi bị gọi (spy) và khẳng định nó **không được gọi** với người nhận ngoài danh sách.
5. `overview()` thêm `mode` và `allowlistCount` (số, **không** trả danh sách). Admin hiện banner vàng ở Settings → Kênh thông báo và trang Providers khi `mode = allowlist`: "Môi trường thử: chỉ gửi tới N người nhận trong danh sách cho phép". Chuỗi vi/en theo mẫu `o13.ts`.
6. Phạm vi: không áp cho `src/domain/form-intake`. Ghi rõ trong runbook: thông báo form liên hệ và đặt bàn được bảo vệ bởi `EMAIL_ALLOW_EXTERNAL_DELIVERY` và danh sách người nhận riêng.
7. Runbook: thêm mục "Môi trường thử (staging/UAT)" với checklist: đặt `ORDERING_NOTIFY_MODE=allowlist`, điền `ORDERING_NOTIFY_ALLOWLIST` tối thiểu email của người thử, **kiểm banner hiển thị** trước khi cho người thật thử, và nhắc `NODE_ENV=production` không tự bật chế độ này.

Tests:
- `notify-guard.test.ts` (vitest): `live` cho mọi giá trị; `allowlist` rỗng chặn hết; email khớp không phân biệt hoa thường; `@domain` khớp `a@domain` và không khớp `a@sub.domain` hay `a@xdomain` (kiểm kỹ ranh giới); SĐT `0901234567` trong danh sách khớp giá trị E.164 `+84901234567`; mục không hợp lệ trả `invalid` đúng vị trí; kênh `sms` với giá trị email không khớp.
- `scripts/ordering/notify-guard.mjs` (mới, thêm vào `run-all.mjs`): với `mode = allowlist`, `allowlist = ['allowed@example.invalid']`:
  - đặt đơn storefront với `contact.email = 'guest@example.invalid'` (không trong danh sách): dòng `customer.order-placed` có `status = skipped`, `lastError = 'not-allowlisted'`, `capture.sent` không có mail cho khách;
  - chi nhánh có `email = 'q1-staff@example.invalid'` không trong danh sách: dòng staff `skipped`;
  - thêm `guest@example.invalid` vào danh sách (cấu hình lại hoặc khởi tạo app mới): mail tới khách `sent`;
  - gọi trực tiếp `registry.notificationProvider('email').send({ recipient: { email: 'x@other.invalid' }, ... })` bị `NOTIFICATION_BLOCKED`, `capture.sent` không tăng;
  - OTP tới email không trong danh sách không trả lỗi 500 và không có mail;
  - nếu harness đăng ký được provider `sms` giả: người nhận bị chặn **không** tăng bộ đếm `reservePaidSend`.
  Cách đặt `mode` và `allowlist` trong test: `app.config.set('plugin::ordering.notifications.mode', 'allowlist')` và `app.config.set('plugin::ordering.notifications.allowlist', [...])` (tiền lệ ở bước 1). Guard đọc cấu hình lười (mục 2) nên có tác dụng ngay, không cần khởi tạo lại app. Không sửa `_harness.mjs`.
- `config/plugins.test.ts`: mặc định `mode = live`, `allowlist = []`; `ORDERING_NOTIFY_MODE=allowlist` và danh sách parse đúng; mục sai ném lỗi nêu tên biến và vị trí, **không** chứa giá trị.

Verification:
```powershell
pnpm exec vitest run src/plugins/ordering/server/src/domain/notifications config
pnpm run lint
pnpm run typecheck
pnpm run typecheck:admin
pnpm run build:ordering
node scripts/ordering/notify-guard.mjs
node scripts/ordering/notifications.mjs
node scripts/ordering/customer-auth.mjs
node scripts/ordering/cart-reminder.mjs
node scripts/ordering/loyalty-expiry.mjs
node scripts/ordering/email-templates.mjs
```
Acceptance: mặc định không đổi hành vi: **`notifications.mjs`, `customer-auth.mjs`, `cart-reminder.mjs`, `loyalty-expiry.mjs`, `email-templates.mjs` xanh mà không sửa một dòng kỳ vọng nào** (đây là phép thử rằng Proxy giữ nguyên `capture.sent` và `capture.failNext`); `allowlist` chặn đúng và có dấu vết `skipped`; banner hiện; runbook cập nhật.

### Bước 3. R1b: màn "Lịch sử gửi" (chỉ đọc) và cảnh báo thiếu email chi nhánh

Mục tiêu: owner thấy mỗi lần gửi và lý do lỗi hay bị bỏ qua; thấy chi nhánh chưa có email nhận đơn.

#### 3.1 Server

Files (mới trừ khi ghi khác):
- `server/src/services/notification-log.ts` + đăng ký trong `services/index.ts`
- `server/src/controllers/notification-log.ts` + đăng ký trong `controllers/index.ts`
- `server/src/routes/index.ts` (4 route: list, summary, detail, technical)
- `server/src/openapi/operations.ts` (4 khai báo; `technical` đòi `['notification-log.read', 'notification-log.details']`) rồi `pnpm run ordering:openapi`
- `server/src/register.ts` (`adminActions` thêm 2 quyền)
- `server/src/domain/notifications/skip-reasons.ts` (nhãn lý do bị bỏ qua) + test
- `scripts/ordering/_harness.mjs` (`ORDERING_ACTIONS` thêm 2 quyền)

Quyền (đặt tên theo mẫu):
- `notification-log.read` — "Xem lịch sử gửi thông báo"
- `notification-log.details` — "Xem chi tiết lỗi gửi thông báo"

Routes (khai `summary` **trước** `:id`, như O15 khai `actors` trước `:id`):
```ts
adminRoute('GET', '/notification-log', 'notification-log.list', 'notification-log.read'),
adminRoute('GET', '/notification-log/summary', 'notification-log.summary', 'notification-log.read'),
adminRoute('GET', '/notification-log/:id', 'notification-log.detail', 'notification-log.read'),
// Hai quyền là hai tham số rời (cùng kiểu `audit-log/export`), policy chặn 403 trước khi vào service.
adminRoute('GET', '/notification-log/:id/technical', 'notification-log.technical', 'notification-log.read', 'notification-log.details'),
```

`GET /notification-log` query:
| Tham số | Kiểu | Quy tắc |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | Ngày theo `notifications.timezone` (không hard-code `+07:00`). Mặc định 7 ngày gần nhất. Tối đa 92 ngày, vượt thì `VALIDATION_ERROR` `details.field = 'to'` |
| `status` | `pending|sent|failed|skipped` | Sai thì `VALIDATION_ERROR` `details.field = 'status'` |
| `channel` | `zalo|sms|email` | Sai thì lỗi `details.field = 'channel'` |
| `template` | một `TemplateCode` | Sai thì lỗi `details.field = 'template'` |
| `role` | `staff|customer` | Sai thì lỗi |
| `q` | chuỗi | Mã đơn (không phân biệt hoa thường), khớp đúng thì lọc theo `order_id` của đơn đó; không khớp đơn nào thì trả rỗng |
| `page` | số nguyên dương | 50 dòng mỗi trang, trả `hasNext` |

Response `list`: `{ range: { from, to, timezone }, page, hasNext, rows: Row[] }` với:
```ts
type Row = {
  id: number;
  createdAt: string;            // ISO
  template: string;
  templateLabel: string;        // TEMPLATE_NAMES[template][0] (vi) hoặc [1] (en) theo `locale`
  channel: 'zalo' | 'sms' | 'email';
  recipientRole: 'staff' | 'customer' | null;
  orderId: number | null;
  orderCode: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  sentAt: string | null;
  reasonCode: string | null;    // chỉ khi status = skipped, ví dụ 'email-disabled'
  reasonLabel: string | null;   // nhãn tiếng Việt/Anh của reasonCode, lấy từ skip-reasons.ts
};
```
**Không** trả `recipientHash`, `eventId`, `lastError`, `providerMessageId`, `costEstimate` ở danh sách.

`GET /notification-log/:id` (404 `NOT_FOUND` nếu không có hoặc ngoài phạm vi): trả đúng `Row` ở trên (kèm `messageLocale`). **Không** có field kỹ thuật.

`GET /notification-log/:id/technical` (cần cả `notification-log.read` và `notification-log.details`; thiếu `details` thì policy trả 403, không vào service; 404 như trên nếu dòng ngoài phạm vi): trả `{ id, lastError, providerMessageId, costEstimate }`. Tách thành route riêng vì repo **không có** mẫu "ẩn field theo quyền thứ hai" trong service (`payment.raw-read` mới chỉ được khai ở `register.ts`, chưa nơi nào dùng), còn "nhiều quyền là tham số rời của `adminRoute`" là mẫu đã có (`audit-log/export` đòi `audit.read` và `export`). Cách này dùng cơ chế sẵn có và không thêm logic quyền vào service.

`GET /notification-log/summary`: 
```ts
{
  timezone: string;
  last24h: { sent: number; failed: number; skipped: number; pending: number };
  byChannel: Array<{ channel: string; sent: number; failed: number; skipped: number; lastSentAt: string | null }>;
  paid: { sentToday: number; dailyLimit: number };   // ngày theo notifications.timezone
  mode: 'live' | 'allowlist';                        // nếu bước 2 đã làm
  branchesWithoutEmail: Array<{ code: string; name: Record<string,string> }>;
}
```
`branchesWithoutEmail`: chi nhánh đang hoạt động trong phạm vi của người gọi mà `email` rỗng hoặc null. Chi nhánh "đang hoạt động" là `isActive = true` (trường có sẵn ở `content-types/branch/schema.ts`, mặc định `true`); thiếu email là `email` null, rỗng hoặc chỉ có khoảng trắng.

Phạm vi và SQL:
- Bảng `plugins_ordering_notification_delivery` (alias `d`), join trái `plugins_ordering_order` (alias `o`) qua `d.order_id = o.id` để lấy `o.code`, `o.location_ref`.
- Người gọi không `allLocations`: `whereIn('o.location_ref', scope.locationRefs)` (dòng không có đơn bị loại). `allLocations`: thấy cả dòng không có đơn.
- Lấy phạm vi như O15: `scope().loadScope(ctx)` và `SCOPE_REQUIRED` khi thiếu.
- Sắp xếp `d.id DESC`. Lọc thời gian theo `d.created_at >= startOfDay(from)` và `< startOfDay(to) + 1 ngày` dùng `notificationDayStart` từ bước 1 (nếu bước 1 chưa làm thì làm bước 1 trước).
- Chỉ mục: không thêm migration ở bước này. Bảng nhỏ. Nếu V10 cho thấy hàng chục nghìn dòng, ghi đề xuất index `(created_at)` vào "Điều lệch kế hoạch" thay vì tự thêm.
- Tránh N+1: một truy vấn join cho cả trang.

`skip-reasons.ts`: map từ `lastError` của dòng `skipped` sang nhãn. Mã hiện có (từ `blockedReason`): `email-disabled`, `provider-not-configured`, `zns-template-missing`, `daily-limit`; thêm `not-allowlisted` (bước 2). Nhãn vi/en, ví dụ:
- `email-disabled`: "Email chưa bật (chưa cấu hình SMTP)" / "Email is off (SMTP not configured)"
- `provider-not-configured`: "Kênh chưa được cấu hình" / "Channel is not configured"
- `zns-template-missing`: "Thiếu mẫu Zalo ZNS cho thông báo này" / "No Zalo ZNS template set for this message"
- `daily-limit`: "Hết hạn mức gửi trong ngày" / "Daily send limit reached"
- `not-allowlisted`: "Chế độ thử: người nhận không nằm trong danh sách cho phép" / "Test mode: recipient is not on the allowlist"
Mã lạ thì `reasonLabel = null`, `reasonCode` vẫn trả. Có test bảo đảm mọi mã mà `blockedReason` và `deliver` có thể ghi đều có nhãn (quét bằng test hoặc danh sách hằng dùng chung giữa `notification.ts` và file này; tốt nhất xuất hằng `SKIP_REASONS` từ `skip-reasons.ts` và để `notification.ts` import nó để không lệch).

#### 3.2 Admin

Files:
- `admin/src/pages/NotificationLog/index.tsx` (mới)
- `admin/src/pages/App.tsx` (lazy import, khóa hiển thị `'notification-log'`, nav, RBAC, route `notification-log/*`)
- `admin/src/lib/permissions.ts` (`PERMISSIONS.notificationLog`, `notificationLogDetails`, `RBAC_NOTIFICATION_LOG`)
- `admin/src/translations/n1.ts` (mới) + `lib/i18n.ts` (`n1Translations`) + `admin/src/index.ts` (nối vào `registerTrads`)
- `admin/src/translations/o3.test.ts` (thêm `'pages/NotificationLog'` vào `O3_DIRS`)

Đặt mục menu ở nhóm "Thiết lập" (cùng chỗ với "Lịch sử thay đổi", `App.tsx` l.195-205), nhãn `nav.notificationLog` = "Lịch sử gửi" / "Delivery log". Hiện khi người dùng có `notification-log.read`.

Bố cục màn (từ trên xuống, theo mẫu `pages/AuditLog/index.tsx`, dùng `Layouts`, `Page`, `useFetchClient`, `useErrorToast`, `formatDateTime`):
1. Tiêu đề "Lịch sử gửi thông báo", mô tả: "Mỗi lần hệ thống gửi hoặc bỏ qua một thông báo. Ngày tính theo múi giờ {timezone}. Địa chỉ người nhận không được lưu nên không hiển thị."
2. Nếu `branchesWithoutEmail` không rỗng: `Alert` cảnh báo (`variant="warning"`, có children): "Chi nhánh chưa có email nhận đơn mới: {danh sách tên}. Nhân viên sẽ không nhận thông báo đơn mới ở các chi nhánh này." kèm liên kết "Mở Chi nhánh" tới trang Chi nhánh.
3. Nếu `mode = allowlist`: `Alert` thông tin: "Môi trường thử: chỉ gửi tới người nhận trong danh sách cho phép."
4. Dải số (4 ô, `Flex`): Đã gửi 24h, Lỗi 24h, Bỏ qua 24h, Hạn mức tính phí hôm nay `sentToday / dailyLimit`. Ô Lỗi tô màu cảnh báo khi > 0.
5. Hàng bộ lọc: Từ ngày, Đến ngày, Trạng thái (`SingleSelect`: Tất cả, Đã gửi, Lỗi, Bỏ qua, Đang chờ), Kênh, Mẫu thông báo, Vai trò, ô mã đơn, nút "Lọc". Giá trị `__all__` cho "Tất cả" như AuditLog (`ALL`).
6. Bảng (`Table` với `rowCount`): Giờ, Mẫu, Kênh (`Badge`), Vai trò, Đơn (liên kết tới chi tiết đơn như AuditLog), Trạng thái (`Badge` có màu: Đã gửi xanh, Lỗi đỏ, Bỏ qua vàng, Đang chờ xám), Lý do (hiện `reasonLabel` cho dòng bỏ qua), Lần thử, nút "Chi tiết".
7. "Chi tiết" mở `Modal` hiện các field của `Row`. Nếu người dùng có quyền `notification-log.details` (kiểm bằng `useRBAC`) thì Modal có thêm nút "Xem chi tiết kỹ thuật", bấm thì gọi `/notification-log/:id/technical` và hiện khối "Lỗi kỹ thuật" (chữ monospace), `providerMessageId`, `costEstimate` (tiền VND, ghi "ước tính"). Không có quyền thì không có nút và Modal ghi dòng "Bạn không có quyền xem chi tiết kỹ thuật". Không dùng dropdown trong Modal.
8. Phân trang "Trang trước / Trang sau" theo `hasNext` như AuditLog. Trạng thái rỗng dùng `EmptyStateLayout`. Đang tải dùng `Loader`.
9. Mọi chuỗi qua `useT`, thêm vào `n1.ts`. Khóa tối thiểu: `nav.notificationLog`, `nlog.title`, `nlog.subtitle`, `nlog.warn.noEmail`, `nlog.warn.noEmail.link`, `nlog.info.allowlist`, `nlog.stat.sent24h`, `nlog.stat.failed24h`, `nlog.stat.skipped24h`, `nlog.stat.budget`, `nlog.filter.*` (from, to, status, channel, template, role, q, apply), `nlog.status.*` (all, sent, failed, skipped, pending), `nlog.col.*`, `nlog.detail.title`, `nlog.detail.technical`, `nlog.detail.noPermission`, `nlog.empty`, `nlog.page.prev`, `nlog.page.next`.

Phân quyền Admin: màn dùng `useRBAC(RBAC_NOTIFICATION_LOG)` để hiện menu và `useRBAC` riêng cho `notification-log.details` để hiện nút kỹ thuật. Server mới là nơi chặn thật: route `/technical` trả 403 khi thiếu quyền.

#### 3.3 Tests

`scripts/ordering/notification-log.mjs` (mới, thêm vào `run-all.mjs` ngay sau `audit-log.mjs`), theo khuôn `audit-log.mjs`: `withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff` với các nhân viên: `chuoi` (allLocations, đủ quyền), `quanlyQ1` (chỉ Q1, có `notification-log.read` không có `details`), `nvQ3` (chỉ Q3), `khongQuyen` (không có `notification-log.read`).

Các ca (mỗi ca có assertion cụ thể):
1. Đặt đơn Q1 qua `createOrder` với khách có email, chạy `runOutboxDispatcher`. `chuoi` gọi list: có dòng `staff.order-created` và `customer.order-placed`, `status = sent`, `channel = email`, `orderCode` đúng, `reasonCode = null`. JSON response **không chứa** các khóa `recipientHash`, `eventId`, `lastError`, `providerMessageId`, `costEstimate`.
2. Phạm vi: `quanlyQ1` thấy dòng của đơn Q1, `nvQ3` không thấy; dòng không có đơn (tạo bằng cách phát một alert vận hành `staff.ops-alert` hoặc chèn dòng test không có `order_id`) chỉ `chuoi` thấy.
3. Lỗi: đặt `capture.failNext = 1` (trên provider **đã qua Proxy** của bước 2, nếu bước 2 đã làm), đặt đơn, chạy outbox: có dòng `failed`. `GET /notification-log?status=failed` trả dòng đó và response **không có** `lastError`. `GET /:id/technical` với `chuoi` (có `details`) trả `lastError` là chuỗi không rỗng; cùng route với `quanlyQ1` (có `read`, không `details`) trả **403**; `GET /:id` với `quanlyQ1` vẫn 200 nhưng không có `lastError`.
4. Bỏ qua và nhãn: tạo rule kênh `['sms']` cho một template (hoặc tắt email) để sinh dòng `skipped`. List trả `reasonCode` đúng và `reasonLabel` khác null. Test quét: mọi mã trong `SKIP_REASONS` đều có nhãn vi và en.
5. 403: `khongQuyen` gọi cả ba route đều nhận 403.
6. Validation: `from=2026-13-40`, khoảng > 92 ngày, `status=bogus`, `channel=bogus`, `template=bogus`, `page=0` (hoặc âm) đều trả 400 `VALIDATION_ERROR` với `details.field` đúng.
7. `q`: mã đơn đúng (chữ thường cũng được) chỉ trả dòng của đơn đó; mã không tồn tại trả danh sách rỗng, không lỗi.
8. Phân trang: chèn 55 dòng, trang 1 có 50 và `hasNext = true`, trang 2 có 5 và `hasNext = false`; thứ tự giảm theo `id`.
9. `summary`: số `last24h` khớp dữ liệu seed; `branchesWithoutEmail` có chi nhánh `email = null`, không có chi nhánh đã có email; nhân viên chỉ Q1 chỉ thấy chi nhánh Q1 trong danh sách; `paid.dailyLimit` bằng cấu hình.
10. Thứ tự route: `GET /notification-log/summary` trả 200 (không bị `/:id` bắt thành 400 hay 404).
11. `GET /:id` và `GET /:id/technical` của dòng ngoài phạm vi trả 404, không rò rỉ sự tồn tại.
12. Lọc theo `channel`, `template`, `role` mỗi cái ít nhất một ca.

Vitest: `skip-reasons.test.ts` (nhãn đủ, mã lạ trả `null`), test thuần cho hàm dựng điều kiện lọc nếu tách ra.

Admin: chạy `pnpm run typecheck:admin`; `translations/o3.test.ts` xanh (không còn chuỗi chưa dịch trong `pages/NotificationLog`); không import từ `server/**` (`node scripts/ordering/check-admin-imports.mjs`).

Verification:
```powershell
pnpm exec vitest run src/plugins/ordering/server/src/domain/notifications src/plugins/ordering/admin
pnpm run lint
pnpm run typecheck
pnpm run typecheck:admin
pnpm run build:ordering
pnpm run ordering:openapi
node scripts/ordering/openapi.mjs
node scripts/ordering/check-admin-imports.mjs
node scripts/ordering/notification-log.mjs
node scripts/ordering/audit-log.mjs
node scripts/ordering/notifications.mjs
```
Acceptance: mọi ca ở 3.3 xanh; OpenAPI đồng bộ; màn mở được trong Admin (UAT tay ở bước 4); role không có quyền không thấy menu và nhận 403.

### Bước 4. R1c: UAT tay phần thông báo

Viết `docs/plans/notification-release-uat.md` (checklist dạng ô tick, mỗi ca có điều kiện đầu, thao tác, kết quả mong đợi, cột ghi chú). Chạy bằng `node scripts/ordering/uat-server.mjs` với Mailpit ở cổng 1025 (xem `docs/resend-email-operations.md` mục "Local capture"). Người thực hiện: chủ dự án (theo quy ước repo, AI **không** làm UAT giao diện trên trình duyệt).

Ca bắt buộc:
1. Đơn mới: đặt đơn storefront có email. Chi nhánh có email nhận mail "đơn mới" trong Mailpit; khách nhận biên nhận có liên kết `#t=`; Lịch sử gửi có 2 dòng `Đã gửi`.
2. Đổi trạng thái: nhận đơn, báo sẵn sàng, giao xong. Khách nhận từng mail; Lịch sử gửi có dòng tương ứng.
3. Hoãn giờ (accept-and-delay) gửi mail giờ mới. Hủy đơn gửi mail hủy. `notifyCustomer = false` không gửi.
4. Chi nhánh chưa có email: Lịch sử gửi hiện banner cảnh báo và nêu tên chi nhánh; đặt đơn không tạo mail nhân viên.
5. Khách chỉ có SĐT (kết quả theo V2): ghi hành vi thực tế. Nếu vẫn không có dấu vết, mở một mục theo dõi (xem "Việc theo dõi sau R1").
6. Sửa mẫu mail trong Admin (Settings → Mẫu email): mail kế tiếp dùng nội dung mới; mẫu hỏng thì mail vẫn đi bằng mặc định và có alert `notification-template-broken`.
7. Tắt email (`notifications.email.enabled = false`): đơn vẫn tạo, Lịch sử gửi hiện dòng `Bỏ qua` với lý do "Email chưa bật".
8. Gửi lỗi (tắt Mailpit): đơn vẫn tạo, dòng `Lỗi`; bật lại Mailpit, outbox thử lại và dòng chuyển `Đã gửi` (hoặc ghi rõ nếu không).
9. Chế độ `allowlist` (bước 2): người ngoài danh sách `Bỏ qua` lý do "Chế độ thử"; banner hiển thị ở Lịch sử gửi, Kênh thông báo và Providers.
10. Hạn mức theo giờ Việt Nam (bước 1): xem số "Hạn mức hôm nay" ở Lịch sử gửi và Kênh thông báo; thay `ORDERING_NOTIFY_TIMEZONE` và khởi động lại thì ngày tính đổi theo.
11. Phân quyền: role không có `notification-log.read` không thấy mục "Lịch sử gửi"; `Quản lý` có `read` không có `details` thấy bảng nhưng không thấy lỗi kỹ thuật; Super Admin thấy đủ.
12. Zalo và SMS tắt: Settings → Kênh thông báo cho thấy hai kênh "chưa cấu hình", chuỗi mặc định `email`, không có dòng nào của hai kênh.

Verification: file checklist tồn tại và khớp danh sách; chạy tự động: `node scripts/ordering/notifications.mjs`, `email-templates.mjs`, `customer-auth.mjs`, `alerts-engine.mjs`.

### Bước 5. R1d: email vào được hộp thư (checklist vận hành, không code)

Điền và ghi kết quả vào `docs/resend-email-operations.md` mục "Ownership (fill before launch)" và một mục mới "Kiểm trước khi ra mắt":
1. Tài khoản Resend, gói, người sở hữu (điền bảng Ownership). Xác minh tên miền gửi trong Resend: bản ghi DKIM và SPF ở trạng thái Verified.
2. Bản ghi DMARC cho tên miền gửi tồn tại (tối thiểu `p=none` kèm địa chỉ nhận báo cáo; mức chặt hơn cần chủ dự án quyết).
3. Biến môi trường production: `EMAIL_SMTP_HOST=smtp.resend.com`, cổng 587/2587/465, `EMAIL_SMTP_USER=resend`, `EMAIL_SMTP_KEY=re_...`, `EMAIL_SENDER_DOMAIN`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO` thuộc tên miền gửi, `ORDERING_ORDER_LINK_TEMPLATE` trỏ đúng trang đơn của web thật. Không commit giá trị.
4. Email chi nhánh đã nhập cho từng chi nhánh (Admin → Chi nhánh), banner "thiếu email" ở Lịch sử gửi biến mất.
5. Gửi thử từ production thật tới ít nhất một hộp Gmail và một hộp Outlook: mail vào Hộp thư đến (không phải Thư rác). Ghi lại tiêu đề kết quả `Authentication-Results` (SPF, DKIM, DMARC đều pass; chụp hoặc chép các dòng này, **không** chép địa chỉ riêng). Nếu vào Thư rác: dừng, kiểm lại bản ghi và nội dung, báo chủ dự án.
6. Reply-To: trả lời một mail đơn hàng và xác nhận thư đến đúng hộp hỗ trợ.

Đây là việc của chủ dự án hoặc người quản trị tên miền; AI chỉ viết checklist và điền phần code map nếu thiếu.

### Bước 6. Tài liệu và đóng gói

Cập nhật trong cùng thay đổi (theo ma trận tài liệu của `AGENTS.md`):
- `docs/STATUS.md`: mục mới đầu file (ngày, nhánh, trạng thái chính xác theo tiêu chuẩn: `implemented` / `automated verification passed` / `ready for manual UAT`), chỗ còn mở.
- `docs/admin-roles.md`: mục "Notification log permissions" (hai quyền, mặc định Super Admin, cách cấp cho `Quản lý`, checklist UAT quyền).
- `docs/ordering-ops-runbook.md`: biến mới `ORDERING_NOTIFY_TIMEZONE`, `ORDERING_NOTIFY_MODE`, `ORDERING_NOTIFY_ALLOWLIST`, checklist staging.
- `docs/ordering-staff-guide.md`: mục "Lịch sử gửi" cho nhân viên và owner (đọc bảng, ý nghĩa trạng thái, banner thiếu email).
- `docs/ordering-admin-openapi.json`: sinh lại.
- `docs/plans/notification-core-overview.html`: chỉnh mục 12.1 cho khớp kết quả (R1a nhỏ hơn dự kiến vì guard SMTP đã có; R1b chỉ đọc, không có "Gửi lại" và không hiển thị địa chỉ che bớt; thêm R1e).
- File này: điền "Completion record".

## Data and rollback

- Không có migration, không đổi schema bảng. Rollback = revert commit; cấu hình mới có mặc định giữ nguyên hành vi (trừ múi giờ hạn mức, đã chốt).
- Plugin store `paid-daily-usage` giữ ngày kiểu UTC cũ: code nạp lại từ số dòng đã gửi khi ngày khác khớp, nên không cần dọn.
- Tắt nhanh chế độ thử: đặt `ORDERING_NOTIFY_MODE=live` và khởi động lại.

## Security and privacy

- Không có địa chỉ trong bảng, log, response, báo cáo R0 hay file kiểm. Báo cáo R0 che địa chỉ nếu phải trích.
- `lastError` có thể chứa mã lỗi nhà cung cấp: chỉ trả qua route `/technical`, route này đòi `notification-log.details` (403 khi thiếu).
- `NOTIFICATION_BLOCKED` không chứa giá trị người nhận. Danh sách `allowlist` không bao giờ được trả qua API, chỉ trả số lượng.
- Guard chặn trước khi tốn suất hạn mức tính phí.
- Banner thiếu email chỉ liệt kê chi nhánh trong phạm vi của người gọi.

## Manual UAT và các cổng còn mở

- UAT tay: bước 4 (chủ dự án).
- Bên ngoài: bước 5 (tên miền, Resend, hộp Gmail/Outlook).
- Quyết định D1-D4.
- Zalo ZNS, SMS: tắt, thuộc R4.

## Việc theo dõi sau R1 (ghi nhận, không làm ở đây)

- R2: mở danh sách kênh thành adapter động, cấu hình khóa kênh trong Admin, adapter webhook, Telegram, Messenger.
- R3: người nhận nhân viên theo (event, vai trò, chi nhánh), nhiều kênh.
- Khách chỉ có SĐT khi chuỗi chỉ có `email`: hiện không có dấu vết (A2). Cân nhắc ghi dòng `skipped` với lý do `no-address` để Lịch sử gửi thấy được, và/hoặc tự thêm kênh SĐT vào chuỗi. Cần quyết định riêng vì đổi hành vi ghi `notification-delivery`.
- Nhật ký gửi không có job dọn: bảng sẽ lớn dần. Cần chính sách giữ (đề xuất 90 ngày) và có thể thêm index theo `created_at`.
- Nút "Gửi lại" (D3), alert "gửi lỗi liên tục", xuất CSV nhật ký.
- Hợp nhất thông báo form liên hệ và đặt bàn vào cùng đường gửi (R5).

## Điều lệch kế hoạch

(AI thực hiện ghi vào đây: điều đã thấy khác kế hoạch, cách đã xử lý, hoặc cần chủ dự án quyết.)

- **Worktree thiếu `.env`** (bước 0). Đã copy `.env` từ `salanca-backend` theo quyết định của chủ dự án; file gitignored, không đụng file tracked.
- **V1 (duyệt Admin) và V9 (chụp ảnh) cần trình duyệt** (bước 0) — quy tắc vận hành cấm UAT trình duyệt. Đã thay bằng bằng chứng code + mô tả bố cục; phần duyệt/ảnh chuyển chủ dự án (thuộc bước 4).
- **`budget-day.ts` xuất thêm `notificationDayStartFor(day, timezone)`** (bước 1, dùng lại ở bước 3 để lấy mốc 00:00 của một ngày bất kỳ); `notificationDayStart` gọi lại hàm này. Không đổi hành vi đã kiểm.
- **`NOTIFICATION_BLOCKED` chưa có trong `OrderingErrorCode`** (bước 2) → đã thêm vào union + bảng status (403). Bắt buộc để ném lỗi theo đặc tả.
- **Trang Providers lấy dữ liệu `/ordering/providers`** (bước 2) → thêm `notificationMode` / `notificationAllowlistCount` vào `provider-status` để hiện banner. Endpoint này không khai response schema trong OpenAPI nên không cần sửa OpenAPI.
- **404 của nhật ký gửi** (bước 3): đặc tả ghi `NOT_FOUND`, nhưng repo không có mã chung. Đã dùng `NOTIFICATION_DELIVERY_NOT_FOUND` (404) theo mẫu `AUDIT_ENTRY_NOT_FOUND`. **Cần chủ dự án xác nhận** nếu muốn đúng chữ `NOT_FOUND` (không đổi phạm vi/bảo mật/dữ liệu).
- **`summary.byChannel`** (bước 3) trả cố định 3 kênh chuẩn (`zalo`, `sms`, `email`), kênh không có dòng trong 24h nhận 0; `branchesWithoutEmail` lọc `is_active = true` và email null/rỗng/khoảng trắng.
- **Id của route chi tiết phải parse chặt, `positiveInt` không đủ** (bước 3, sửa sau review). Đặc tả nói dùng `positiveInt(...)` như `audit-log.ts`; nhưng `Number.parseInt('1.5', 10)` = `1`, nên `positiveInt` một mình sẽ trả **row 1** cho `/notification-log/1.5` — mà harness truncate bảng bằng `RESTART IDENTITY` nên id 1 có thật trong lượt test, tức ca `'1.5' → 404` sẽ đỏ. Đã parse canonical (`/^\d+$/`) rồi mới đổi sang số, chặn thêm trên `2147483647` (giới hạn cột `integer`), và id sai **ném `NOTIFICATION_DELIVERY_NOT_FOUND` ngay ở controller** nên không chạm DB. Bảy id × hai route được thêm vào `notification-log.mjs` (mục 13). Không đổi route, quyền hay OpenAPI (hai route chỉ khai `parameters: [pathParam('id')]`, không khai schema lỗi).
- **`uat-server.mjs` không gửi mail ra ngoài** (bước 4). Đặc tả bước 4 nói "chạy bằng `uat-server.mjs` với Mailpit ở cổng 1025", nhưng `uat-server.mjs` boot qua `configureTestEnvironment()` với `ORDERING_TEST_BUILTINS=true`, và chế độ đó (a) đăng ký **bản capture email trong bộ nhớ** (`providers/email-notification.ts`) thay cho provider đi qua email plugin — Mailpit/SMTP **không** nhận gì, nội dung mail không xem được; (b) đặt `jobs.enabled = false` (`config/plugins.ts`) nên **cron tắt**, không có gì tự chạy outbox. Hệ quả cho checklist: màn **Lịch sử gửi** vẫn kiểm được đầy đủ (trạng thái, lý do, banner, quyền), nhưng **nội dung** mail phải kiểm ở lượt chạy khác. `notification-release-uat.md` vì vậy tách **Phần A** (server UAT: màn hình, trạng thái, lý do, quyền, banner; sau mỗi thao tác phải bấm **Chạy ngay** job `outbox`) và **Phần B** (Mailpit, chạy `pnpm run develop` không đặt `ORDERING_TEST_BUILTINS`, do chủ dự án thực hiện — AI chưa chạy qua).
- **Role seed của UAT chưa có quyền mới** (bước 4). `lan-q1`, `quan-ly-chuoi`, `ketoan`, `giao-q1` dùng role `UAT ordering …` với danh sách action cứng từ O3 — **không** có `notification-log.read`/`details`, cũng không có `ops.read`. `UAT manager` (`quanly-q1`) có cả hai quyền mới nhưng **thiếu `ops.read`** (nên không bấm được **Chạy ngay** ở trang Vận hành). Checklist yêu cầu tick ba quyền này ở Settings → Roles trước khi chạy, giữ bước 4 là bước tài liệu (không sửa `uat-server.mjs`). Nếu chủ dự án muốn UAT chạy một phát không cần tick tay: thêm ba mã vào mảng `actions` của role O3 và (hoặc) vào `ORDERING_ACTIONS` cho role manager — một thay đổi nhỏ trong script, không đụng code sản phẩm.
- **`resend-email-operations.md` trước đây chỉ nói về form lead** (bước 5). Đã mở phạm vi ở dòng đầu để gồm cả mail của plugin bán hàng (R1b/R1d), thêm ba dòng vào bảng Ownership (hộp thư chi nhánh, bản ghi DMARC, trang đơn của `ORDERING_ORDER_LINK_TEMPLATE`) và bốn dòng vào Code map cho đường gửi của plugin.

## Completion record

**Trạng thái (2026-10-15): implemented + automated verification passed, ready for manual UAT.** Chưa commit gì trên nhánh
(quy ước: chủ dự án nói mới commit) — cột cuối là subject gợi ý cho lần commit đó.

| Bước | Nội dung | Trạng thái | Commit gợi ý |
|---|---|---|---|
| 0 | Báo cáo R0 (không commit, nằm trong `artifacts/`) | xong | không có |
| 1 | Hạn mức ngày theo múi giờ cấu hình | implemented | `feat(ordering): notification daily limit follows a configurable timezone` |
| 2 | Chế độ allowlist cho môi trường thử | implemented | `feat(ordering): notification allowlist mode for test environments` |
| 3 | Màn Lịch sử gửi (chỉ đọc) và cảnh báo thiếu email chi nhánh | implemented; sửa thêm lỗi id sau review | `feat(ordering): notification delivery log screen` |
| 4 | Checklist UAT ([`notification-release-uat.md`](notification-release-uat.md)) | xong file — UAT tay do chủ dự án chạy | `docs(ordering): notification release UAT checklist` |
| 5 | Checklist email vào hộp thư (mục "Kiểm trước khi ra mắt" của [`../resend-email-operations.md`](../resend-email-operations.md)) | xong file — giá trị do chủ dự án điền | `docs: email deliverability checklist before launch` |
| 6 | Tài liệu, OpenAPI, STATUS | xong | `docs(ordering): notification release record` |

Gate đã chạy thật (2026-10-15, DB riêng `salanca_ordering_notify_review`; chạy tuần tự):

| Lệnh | Kết quả |
|---|---|
| `pnpm run lint` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run typecheck:admin` | exit 0 |
| `pnpm run build:ordering` | exit 0 |
| `pnpm exec vitest run src/plugins/ordering/server/src/domain/notifications src/plugins/ordering/admin config` | **24 file / 173 test pass** |
| `node scripts/ordering/notification-log.mjs` | exit 0 (mục 13 mới: 7 id sai × 2 route → 404 `NOTIFICATION_DELIVERY_NOT_FOUND`, log không có lỗi Postgres) |
| `node scripts/ordering/notifications.mjs` | exit 0 |
| `node scripts/ordering/notify-budget-day.mjs` | exit 0 |
| `node scripts/ordering/notify-guard.mjs` | exit 0 |
| `node scripts/ordering/customer-auth.mjs` | exit 0 |
| `node scripts/ordering/cart-reminder.mjs` | exit 0 |
| `node scripts/ordering/loyalty-expiry.mjs` | exit 0 |
| `node scripts/ordering/email-templates.mjs` | exit 0 |
| `node scripts/ordering/alerts-engine.mjs` | exit 0 (dùng cho phần "Verification" của bước 4) |
| `pnpm run ordering:openapi` | ghi lại `docs/ordering-admin-openapi.json` (**150 path**) |
| `node scripts/ordering/openapi.mjs` | exit 0 (script này tự dùng DB mặc định `salanca_ordering_test`) |
| `git diff --check` | exit 0 |

**Không** sửa một dòng kỳ vọng test cũ nào: 5 script thông báo cũ (`notifications`, `customer-auth`, `cart-reminder`,
`loyalty-expiry`, `email-templates`) xanh nguyên trạng — đây là phép thử rằng Proxy ở registry giữ nguyên `capture.sent`
và `capture.failNext`. Theo quy ước gate gọn của nhánh, **không** chạy `check:ordering` đầy đủ, `check:phase3` hay smoke
(repo chưa có CI, nên bảng trên là bằng chứng duy nhất).

**Việc chưa làm / còn mở**

- UAT tay Phần A + Phần B của `notification-release-uat.md`: chủ dự án (AI không UAT trình duyệt).
- Bước 5/R1d: tên miền gửi, DKIM/SPF/DMARC, gửi thử Gmail + Outlook, Reply-To — chủ dự án/người quản trị tên miền.
- Quyết định D1–D4. D4 (chỉ Super Admin có `notification-log.details`) đã ghi theo đề xuất; D3 (không có nút "Gửi lại")
  đã thực hiện, chờ chủ dự án xác nhận khi đọc lại.
- Phần B của checklist UAT chưa chạy thử lần nào (chưa có Mailpit + server dev trong phiên này).
- Chưa commit.

**File ngoài phạm vi**: không đụng — cây làm việc vẫn đúng tập file của bước 0–6 (`git status --short`), `.env` và `dist/`
không được commit (gitignored). Một việc có ghi nhận: file thăm dò của lượt review `artifacts/notification-release/review-probe-id.mjs`
đã được **chuyển ra ngoài repo** (scratchpad của phiên) vì `eslint .` quét cả `artifacts/` và file đó làm `pnpm run lint` đỏ;
`artifacts/notification-release/r0-report.md` giữ nguyên.
