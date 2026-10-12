# Phase O10 — Nền mở rộng: webhook ra ngoài, OpenAPI, nhập/xuất catalog, mẫu email

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o10-extensibility.html`](../plans/mockups/ordering-o10-extensibility.html).
**Đặc tả màn hình:** [`plans/ordering-o10-screens.md`](../plans/ordering-o10-screens.md) (reference mục U10).
Kế hoạch thực hiện: [`plans/ordering-o10-extensibility.md`](../plans/ordering-o10-extensibility.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 12 outbox, 13 API,
15 PII, 21.6 change-log).

## Goal

Plugin dùng được cho hệ thống và người khác mà không sửa code: hệ ngoài nhận sự kiện qua webhook có ký, dev đọc
API qua OpenAPI, quán nhập/xuất menu bằng CSV, quán sửa câu chữ email trong Admin.

Bối cảnh: chủ dự án muốn plugin hoàn thiện như các plugin/hệ open-source (Medusa, Saleor, Vendure, WooCommerce,
TastyIgniter) trước khi làm frontend (2026-10-12).

## Điều kiện bắt đầu

- O9 đã merge (webhook phát cả sự kiện khuyến mãi/thẻ). Có thể làm song song O8/O9 nếu tách bước: webhook và
  OpenAPI không phụ thuộc khuyến mãi.

## Scope

- **Webhook ra ngoài:** Admin đăng ký endpoint (URL https, sự kiện chọn, bí mật ký); mỗi sự kiện nghiệp vụ trong
  outbox được gửi tới endpoint đăng ký, payload có version, ký HMAC, thử lại có backoff, tự tắt endpoint lỗi kéo dài
  và báo cảnh báo; nhật ký gửi, gửi lại tay, gửi thử. Chặn SSRF (địa chỉ nội bộ).
- **OpenAPI:** tài liệu OpenAPI 3.1 cho API công khai (`/api/v1/ordering/openapi.json`) và Admin API (file trong
  repo), sinh từ bảng route + schema; test bắt route thiếu tài liệu.
- **Nhập/xuất catalog CSV:** xuất danh mục, món, biến thể, nhóm tùy chọn, giá; nhập có chạy thử (báo lỗi từng dòng)
  rồi mới áp, trong một transaction; khớp theo SKU/slug; không tải ảnh.
- **Mẫu email trong Admin:** sửa tiêu đề và nội dung từng mẫu theo ngôn ngữ với biến cho phép; xem trước bằng dữ
  liệu mẫu; gửi thử; khôi phục mặc định. Không có biến/logic ngoài danh sách cho phép.

## Non-goals

- App store/OAuth app như Saleor Apps; GraphQL; SDK client; nhập ảnh hàng loạt; trình soạn email kéo thả.
- Webhook vào (nhận lệnh từ hệ ngoài) — ngoài phạm vi.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check:ordering     # thêm webhooks-out, openapi, catalog-csv, email-templates
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build      # plugin tắt và bật
```

Test bắt buộc:

- Webhook: ký đúng (người nhận kiểm được bằng bí mật); payload không chứa dữ liệu cá nhân khi endpoint không bật
  `includeCustomer`; lỗi 5xx/timeout thử lại theo lịch; 2xx dừng; 50 lần lỗi liên tiếp tự tắt + alert; URL tới IP
  nội bộ/localhost bị từ chối (kể cả qua DNS trỏ về IP nội bộ, redirect bị chặn); 2 process gửi không trùng; gửi lại
  tay tạo lần gửi mới cùng `deliveryId` gốc.
- OpenAPI: mọi route công khai có trong tài liệu (test so bảng route); tài liệu hợp lệ OpenAPI 3.1.
- CSV: xuất rồi nhập lại không đổi dữ liệu; chạy thử không ghi gì; một dòng lỗi thì không áp dòng nào; BOM + dấu
  tiếng Việt; chặn formula injection khi xuất; giới hạn 5000 dòng.
- Mẫu email: biến lạ bị từ chối khi lưu; nội dung được escape HTML; mẫu hỏng → dùng mặc định và mở alert; khôi phục
  mặc định.

### Manual UAT

- [ ] Đăng ký endpoint (webhook.site hoặc server thử) cho `order.created`, đặt một đơn, kiểm chữ ký bằng đoạn mã mẫu
      trong tài liệu.
- [ ] Xuất menu ra CSV, sửa giá 3 món trong Excel, nhập lại (chạy thử → áp).
- [ ] Sửa tiêu đề email "Đơn đã sẵn sàng", xem trước, gửi thử tới email của mình.

## Rollback

Tắt từng endpoint; ẩn trang bằng quyền; mẫu email "Khôi phục mặc định". Bảng mới giữ lại.

## Rủi ro

- Webhook là đường dữ liệu ra ngoài: mặc định không gửi dữ liệu cá nhân, chặn SSRF, ký và có timestamp.
- Nhập CSV sai có thể làm hỏng menu: bắt buộc chạy thử, áp trong transaction, ghi change-log, có file xuất trước khi áp.
