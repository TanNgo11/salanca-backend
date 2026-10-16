# UAT tay phần thông báo (R1c) — release Salanca

Status: chờ chủ dự án chạy
Người thực hiện: chủ dự án (quy ước repo: AI **không** làm UAT giao diện trên trình duyệt)
Last updated: 2026-10-15
Liên quan: [`notification-release-r1.md`](notification-release-r1.md) (bước 4) ·
[`notification-core-overview.html`](notification-core-overview.html) §12.1 ·
[`../ordering-ops-runbook.md`](../ordering-ops-runbook.md) §"Môi trường thử" ·
[`../ordering-staff-guide.md`](../ordering-staff-guide.md) §"Lịch sử gửi" ·
[`../resend-email-operations.md`](../resend-email-operations.md) §"Local capture"

Phạm vi: màn **Lịch sử gửi** (R1b), chế độ `allowlist` (R1a), hạn mức theo giờ Việt Nam (R1e), hai quyền mới,
banner thiếu email chi nhánh. Kênh bật khi release: **email**. Zalo và SMS vẫn tắt.

## 0. Dựng môi trường

1. Build (script chạy trên bản đã build):

```powershell
pnpm run build:ordering
```

2. Khởi động server UAT trên DB riêng và cổng riêng (không dùng DB của `check:ordering`):

```powershell
$env:ORDERING_TEST_DATABASE = 'salanca_ordering_notify_uat'
$env:UAT_PORT = '1356'
node scripts/ordering/uat-server.mjs
```

Script in danh sách tài khoản (mật khẩu dùng chung) ở đầu log; đặt `UAT_CRED_FILE=<file ngoài repo>` nếu muốn lưu lại.
Admin: `http://127.0.0.1:1356/admin`. Dừng server: tắt tiến trình đang nghe cổng 1356.

3. **Quyền cho các tài khoản UAT.** Seed gán quyền theo role, và hai role khác nhau ở hai quyền mới
   (`notification-log.read` "Xem lịch sử gửi thông báo", `notification-log.details` "Xem chi tiết lỗi gửi thông báo"):

   | Tài khoản | Role seed | Có `read` | Có `details` | Dùng cho |
   |---|---|---|---|---|
   | `quan-ly-chuoi` (mọi chi nhánh), `lan-q1` (chỉ Q1) | `UAT ordering …` (danh sách quyền tường minh) | **Không** | **Không** | Ca 1-10, 12: **phải** vào Settings → Roles → `UAT ordering …` và tick cả `read` lẫn `details` trước khi bắt đầu |
   | `quanly-q1` (chỉ Q1) | `UAT manager …` (mọi quyền trừ `ops.read`) | **Có** | **Có** | Kiểm phạm vi: banner và bảng chỉ có chi nhánh Q1 |
   | `ketoan` (kế toán, mọi chi nhánh) | `UAT accountant …` | Không | Không | Ca 11 bước 1 (không thấy menu, 403) |

   Seed lấy danh sách từ `scripts/ordering/_harness.mjs` (`ORDERING_ACTIONS`) cho role `UAT manager`, nên role này đã có
   cả hai quyền ngay khi boot, còn `UAT ordering` thì chưa. Ca 11 bước 2 (có `read`, không `details`) cần bạn **bỏ**
   `notification-log.details` thủ công khỏi một role. Không còn cần quyền `ops.read` ở đâu cả.

4. **Nhập email nhận đơn mới cho Chi nhánh Q1** (Bán hàng → Cấu hình → Chi nhánh → Q1). UAT seed để trống email chi nhánh,
   nên nếu bỏ bước này thì ca 1 sẽ im lặng không có dòng `staff.order-created` — đó là ca 4, không phải ca 1. Dùng địa chỉ test
   nào cũng được (ví dụ `q1-staff@example.invalid`).

