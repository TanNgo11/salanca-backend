# O13 — Đặc tả màn hình (provider)

Ngày: 2026-10-12. Bổ sung cho spec [`phases/phase-ordering-13-providers.md`](../phases/phase-ordering-13-providers.md),
kế hoạch [`ordering-o13-providers.md`](ordering-o13-providers.md), mockup
[`mockups/ordering-o13-providers.html`](mockups/ordering-o13-providers.html). Nghiên cứu: reference U13.
**Quy ước chung** như [`ordering-o3-screens.md`](ordering-o3-screens.md); chuỗi trong `translations/o13.ts`.

## P1. Provider (Cấu hình → Provider)

- Route `/plugins/ordering/providers`. Quyền `settings.manage`. Chỉ đọc — bí mật ở env.
- 3 nhóm thẻ: **Thanh toán** (Tiền mặt, SePay, MoMo, VNPay, Thẻ quà tặng), **Giao hàng** (Quán tự giao, Ahamove, GHN),
  **Thông báo** (Email, Zalo ZNS, SMS). Mỗi thẻ: tên, `Badge` Đã cấu hình / Chưa cấu hình / Lỗi, môi trường (Sandbox /
  Thật), mã đối tác `•••• 7KQ2`, webhook gần nhất (lúc, kết quả), link tài liệu cấu hình (`docs/providers/<code>.md`).
- Thẻ chưa cấu hình: danh sách biến env cần đặt (tên biến, không giá trị) + URL webhook/IPN cần khai với provider.

## P2. Gọi xe (chi tiết đơn giao S4 và board Đơn giao D2)

- Khi chi nhánh bật hãng giao: nút "Gọi xe" cạnh "Gán người giao". Bấm → panel: chọn hãng (nút), dịch vụ (nút: Siêu tốc / 2h…
  theo `getOptions`), phí hãng báo (so với phí đã thu khách: "Thu khách 15.000đ · Hãng 23.000đ · Chênh −8.000đ"), ghi chú tài
  xế; "Xác nhận gọi xe" → trạng thái "Đang tìm tài xế…".
- Sau khi hãng nhận: chặng giao hiện hãng, mã chuyến, tài xế (tên, SĐT che), link theo dõi; nút "Hủy chuyến" (`Dialog`).
- Hãng báo thất bại/hủy: `Alert` + nút "Gọi lại" / "Tự giao".

## P3. Kênh thông báo (Cài đặt bán hàng → Kênh thông báo)

- Quyền `settings.manage`. Bảng theo mẫu (Đơn đã nhận, Đơn sẵn sàng, Đang giao, Mã OTP, …): cột **Kênh ưu tiên** (chip kéo
  bằng nút ↑↓: Zalo, SMS, Email), **Mẫu ZNS** (`templateId` + panel map tham số ZNS ↔ biến plugin), **Chi phí ước tính/tin**.
- Nút "Gửi thử" (nhập SĐT/email, chọn kênh) → kết quả (mã tin, lỗi rút gọn).
- Giới hạn chi phí: `NumberInput` "Tối đa tin SMS/ngày" — vượt thì rơi về kênh rẻ hơn và mở cảnh báo.

## P4. Ops (O6 V1) — thêm thẻ provider

- Mỗi provider có webhook: lần nhận gần nhất, tỉ lệ lỗi 24 giờ; job trạng thái ví/đối soát: lần chạy gần nhất.

## Phía khách (OW dùng)

- Checkout: chọn "MoMo" / "VNPay" → chuyển hướng hoặc QR/deeplink trên điện thoại; trang trả về hiện "Đang xác nhận thanh
  toán…" và hỏi lại trạng thái đơn (không tin tham số URL).
- Theo dõi đơn giao có link theo dõi của hãng khi có.
- Tin Zalo/SMS theo mẫu đã duyệt; OTP qua SMS/Zalo khi bật.
