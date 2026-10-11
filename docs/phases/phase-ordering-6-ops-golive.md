# Phase O6 — Vận hành và go-live

Trạng thái: spec chờ duyệt (2026-10-10). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o6-ops-golive.html`](../plans/mockups/ordering-o6-ops-golive.html).
**Đặc tả màn hình (bắt buộc khi code UI):** [`plans/ordering-o6-screens.md`](../plans/ordering-o6-screens.md) (nghiên cứu UI: reference mục U6).
Kế hoạch thực hiện: [`plans/ordering-o6-ops-golive.md`](../plans/ordering-o6-ops-golive.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 12, 15, 19.3,
19.9); nghiên cứu: reference C17.3.

## Goal

Đủ công cụ để vận hành bán online thật: biết khi nào có lỗi, đối soát được tiền mỗi ngày, báo cáo theo
ngày kinh doanh, xóa dữ liệu cá nhân đúng hạn; qua được cổng go-live.

## Điều kiện bắt đầu

- O5 đóng (hoặc chủ dự án quyết định go-live chỉ với tự lấy sau O4).

## Scope

- **Trang "Tình trạng vận hành"** (quyền `ops.read`): số event outbox đang chờ và tuổi event chờ lâu nhất,
  lần webhook thành công gần nhất theo provider, lần chạy gần nhất của từng job, alert đang mở.
- **Đủ rule cảnh báo** (mục 12): `webhook-failing`, `payment-unmatched`, `outbox-stuck`,
  `job-heartbeat-missed`, `order-awaiting-acceptance`, `reconciliation-mismatch`,
  `manual-payment-unconfirmed`, `cash-closing-mismatch`; gộp theo key, ngưỡng critical, "đã biết";
  người nhận theo vai trò; chỉnh ngưỡng trong Admin.
- **Chốt tiền mặt cuối ngày** (mục 19.3): báo cáo theo nhân viên/người giao và `businessDate`; quản lý
  nhập số đếm, lưu `cash-closing`, chênh lệch thì báo kế toán.
- **Báo cáo** theo ngày kinh doanh, chi nhánh, danh mục, cách thanh toán, cách nhận hàng; dùng snapshot.
- **Xuất CSV đơn** (quyền `export`, có dữ liệu cá nhân), giới hạn khoảng ngày và số dòng như xuất lead
  hiện có.
- **Thời hạn lưu:** job xóa field cá nhân trong raw payload thanh toán theo thời hạn đã chốt (mặc định
  180 ngày, chờ pháp lý); outbox đã giao 30 ngày, lỗi 90 ngày; alert đã đóng 90 ngày.
- **Hạ tầng:** Cloudflare cho route webhook (không cache, không WAF challenge), backup trước go-live,
  kiểm SSE qua proxy.
- **Runbook** tiếng Việt: nhân viên (xử lý đơn, duyệt chuyển khoản, chốt tiền), kỹ thuật (cảnh báo, đối
  soát, khôi phục).

## Cổng go-live (không phải code)

- Tài khoản SePay thật đã cấu hình và thử bằng giao dịch nhỏ.
- Kế toán xác nhận: đơn online có phải xuất hóa đơn điện tử không; giá đã gồm VAT chưa.
- Pháp lý xác nhận: thời hạn lưu dữ liệu; nội dung đồng ý xử lý dữ liệu cá nhân ở checkout.
- Nội dung email gửi khách đã duyệt.
- UAT tay của O3–O6 đã ghi đủ trong `docs/STATUS.md`.

## Bổ sung sau review (2026-10-10)

- Runbook ghi: `strapi export`/`transfer` gồm bảng của plugin có dữ liệu cá nhân; mã hóa file xuất và nơi
  giữ (21.9).
- Repo chưa có CI: kết quả mọi gate của O1–O6 ghi trong `docs/STATUS.md` trước cổng go-live.
- Cổng go-live thêm: nội dung chính sách dữ liệu cá nhân và `policyVersion` đã bật (21.4); quyết định số
  instance khi chạy thật (21.9).

## Non-goals

- VAT/hóa đơn điện tử, voucher, đặt lịch hẹn, tồn kho, khuyến mãi (module sau go-live).

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:phase3
```

Test bắt buộc:

- Mỗi rule cảnh báo mở đúng một bản ghi cho cùng key trong cửa sổ gộp, lên critical đúng ngưỡng.
- Job xóa dữ liệu chỉ xóa field cá nhân, giữ id, số tiền, thời gian; chạy lại không lỗi.
- Báo cáo theo `businessDate` đúng với đơn qua nửa đêm.
- CSV không xuất được khi thiếu quyền; giới hạn khoảng ngày.

### Manual UAT

- [ ] Gây lỗi webhook liên tục → một cảnh báo, không spam email.
- [ ] Chốt tiền mặt có chênh lệch → kế toán nhận cảnh báo.
- [ ] Báo cáo ngày khớp tổng tiền trong ledger.
- [ ] Đọc runbook và làm theo được một lần đối soát.

## Rollback

Các tính năng của phase chỉ đọc hoặc chạy job; tắt từng job trong cấu hình nếu có lỗi.