5. Ba điều phải biết trước khi tick, nếu không sẽ tick sai:

   a. **Outbox tự chạy mỗi 2 giây.** Chế độ `ORDERING_TEST_BUILTINS=true` của `uat-server.mjs` tắt cron
      (`jobs.enabled=false` trong `config/plugins.ts`), nhưng chính server này tự bơm outbox bằng
      `setInterval(pumpOutbox, 2000)` (cuối `scripts/ordering/uat-server.mjs`). Vì vậy **không cần** bấm "Chạy ngay" job
      `outbox`: sau mỗi thao tác tạo đơn hoặc đổi trạng thái, đợi vài giây rồi bấm **Lọc** ở Lịch sử gửi. Mail lỗi được thử
      lại ở các lượt bơm kế tiếp theo lịch của outbox.
   b. **Mail không gửi thật.** Cùng chế độ trên, provider email của plugin là bản capture **trong bộ nhớ**
      (`providers/email-notification.ts`). Mailpit/SMTP **không** nhận gì và nội dung mail không xem được trong server này.
      Vì vậy Phần A kiểm trạng thái/lý do/quyền/banner (đều quan sát được), còn nội dung mail thật kiểm ở **Phần B**.
   c. **Địa chỉ người nhận không được lưu.** Màn chỉ hiện **vai trò + kênh**; đừng mong thấy email/số điện thoại ở bất kỳ cột nào.

6. Ghi kết quả vào bảng ở mục 1 (Phần A) và mục 3 (Phần B). Dòng "Không đạt" phải kèm ảnh chụp hoặc tên request trong log.

## 1. Phần A — bảng tick (chạy trên server UAT)

| # | Ca | Kết quả mong đợi (tóm tắt) | Đạt | Ghi chú |
|---|---|---|---|---|
| 1 | Đơn mới, khách có email | 2 dòng cho đơn đó: `customer.order-placed` + `staff.order-created`, Kênh Email, Trạng thái **Đã gửi**, Lý do trống | ☐ | |
| 2 | Đổi trạng thái đơn | Mỗi bước (nhận → sẵn sàng → giao xong) sinh dòng tương ứng cho khách | ☐ | |
| 3 | Hoãn giờ, hủy đơn, `notifyCustomer = false` | Hoãn/c hủy có dòng; `notifyCustomer = false` **không** sinh dòng cho khách | ☐ | |
| 4 | Chi nhánh chưa có email | Banner cảnh báo nêu tên chi nhánh; đặt đơn **không** có dòng `staff.order-created` | ☐ | |
| 5 | Khách chỉ có SĐT | Đơn vẫn tạo; ghi lại hành vi thật (kỳ vọng: không dòng nào, không mail) | ☐ | |
| 6 | Sửa mẫu email | Mail kế tiếp dùng nội dung mới; mẫu hỏng → vẫn gửi bằng mặc định + alert | ☐ | |
| 7 | Tắt email (`email.enabled=false`) | Đơn vẫn tạo; dòng **Bỏ qua**, Lý do "Email chưa bật (chưa cấu hình SMTP)" | ☐ | |
| 8 | Gửi lỗi rồi thử lại | Có dòng **Lỗi**; sau khi sửa nguyên nhân, outbox thử lại và dòng chuyển **Đã gửi** (hoặc ghi rõ nếu không) | ☐ | |
| 9 | Chế độ `allowlist` | Người ngoài danh sách **Bỏ qua** lý do "Chế độ thử"; banner vàng hiện ở 3 màn | ☐ | |
| 10 | Hạn mức theo giờ Việt Nam | Số "Hạn mức tính phí hôm nay" đúng; đổi `ORDERING_NOTIFY_TIMEZONE` thì ngày tính đổi theo | ☐ | |
| 11 | Phân quyền | Không có `read` → không thấy mục menu + 403; có `read` không `details` → thấy bảng, không thấy lỗi kỹ thuật | ☐ | |
| 12 | Zalo và SMS tắt | Kênh thông báo: hai kênh "chưa cấu hình", chuỗi mặc định `email`, không dòng nào của hai kênh | ☐ | |

