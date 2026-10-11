# OW — Đặc tả màn hình web đặt món

Ngày: 2026-10-10. Làm ở repo web (cần duyệt phase frontend). Spec [`phases/phase-ordering-w-web.md`](../phases/phase-ordering-w-web.md),
mockup [`mockups/ordering-w-web.html`](mockups/ordering-w-web.html). Nghiên cứu: [`ordering-reference.md` mục UW](ordering-reference.md)
(TastyIgniter Orange, Medusa Next.js storefront). Giao diện theo thiết kế site Salanca; file này chốt luồng, dữ liệu và
trạng thái.

Quy ước: API dưới `/api/v1/ordering/...`; tiền và giờ từ server (giờ theo chi nhánh); song ngữ VI/EN theo locale site;
mọi nút gửi có trạng thái đang gửi và chặn bấm lại; lỗi mạng hiện thông báo kèm thử lại.

## W1. Chọn chi nhánh, cách nhận, giờ (trước khi xem menu)

Theo TastyIgniter `fulfillment-modal`. Thanh trên cùng trang đặt món: "Salanca Q1 · Tự lấy · Hôm nay 12:30 ▾". Bấm mở
hộp thoại:

- Chi nhánh (`GET /branches`): chỉ chi nhánh đang bán online; nếu chỉ có một thì chọn sẵn.
- Cách nhận: Tự lấy / Giao tận nơi (ẩn cách chi nhánh không bật).
- Giờ: ASAP (nếu cho) hoặc chọn ngày + slot (`GET /slots?branch=&receive=&date=`); slot hết chỗ hiện mờ.
- Giao tận nơi: địa chỉ 2 cấp (D4 của O5) trước khi chọn giờ.
- Lưu lựa chọn trong `sessionStorage`; đổi chi nhánh thì báo giá lại giỏ, món không còn bán bị đánh dấu.

## W2. Menu

- `GET /catalog/categories`, `GET /catalog/products?category=&location=` theo chi nhánh đã chọn.
- Tab/chip danh mục, thẻ món (ảnh, tên, "từ X đ"); món tạm hết mờ + nhãn "Tạm hết"; ngoài khung giờ bán: "Bán từ
  06:00".
- Trống: "Chi nhánh chưa có món bán online".

## W3. Hộp thoại món

Theo TastyIgniter `cart-item-modal`.

- Biến thể (chip chọn một), nhóm tùy chọn (chip/checkbox theo min/max, hiện "chọn tối đa 3", nhóm bắt buộc có dấu *),
  combo: mỗi nhóm chọn một khối; lựa chọn tạm hết mờ.
- Ô ghi chú cho món; bộ đếm số lượng (≥ `minQuantity`).
- Nút "Thêm vào giỏ · <giá>" — giá tạm tính ở client để hiển thị; disabled tới khi chọn đủ nhóm bắt buộc. Sửa món trong
  giỏ mở lại hộp thoại với nút "Cập nhật".

## W4. Giỏ

Theo TastyIgniter `cart-box`: giỏ cố định (desktop: cột phải; mobile: thanh dưới "2 món · 199.000đ · Xem giỏ").

- Mỗi khi giỏ đổi: `POST /quote` → hiện tạm tính, giảm giá, phí, tổng do server tính; nhắc đơn tối thiểu ("Thêm X đ
  để đặt") và miễn phí giao.
- Lỗi báo giá theo dòng: món hết → nhãn đỏ trên dòng + nút xóa.

## W5. Checkout (một trang, chia khối)

Theo TastyIgniter one-step form + Medusa checkout steps:

1. **Liên hệ**: họ tên *, số điện thoại * (kiểm số Việt Nam), email (không bắt buộc, gợi ý "để nhận cập nhật").
2. **Nhận hàng**: tóm tắt W1, nút đổi.
3. **Ghi chú cả đơn** (≤ 500 ký tự).
4. **Thanh toán**: các cách chi nhánh bật (Trả khi nhận / Chuyển khoản QR); mô tả ngắn từng cách.
5. **Đồng ý**: ô bắt buộc "Tôi đồng ý cho Salanca xử lý dữ liệu để thực hiện đơn" + link chính sách; ô riêng "Nhận tin
   ưu đãi" (mặc định không tích).
6. Turnstile, rồi nút **Đặt đơn · <tổng>**.

Gửi: `POST /orders` với header `Idempotency-Key` (tạo một lần cho mỗi lần mở trang checkout, giữ khi bấm lại).
Lỗi: `PRICE_CHANGED` → hiện giá mới, yêu cầu xác nhận lại; `SLOT_TOO_EARLY`/slot hết → mở lại W1; `CONSENT_REQUIRED`
→ tô đỏ ô đồng ý; 429 → "Thao tác quá nhanh, thử lại sau ít phút".

## W6. Sau khi đặt

- Chuyển khoản trả trước → trang QR (P7 của O4).
- Trang đặt thành công: mã đơn, giờ lấy/giao, chi nhánh (địa chỉ, SĐT), tổng; nếu không có email: khung nhắc lưu link
  + nút **Sao chép link** và **Lưu link** (thêm vào trang chủ / bookmark theo trình duyệt).

## W7. Trang trạng thái đơn

Theo TastyIgniter `includes/order`. Đọc token từ `#t=`, gọi `GET /orders` bằng `X-Order-Token`, rồi xóa fragment
bằng `history.replaceState`; giữ token trong `sessionStorage` của tab.

- Dòng thời gian các bước `isPublic`, bước hiện tại nổi bật; giờ sẵn sàng dự kiến (`estimatedReadyAt`).
- Món, tổng, trạng thái thanh toán; chi nhánh (bản đồ link, SĐT bấm gọi).
- Nút **Hủy đơn** chỉ khi còn được hủy (theo `customerCancellable` và hạn hủy) — `POST /orders/cancel` có xác nhận.
- Tự cập nhật mỗi 20 giây khi đơn chưa xong.
- Token sai/hết hạn: "Không mở được đơn. Tra cứu bằng mã đơn và số điện thoại" + link W8.

## W8. Tra cứu đơn

Mã đơn + số điện thoại + Turnstile → `POST /orders/lookup`; kết quả chỉ dạng xem trạng thái (không tên, không địa chỉ,
không nút hủy). Sai: một thông báo chung "Không tìm thấy đơn khớp thông tin".
