# Phase OP — Đóng gói và chất lượng (song song)

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Kế hoạch thực hiện: [`plans/ordering-op-platform.md`](../plans/ordering-op-platform.md) (gồm đặc tả màn hình tồn kho T1–T2).

## Goal

Biến plugin local thành plugin dùng chung có chất lượng như các dự án open-source: CI tự chạy mọi gate, test giao diện tự
động cho các luồng chính, đóng gói có version/changelog/hướng dẫn nâng cấp, tài liệu cho người tích hợp, và một product type
thứ hai (`retail` có tồn kho) chứng minh thiết kế đa ngành.

## Điều kiện bắt đầu

- Làm song song với O7–O13, theo từng bước độc lập. Bước đóng gói làm sau khi chủ dự án chốt giấy phép và nơi phát hành.

## Scope

- **CI (GitHub Actions):** Postgres service, pnpm cache, chạy lint/typecheck/test, `check:ordering` (chia shard song song theo
  DB riêng mỗi shard), `check:phase3` tắt/bật, smoke, `strapi build` tắt/bật; chạy trên PR và push nhánh `feat/ordering-*`;
  lưu log artifact khi lỗi; không dùng secret production.
- **Test giao diện tự động:** Playwright chạy Admin thật trên `uat-server` cho 8 luồng: nhận đơn + thu tiền và giao, hủy có
  hoàn, duyệt chuyển khoản, gán người giao + giao xong, chốt tiền mặt, báo cáo + xuất CSV, cấu hình vùng giao, sửa đơn (O7).
  Chụp màn hình khi lỗi. (Thêm dependency `@playwright/test` — cần chủ dự án đồng ý.)
- **Đóng gói:** tách plugin thành package độc lập (repo hoặc workspace package) — tên, giấy phép, semver từ `0.1.0`,
  `CHANGELOG.md`, `README` (cài đặt, cấu hình, env, quyền, provider, điểm mở rộng), hướng dẫn nâng cấp migration, chính sách
  hỗ trợ phiên bản Strapi (5.51.x); Salanca dùng package đó thay vì thư mục local.
- **Product type `retail`:** hàng có tồn kho theo chi nhánh (`inventory-level`: onHand, reserved), giữ hàng khi tạo đơn, trừ
  khi hoàn tất, trả khi hủy; nhập/điều chỉnh tồn có lý do; cảnh báo sắp hết; workflow giao/nhận như food. Test toàn bộ đường đặt
  đơn với món `retail`.

## Non-goals

- Đưa lên npm công khai/marketplace Strapi (quyết định sau khi có giấy phép); kho nhiều cấp, nhập hàng/nhà cung cấp, lô/hạn dùng.

## Acceptance

### Automated

- CI xanh trên PR mẫu; một lỗi cố ý (test hỏng) làm CI đỏ; thời gian CI < 30 phút nhờ chia shard.
- Playwright 8 luồng đạt 3 lần liên tiếp trên CI (không chập chờn).
- Package build và cài vào app Salanca từ đường dẫn/registry nội bộ; `check:ordering` và `check:phase3` vẫn xanh.
- `retail`: giữ tồn khi tạo đơn, hai đơn tranh món cuối → một thắng; hủy trả tồn; hoàn tất trừ `onHand`; điều chỉnh có change-log.

### Manual UAT

- [ ] Mở PR thử, xem CI chạy và báo kết quả.
- [ ] Người không tham gia code cài plugin vào một Strapi mới theo README.
- [ ] Tạo món retail, nhập tồn 5, đặt 5 đơn, đơn thứ 6 báo hết.

## Rollback

CI/Playwright không ảnh hưởng runtime. Package: Salanca giữ khả năng trỏ về thư mục local. `retail`: không đăng ký product type.

## Rủi ro

- `check:ordering` chạy lâu (≈ 30 phút/lượt trên máy dev) — chia shard theo DB riêng là bắt buộc để CI dùng được.
- Giấy phép (MIT/Apache/thương mại) là quyết định kinh doanh của chủ dự án.