## 2. Chi tiết Phần A

### Ca 1 — Đơn mới (pickup, khách có email)

- **Điều kiện đầu:** đã làm 0.3 và 0.4; đăng nhập `quan-ly-chuoi`.
- **Thao tác:** 1) Tạo đơn ở Q1 (Tạo đơn hộ) cho khách **có email**. 2) Đợi vài giây (outbox tự chạy, 0.5a).
  3) Bán hàng → Cấu hình → **Lịch sử gửi**, để nguyên khoảng ngày mặc định (7 ngày gần nhất) và bấm **Lọc**.
- **Kết quả mong đợi:** đúng hai dòng cho đơn đó — `customer.order-placed` (Vai trò **Khách**) và `staff.order-created`
  (Vai trò **Nhân viên**), cả hai Kênh **Email**, Trạng thái **Đã gửi**, Lần thử `1`, cột **Lý do** trống.
  Cột **Đơn** hiện mã đơn và bấm được sang chi tiết đơn. Ô **Đã gửi 24h** tăng ít nhất 2.
  Dòng trong bảng **không** có cột địa chỉ người nhận (đúng thiết kế: bảng chỉ lưu hash).
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 2 — Đổi trạng thái đơn

- **Điều kiện đầu:** ca 1 xong.
- **Thao tác:** Trong chi tiết đơn: **Nhận đơn** → **Sẵn sàng** → **Giao và thu tiền** (hoặc các bước tương ứng với
  quy trình pickup). Sau mỗi bước, đợi vài giây rồi bấm **Lọc** ở Lịch sử gửi.
- **Kết quả mong đợi:** mỗi bước có thêm dòng cho **Khách** với mẫu tương ứng
  (`customer.order-accepted` / `customer.order-ready` / `customer.order-completed`), Trạng thái **Đã gửi**,
  cùng mã đơn ở cột Đơn. Cột **Giờ** tăng dần theo thao tác, dòng mới nhất nằm trên (sắp xếp giảm theo id).
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 3 — Hoãn giờ, hủy đơn, không thông báo khách

- **Điều kiện đầu:** ca 2 xong.
- **Thao tác:** 1) **Hoãn giờ** (accept-and-delay) một đơn → đợi vài giây. 2) Hủy một đơn khác → đợi vài giây.
  3) Đổi trạng thái một đơn với `notifyCustomer = false` (hộp thoại có ô thông báo khách) → đợi vài giây.
- **Kết quả mong đợi:** hoãn giờ sinh dòng mail giờ mới; hủy đơn sinh dòng mail hủy; bước (3) **không** sinh dòng nào cho
  khách. Lịch sử gửi không có dòng nào ở trạng thái **Đang chờ** treo lâu sau khi đã đợi outbox chạy.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 4 — Chi nhánh chưa có email nhận đơn

- **Điều kiện đầu:** xóa email của **Q3** (Bán hàng → Cấu hình → Chi nhánh → Q3), đăng nhập bằng tài khoản xem mọi chi nhánh.
- **Thao tác:** Mở **Lịch sử gửi**. Đặt một đơn ở Q3 cho khách có email → đợi vài giây.
- **Kết quả mong đợi:** banner cảnh báo hiện ở đầu màn, nêu **tên chi nhánh thiếu email** (Q3, và Q1 nếu bạn chưa nhập ở 0.4),
  kèm liên kết **Mở Chi nhánh**; khách vẫn có dòng `customer.order-placed` nhưng **không** có dòng `staff.order-created`.
  Nhập email cho Q3 xong, tải lại màn: banner biến mất. Lưu ý: đây là hành vi có chủ ý của release (không có địa chỉ thì
  không ghi dòng nào) — xem mục "Việc theo dõi sau R1" của kế hoạch.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 5 — Khách chỉ có số điện thoại

