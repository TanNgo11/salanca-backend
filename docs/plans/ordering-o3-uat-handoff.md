# Prompt: UAT Phase O3 (tự lấy + tiền mặt + hộp đơn)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`, nhánh `feat/ordering-o3` (đã code xong O3, automated
verification đạt; **chưa push, chưa merge**). Nhiệm vụ: **UAT thủ công trên Chrome** các màn Admin và API công khai
của O3, sửa lỗi tìm thấy, báo cáo. Không thêm tính năng mới.

## Đọc trước

1. `docs/phases/phase-ordering-3-pickup-cash.md`: mục "Manual UAT", "Acceptance thêm" (3 chỗ).
2. `docs/plans/ordering-o3-screens.md`: S1–S9 và mục "Đã đổi khi code O3".
3. `docs/plans/ordering-o3-pickup-cash.md`: Completion record (việc còn mở).
4. `docs/ordering-api-contract.md`, `docs/ordering-staff-guide.md`, `docs/admin-roles.md` (mục Ordering).

## Quy tắc bắt buộc

- Chỉ dùng DB `salanca_ordering_test`. Không chạm `salanca_cms` hay production. **Không chạy `pnpm export:cms-seed`.**
  Không chạy `smoke:reservation-form` mà không đặt `DATABASE_NAME=salanca_ordering_test` (mặc định nó ghi vào DB dev).
- Không in mật khẩu/token ra chat. Không log dữ liệu cá nhân.
- Mỗi lỗi sửa: test liên quan + một commit `fix(ordering): ...` (kết thúc bằng dòng `Co-Authored-By` theo quy ước repo).
  Không push.
- Không dùng `git stash` trần.

## Dựng môi trường UAT

```bash
pnpm run build:ordering
ORDERING_ENABLED=true pnpm exec strapi build          # build lại admin sau mỗi lần sửa UI
UAT_CRED_FILE=<file tạm ngoài repo> node scripts/ordering/uat-server.mjs   # cổng 1350
```

`uat-server.mjs` xóa sạch bảng ordering của test DB, tạo chi nhánh Q1/Q3 (tự lấy 24/7, chuẩn bị 30 phút, slot 30
phút, sức chứa 4), catalog thật (Bún bò Huế 100.000 có topping Chả cua +15.000, Combo trưa 99.000, Trà đào 45.000) và
hai tài khoản Admin test: `lan-q1` (chỉ Q1) và `quan-ly-chuoi` (mọi chi nhánh). Email và mật khẩu ghi vào
`UAT_CRED_FILE`. Captcha test nhận token `pass`; email được giữ trong bộ nhớ (không gửi thật). Dừng server: tắt tiến
trình đang nghe cổng 1350. Chạy lại server = dữ liệu mới, phải đăng nhập lại (đăng xuất trước; cookie cũ tự đăng nhập
user cũ đã mất scope).

Đặt đơn khách bằng **node `fetch`** (curl trong Git Bash làm hỏng dấu tiếng Việt):

```js
fetch('http://127.0.0.1:1350/api/v1/ordering/orders', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'uat-' + Date.now() },
  body: JSON.stringify({ branch: 'Q1', locale: 'vi', lines: [{ sellableUid: '<id từ GET /catalog/products?location=Q1>', quantity: 1 }],
    receiveMethod: { kind: 'pickup' }, contact: { name: 'Ngọc', phone: '0901234567', email: 'guest@example.invalid' },
    consent: { policyVersion: 'v1', accepted: true }, customerNote: 'Lấy giúp 2 bộ đũa', captchaToken: 'pass' }) })
```

## Đã kiểm (2026-10-11, session trước) — chỉ cần kiểm lại nhanh

- Hộp đơn S1: tab có số đếm, lọc chi nhánh (chỉ Q1 với `lan-q1`), dòng mới tô vàng, đơn Q3 không lọt.
- Hộp thoại đơn mới S2 hiện ở trang khác (Chi nhánh); "Nhận và lùi 20 phút" → giờ sẵn sàng = đặt + 30 + 20.
- Chi tiết S4: Sẵn sàng (hộp thoại ghi chú + "Báo khách"), **Thu tiền và giao** (Đã giao, Đã trả, dòng tiền mặt có tên
  nhân viên), Hủy món sau khi đã thu (hoàn đúng số xem trước), Hoàn tiền mặt mở được.
