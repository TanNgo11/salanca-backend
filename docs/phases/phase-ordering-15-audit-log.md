# Phase O15 — Lịch sử thay đổi (audit log)

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o15-audit-log.html`](../plans/mockups/ordering-o15-audit-log.html).
Kế hoạch thực hiện (gồm đặc tả màn hình A1–A2): [`plans/ordering-o15-audit-log.md`](../plans/ordering-o15-audit-log.md).
Thiết kế: contracts mục 21.6 (admin change-log), 15 (PII).

## Goal

Quản lý và kế toán tra được "ai đã làm gì, lúc nào, ở chi nhánh nào, trước/sau ra sao" khi có tranh cãi: sửa giá, bật/tắt
món, hủy đơn, hoàn tiền, thu tiền, duyệt chuyển khoản, chốt tiền, đổi cấu hình, gán quyền. Đủ log cho mọi thao tác nhạy cảm
và có màn xem, lọc, xuất.

Chủ dự án chọn tính năng này sau review 2026-10-12.

## Điều kiện bắt đầu

- Không phụ thuộc phase nào; làm được ngay sau O6 (song song O7+). Các phase sau tự ghi log theo danh mục O15.

## Scope

- **Màn "Lịch sử thay đổi":** lọc theo khoảng ngày, người làm, nhóm thao tác, chi nhánh, đối tượng (mã đơn, món, chi nhánh…);
  xem chi tiết trước → sau; link sang đối tượng; xuất CSV; phân quyền theo scope chi nhánh.
- **Bù chỗ ghi log còn thiếu:** sửa món/biến thể/giá/tùy chọn qua Content Manager (Document Service middleware), hủy đơn,
  hủy bớt món, từ chối, thu tiền và giao, ghi chuyển khoản tay, duyệt/gán/bỏ qua/mở lại chuyển khoản, phát link thanh toán,
  sửa đơn (O7), gán người giao. Danh mục thao tác cố định có nhãn VI/EN.
- **Toàn vẹn:** chỉ thêm, không route sửa/xóa (như `audit-event` của app); chuỗi băm theo thứ tự để phát hiện sửa trực tiếp DB
  (tùy chọn bật, kiểm bằng job + cảnh báo).
- **Truy vết đăng nhập Admin** (lần đăng nhập/đăng xuất của nhân viên ordering) — chỉ nếu Strapi cung cấp sự kiện; không có thì
  ghi non-goal.

## Non-goals

- Ghi log mọi lần đọc (chỉ ghi lần xem dữ liệu cá nhân nhạy cảm đã có: hiện SĐT đầy đủ O11, xuất CSV O6).
- Khôi phục dữ liệu từ log (undo).

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test
pnpm run check:ordering     # thêm audit-log, audit-coverage
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build
```

Test bắt buộc:

- Mỗi thao tác trong danh mục tạo đúng một dòng log với người làm, chi nhánh, đối tượng, trước/sau đã che PII
  (`audit-coverage.mjs` chạy từng thao tác qua HTTP và kiểm dòng log).
- Sửa giá món trong Content Manager → log `catalog-price.update` trước/sau đúng số.
- Lọc theo người/ngày/nhóm/chi nhánh/đối tượng đúng; nhân viên Q1 không thấy log của Q3; log không gắn chi nhánh (cấu hình
  chung) chỉ người `allLocations` thấy.
- Không có route sửa/xóa log; chuỗi băm phát hiện dòng bị sửa trực tiếp trong DB (bật cờ) → alert.
- Xuất CSV đúng quyền, giới hạn, chặn formula injection.

### Manual UAT

- [ ] Sửa giá một món, hủy một đơn, hoàn tiền một phần; vào Lịch sử thay đổi lọc theo tên mình, thấy đủ 3 dòng với trước/sau.
- [ ] Kế toán lọc "Tiền" trong tuần, xuất CSV.

## Rollback

Ẩn màn bằng quyền; log tiếp tục ghi (không tắt).

## Rủi ro

- Log nhiều làm bảng lớn → index theo thời gian/người/đối tượng; thời hạn giữ log là quyết định chủ dự án (mặc định giữ hết).