- **Điều kiện đầu:** ca 1 xong.
- **Thao tác:** Đặt một đơn ở Q1 cho khách **chỉ có SĐT** (không email) → đợi vài giây → lọc Lịch sử gửi theo mã đơn đó.
- **Kết quả mong đợi:** đơn tạo bình thường. Kỳ vọng hiện tại: **không có dòng nào** cho khách (chuỗi kênh mặc định chỉ có
  `email`, mà khách không có email thì `deliver()` bỏ qua kênh trước khi ghi dòng). Ghi lại đúng điều quan sát được —
  nếu không có dấu vết, đó là khe hở đã biết ở mục "Việc theo dõi sau R1" (cân nhắc lý do `no-address`), **không** phải lỗi của R1b.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 6 — Sửa mẫu email

- **Điều kiện đầu:** ca 1 xong.
- **Thao tác:** Bán hàng → Cài đặt bán hàng → **Mẫu email**: chọn `customer.order-placed` → VI → sửa **Tiêu đề** (thêm một
  chữ nhận ra được) → Lưu → đặt đơn mới → đợi vài giây. Sau đó sửa mẫu thành dữ liệu hỏng (ví dụ chèn biến không có trong
  danh sách) và thử lại.
- **Kết quả mong đợi:** dòng gửi mới vẫn **Đã gửi**; mẫu hỏng thì mail vẫn đi bằng nội dung mặc định và có alert
  `notification-template-broken` ở **Vận hành → Cảnh báo** (mẫu hỏng không làm mất mail khách).
  Nội dung tiêu đề mới kiểm được ở **Xem trước** trong màn Mẫu email; nội dung mail thật kiểm ở Phần B.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 7 — Tắt email

- **Điều kiện đầu:** ca 1 xong.
- **Thao tác:** Trong Admin bật `notifications.email.enabled = false` (config/env, cần khởi động lại server),
  đặt một đơn có email → đợi vài giây → xem Lịch sử gửi (lọc Trạng thái = **Bỏ qua**).
- **Kết quả mong đợi:** đơn vẫn tạo bình thường và **không** lỗi ở storefront; có dòng Trạng thái **Bỏ qua**,
  cột **Lý do** hiện "Email chưa bật (chưa cấu hình SMTP)". Bật lại về `true` sau khi kiểm.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 8 — Gửi lỗi rồi thử lại

- **Điều kiện đầu:** server UAT không có đường làm mail lỗi từ giao diện (provider là bản capture trong bộ nhớ).
  Ca này chạy ở **Phần B** (Mailpit). Trên server UAT chỉ kiểm được phần *hiển thị*: nếu Lịch sử gửi đang có dòng **Lỗi**
  (ví dụ đơn cũ, hoặc 55 dòng seed của script), mở **Chi tiết** xem dòng đó có `Lần thử` > 1 và Lý do trống (lỗi kỹ thuật
  nằm ở nút "Xem chi tiết kỹ thuật", không hiện ở bảng).
- **Kết quả mong đợi:** dòng **Lỗi** ở bảng không lộ `lastError`; nút kỹ thuật (ca 11) mới hiện lỗi thật.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 9 — Chế độ `allowlist` (R1a)

- **Điều kiện đầu:** khởi động lại server với chế độ thử **trước khi** boot:

```powershell
$env:ORDERING_TEST_DATABASE = 'salanca_ordering_notify_uat'
$env:UAT_PORT = '1356'
$env:ORDERING_NOTIFY_MODE = 'allowlist'
$env:ORDERING_NOTIFY_ALLOWLIST = '<email của bạn>,q1-staff@example.invalid'
node scripts/ordering/uat-server.mjs
```

- **Thao tác:** 1) Đặt đơn ở Q1 cho khách có email **không** nằm trong danh sách → đợi vài giây.
  2) Mở Lịch sử gửi, **Kênh thông báo** (Cài đặt bán hàng) và **Nhà cung cấp** (Cấu hình).
