# Phase OW — Web đặt món (repo web)

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Phase này làm ở repo web, không ở backend; theo `AGENTS.md`, tích hợp frontend cần phase được duyệt
riêng. File này chỉ ghi phạm vi và hợp đồng API mà web dùng.

## Goal

Khách xem catalog, chọn món và tùy chọn, đặt đơn tự lấy hoặc giao tận nơi, thanh toán và theo dõi đơn
trên website Salanca. Trang menu hiện tại (đọc content CMS) giữ nguyên trừ khi chủ dự án quyết định khác.

## Điều kiện bắt đầu

- API catalog (O2) và API đặt hàng (O3) đã ổn định; có thể làm song song từ cuối O3.
- Chủ dự án duyệt phase frontend.

## Scope

- Trang đặt món: danh mục, product, biến thể, tùy chọn cộng thêm, combo; hiện "tạm hết" và khung giờ bán
  (`GET /ordering/catalog/*`).
- Giỏ hàng ở client; báo giá ở server (`POST /ordering/quote`), không tự tính tiền ở client.
- Checkout: tự lấy (chọn chi nhánh, slot) hoặc giao tận nơi (địa chỉ 2 cấp, phí giao); thông tin liên hệ;
  nội dung đồng ý xử lý dữ liệu cá nhân; Turnstile; `Idempotency-Key` cho mỗi lần bấm đặt.
- Thanh toán: QR SePay với hạn thanh toán, polling trạng thái có backoff, dừng khi xong; tiền mặt.
- Trang trạng thái đơn: đọc token từ `#t=`, gọi API bằng header `X-Order-Token`, xóa fragment bằng
  `history.replaceState`, lưu token trong `sessionStorage` của tab.
- Song ngữ VI/EN theo locale của site.

## Non-goals

- Tài khoản khách, lịch sử đơn theo tài khoản, khuyến mãi, voucher.

## Acceptance

- Đặt đơn tự lấy và giao tận nơi thành công trên staging với cả tiền mặt và chuyển khoản.
- Đổi giá giữa lúc báo giá và đặt thì hiện thông báo `PRICE_CHANGED`, không đặt sai giá.
- Bấm đặt hai lần không tạo hai đơn.
- Token không xuất hiện trong URL gửi lên server hay trong log Cloudflare.
- Chi tiết test và UAT viết trong spec của repo web khi phase được duyệt.

## Bổ sung sau review (2026-10-10)

- API nằm dưới `/api/v1/ordering/...` (contracts 21.7).
- Chọn chi nhánh từ `GET /api/v1/ordering/branches` (21.1).
- Email tùy chọn; trang đặt xong có "Sao chép link" và "Lưu link"; trang tra cứu bằng mã đơn + số điện
  thoại chỉ hiện trạng thái (21.2).
- Ô đồng ý xử lý dữ liệu cá nhân bắt buộc, gửi `policyVersion`; ô nhận tin khuyến mãi tách riêng, mặc định
  không tích (21.4).
- Ghi chú cả đơn (21.9).