- Xem nhanh S3, Chi nhánh S7 (tab Tự lấy), Nhân viên S8 (badge "Chưa gán"), Cài đặt S9, Tạo đơn hộ S6 (chọn topping,
  server báo giá 115.000, xác nhận → chi tiết "Gọi điện").

## Đã sửa ở commit `2d7c37a`, **chưa kiểm lại trên trình duyệt**

1. Từ chối / Nhận và lùi trong hộp thoại đơn mới giờ là panel nút (trước đó menu trong modal làm treo trang).
2. Mở URL đơn Q3 bằng `lan-q1` phải hiện "Không tìm thấy đơn" (trước hiện "Không tải được đơn").
3. Lưu nháp đơn hộ không được bật hộp thoại đơn mới; xác nhận nháp thì đơn vào hàng chờ.
4. Lịch sử hiện "Hủy món", "Đã hoàn tiền" thay cho mã thô.
5. Hộp thoại Hủy món không treo (preview chỉ gọi lại khi đổi số lượng).

Ghi chú: trang từng bị treo 2–3 lần khi mở modal sau một loạt thao tác; chưa xác định chắc nguyên nhân ngoài 2 lỗi đã
sửa ở trên. Nếu còn treo: ghi lại đúng chuỗi thao tác, kiểm console (`read_console_messages`) và log server.

## Còn phải UAT

- [ ] Điều hướng mới (commit gom menu): sidebar chính chỉ có "Bán hàng"; menu con Vận hành / Món / Cấu hình; link ẩn
      theo quyền (vd. role không có `catalog.manage` không thấy "Danh mục"); số đơn chờ nhận cạnh "Đơn hàng".
- [ ] Tab bị treo sau khi server UAT bị tắt rồi bật lại (gặp 1 lần, 2026-10-11): kiểm vòng kết nối lại SSE/polling của
      `OrderingInboxProvider` khi server chết; nếu tái hiện được thì sửa.

- [ ] Từ chối có lý do có sẵn và "Lý do khác…"; đơn sang "Đã hủy"; email khách (kiểm `notification-delivery`).
- [ ] Hai tab/hai nhân viên cùng bấm Nhận → người sau thấy "Đơn đã được người khác xử lý".
- [ ] Đăng nhập `quan-ly-chuoi`: thấy cả Q1, Q3; tạo chi nhánh mới; gán `lan-q1` thêm Q3 ở Nhân viên bán hàng.
- [ ] Sửa chi nhánh: giờ mở qua nửa đêm (22:00–02:00), ngày nghỉ, lỗi validate hiện dưới field (vd. thời gian chuẩn bị
      âm); đổi lead time rồi đặt đơn mới — đơn cũ giữ nguyên.
- [ ] Cài đặt → Bán hàng: thêm/sửa/xóa lý do, đổi số phút lùi; hộp thoại dùng giá trị mới. Tắt "hộp thoại đơn mới".
- [ ] Đơn đặt giờ (slot): chọn slot ở Tạo đơn hộ; slot đầy (sức chứa 4) bị chặn.
- [ ] Khách tự hủy (`POST /orders/cancel` với `X-Order-Token`) khi còn chờ nhận; sau khi quán nhận thì bị từ chối.
- [ ] Tra cứu `POST /orders/lookup` (mã + SĐT): không có tên/SĐT; sai 6 lần cùng mã → 429.
- [ ] Đủ 5 trạng thái ở S1, S4, S6, S7, S8 (đang tải, trống, lỗi — tắt server giữa chừng, không có quyền, đang lưu).
- [ ] Role chỉ có `order.read`: thấy hộp đơn, không có nút bước, không có hộp thoại đơn mới.
- [ ] Giao diện English: Admin của Salanca chỉ bật `vi` (`src/admin/app.tsx`), nên chỉ kiểm được bằng test
      `translations/o3.test.ts`; ghi chú lại, không đổi cấu hình app.

## Báo cáo khi xong

Danh sách mục đã UAT (đạt/lỗi), commit sửa lỗi, lỗi chưa sửa (kèm cách tái hiện), và cập nhật Completion record của
`docs/plans/ordering-o3-pickup-cash.md` + `docs/STATUS.md` (một commit `docs(ordering): ...`).