- **Kết quả mong đợi:** dòng của khách Trạng thái **Bỏ qua**, Lý do "Chế độ thử: người nhận không nằm trong danh sách cho phép";
  dòng `staff.order-created` **Đã gửi** (vì email chi nhánh có trong danh sách); **không** tốn suất hạn mức tính phí cho người
  bị chặn; log khởi động có dòng `notification mode: allowlist (N entries)` và **không** in nội dung mục.
  Banner vàng "Môi trường thử: chỉ gửi tới N người nhận trong danh sách cho phép" hiện ở **cả ba** màn trên.
  Thử thêm một mục sai định dạng ở `ORDERING_NOTIFY_ALLOWLIST` → app **dừng khởi động**, báo tên biến và vị trí mục,
  **không** in giá trị; và danh sách rỗng = chặn tất cả (có cảnh báo lúc khởi động).
  Sau ca này nhớ chạy lại **không** đặt `ORDERING_NOTIFY_MODE` (mặc định `live`) cho các ca khác.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 10 — Hạn mức theo giờ Việt Nam (R1e)

- **Điều kiện đầu:** server UAT, mode `live`.
- **Thao tác:** 1) Xem dải số ở Lịch sử gửi (ô **Hạn mức tính phí hôm nay**) và số tương ứng ở **Kênh thông báo**.
  2) Khởi động lại server với `$env:ORDERING_NOTIFY_TIMEZONE = 'UTC'`.
- **Kết quả mong đợi:** phụ đề màn ghi đúng múi giờ đang dùng ("Ngày tính theo múi giờ Asia/Ho_Chi_Minh", sau khi đổi là `UTC`);
  số đếm ngày của hạn mức đổi theo múi giờ mới (bộ đếm cũ không khớp ngày mới thì được nạp lại từ số dòng đã gửi). Múi giờ sai →
  app dừng khởi động với tên biến `ORDERING_NOTIFY_TIMEZONE`. Kiểm nhanh phần tính ngày (không cần trình duyệt):
  `node scripts/ordering/notify-budget-day.mjs`.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 11 — Phân quyền màn Lịch sử gửi

- **Điều kiện đầu:** 0.3 xong. Dùng `ketoan` cho bước 1. Cho bước 2-3, dùng role `UAT ordering …` (đã tick cả `read` và `details`);
  bước 2 bỏ `details` khỏi **chính role đó** rồi đăng nhập lại bằng `quan-ly-chuoi`.
- **Thao tác:** 1) Đăng nhập `ketoan` (không có `notification-log.read`) → xem menu và mở thẳng `/plugins/ordering/notification-log`.
  2) Vào Settings → Roles → `UAT ordering …`, **bỏ** `notification-log.details` → đăng nhập lại bằng `quan-ly-chuoi` → mở một dòng **Lỗi** → bấm **Chi tiết** → bấm
  **Xem chi tiết kỹ thuật**. 3) Tick lại đủ cả hai quyền → mở lại cùng dòng đó.
- **Kết quả mong đợi:** (1) `ketoan` **không** thấy mục **Lịch sử gửi** trong nhóm Cấu hình và nhận 403 khi mở URL trực tiếp.
  (2) Thiếu `details`: vẫn thấy bảng và mở được modal, nhưng **không** có nút kỹ thuật, modal ghi "Bạn không có quyền xem chi tiết
  kỹ thuật." (server cũng từ chối `/notification-log/:id/technical` bằng 403). (3) Có đủ: nút hiện, bấm ra khối **Lỗi kỹ thuật**,
  **Mã tin nhà cung cấp**, **Chi phí (ước tính)** (số VND, có chữ "ước tính"). Super Admin luôn thấy đủ.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

### Ca 12 — Zalo và SMS vẫn tắt

- **Điều kiện đầu:** server UAT không đặt env Zalo/eSMS.
- **Thao tác:** Mở **Cài đặt bán hàng → Kênh thông báo** và **Cấu hình → Nhà cung cấp**; xem Lịch sử gửi.
- **Kết quả mong đợi:** kênh Zalo và SMS hiện trạng thái **chưa cấu hình**; chuỗi kênh mặc định của mọi mẫu vẫn là `email`;
  bộ lọc **Kênh** chọn Zalo hoặc SMS trả bảng rỗng; không có dòng nào mang hai kênh đó.
- **Ghi chú:** ☐ Đạt ☐ Không đạt —

## 3. Phần B — nội dung mail thật qua Mailpit (tuỳ chọn)

Phần A **không** xem được nội dung mail vì provider là bản capture trong bộ nhớ (0.5b). Muốn kiểm nội dung (tiêu đề, thân,
liên kết `#t=`) và đường gửi lỗi → thử lại, chạy một server **không** đặt `ORDERING_TEST_BUILTINS` và trỏ SMTP vào Mailpit:

```powershell
# .env (hoặc biến môi trường): SMTP local, theo resend-email-operations.md §"Local capture"
#   EMAIL_SMTP_HOST=localhost
#   EMAIL_SMTP_PORT=1025
#   EMAIL_FROM_ADDRESS=no-reply@salanca.local
#   EMAIL_REPLY_TO=booking@salanca.local
pnpm run develop   # build ordering rồi strapi develop — DB dev của CMS (salanca_cms)
```

Mailpit: `http://127.0.0.1:8025`. Cách này chạy trên DB dev của CMS; nếu muốn tránh, đặt `DATABASE_NAME` sang một DB trống
trước khi chạy. Đây là lượt chạy của chủ dự án, AI chưa chạy qua.

| # | Ca | Kết quả mong đợi | Đạt | Ghi chú |
|---|---|---|---|---|
| B1 | Mail đơn mới cho chi nhánh và biên nhận cho khách | Mailpit có thư "đơn mới" tới email Q1 và biên nhận tới email khách; biên nhận có liên kết `/...#t=<token>` | ☐ | |
| B2 | Tắt Mailpit rồi gửi lại | Đơn vẫn tạo; dòng **Lỗi** (Lần thử tăng); bật Mailpit lại, outbox thử lại và dòng chuyển **Đã gửi** (ghi rõ nếu không) | ☐ | |
| B3 | Reply-To | Trả lời mail đơn hàng → thư đi tới hộp `EMAIL_REPLY_TO` | ☐ | |

Phần B trùng một phần với bước 5 (R1d — email vào được hộp thư trên production); ở đây chỉ kiểm trên Mailpit.

## 4. Ghi nhận lượt chạy

| Ngày | Người chạy | Nhánh / commit | DB + cổng | Phần A | Phần B |
|---|---|---|---|---|---|
| | | | `salanca_ordering_notify_uat` :1356 | /12 | /3 |

Lệnh tự động chạy kèm bước này (exit 0 mới coi là xong; cần `pnpm run build:ordering` trước):

```powershell
node scripts/ordering/notifications.mjs
node scripts/ordering/email-templates.mjs
node scripts/ordering/customer-auth.mjs
node scripts/ordering/alerts-engine.mjs
```

## 5. Không thuộc phạm vi bước này

- UAT trên production và tên miền gửi thật (SPF/DKIM/DMARC, Gmail/Outlook) — bước 5 (R1d).
- Zalo ZNS và SMS thật — R4, cần OA và mẫu đã duyệt.
- Nút "Gửi lại" trong Lịch sử gửi: **không** có trong release (quyết định D3); gửi lỗi đã được outbox thử lại tự động.
- Xuất CSV nhật ký gửi, alert "gửi lỗi liên tục", job dọn nhật ký cũ — mục "Việc theo dõi sau R1".
- Thông báo form liên hệ và đặt bàn (`src/domain/form-intake`) — hệ khác, không dùng chế độ `allowlist` của plugin.
