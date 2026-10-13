# Phase O13 — Provider: ví điện tử, hãng giao, Zalo/SMS

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o13-providers.html`](../plans/mockups/ordering-o13-providers.html).
**Đặc tả màn hình:** [`plans/ordering-o13-screens.md`](../plans/ordering-o13-screens.md) (reference mục U13).
Kế hoạch thực hiện: [`plans/ordering-o13-providers.md`](../plans/ordering-o13-providers.md).
Thiết kế: contracts mục 5 (`FulfillmentProvider`), 8 (`PaymentProvider`), 12 (outbox/webhook), 19.1.

## Goal

Plugin có provider thật ngoài cash/SePay/quán tự giao/email, vừa để Salanca dùng, vừa làm mẫu cho người viết provider
khác: thanh toán ví (MoMo, VNPay), hãng giao (Ahamove; GHN là tùy chọn), thông báo Zalo ZNS và SMS. Mỗi provider cắm qua
contract có sẵn, cấu hình qua env, có đối soát/kiểm tra trạng thái khi webhook không tới.

## Điều kiện bắt đầu

- **Chủ dự án đăng ký và cấp tài khoản sandbox** cho từng provider được chọn (MoMo, VNPay, Ahamove, Zalo OA + ZNS mẫu đã
  duyệt, nhà cung cấp SMS). Thiếu provider nào thì bỏ provider đó khỏi lần làm này — không code đoán.
- **Thay bởi quyết định 2026-10-13** ([`plans/ordering-decisions-2026-10-13.md`](../plans/ordering-decisions-2026-10-13.md)): build adapter trước theo tài liệu công khai + server giả lập,
  tắt mặc định, bật thật sau UAT sandbox. MoMo, VNPay, Ahamove (không GHN), Zalo ZNS, SMS **eSMS.vn**.
- O11 xong nếu muốn OTP qua SMS/Zalo; O12 không bắt buộc.

## Scope

- **Thanh toán ví:** MoMo và VNPay — tạo giao dịch (chuyển hướng/QR/deeplink), nhận IPN (kiểm chữ ký theo tài liệu chính
  thức), trang trả về chỉ để hiển thị (không ghi tiền từ return URL), truy vấn trạng thái khi IPN không tới, hoàn tiền qua
  API (nếu provider hỗ trợ; không thì phiếu hoàn chờ như SePay), đối soát định kỳ.
- **Hãng giao:** Ahamove (GHN tùy chọn) — báo phí theo địa chỉ, tạo chuyến khi quán bấm "Gọi xe", nhận webhook trạng thái
  (đã nhận, đang giao, đã giao, hủy, thất bại) → cập nhật chặng giao O5, hủy chuyến, link theo dõi; phí thật so với phí đã
  thu khách hiện trong báo cáo.
- **Thông báo:** Zalo ZNS (mẫu đã duyệt, map biến) và SMS brandname; chọn kênh theo mẫu và theo khách (đã có Zalo/SMS/email),
  kênh dự phòng khi gửi lỗi; chi phí ước tính theo tin; OTP O11 qua SMS/Zalo.
- **Chung:** cấu hình bí mật qua env (không nhập trên Admin), trang trạng thái provider trong Ops (O6), cảnh báo webhook lỗi
  theo provider, tài liệu "Viết provider mới" dựa trên các provider này.

## Non-goals

- Thẻ quốc tế qua cổng nước ngoài (Stripe…), trả góp, ví khác ngoài danh sách; GHTK/Viettel Post…; push notification app.
- Tự động chọn hãng giao rẻ nhất (v1 quán chọn).

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test
pnpm run check:ordering     # thêm momo, vnpay, ahamove, zalo-zns, sms — dùng server giả lập (fixture từ tài liệu chính thức)
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build      # plugin tắt và bật
```

Test bắt buộc (mỗi provider, bằng server giả lập trong script — không gọi mạng thật trong `check:ordering`):

- Thanh toán: chữ ký IPN sai → từ chối, không ghi tiền; IPN đúng → capture một lần (gửi lại không ghi lần hai); số tiền
  lệch → vào hàng duyệt; return URL không ghi tiền; IPN không tới → job truy vấn trạng thái capture; hoàn tiền thành công/thất bại.
- Giao: phí báo đúng; tạo chuyến idempotent; webhook trạng thái cập nhật chặng giao, sai chữ ký → từ chối; hủy chuyến; hãng
  báo thất bại → chặng `failed` + lý do.
- Thông báo: map biến ZNS đúng mẫu; lỗi kênh chính → dự phòng; không gửi trùng (dedupe O3); OTP qua SMS.
- Bí mật không xuất hiện trong log/response.

### Manual UAT (sandbox của từng provider)

- [ ] Thanh toán đơn bằng MoMo sandbox và VNPay sandbox; hoàn một phần.
- [ ] Gọi xe Ahamove sandbox cho đơn giao, theo dõi tới "đã giao".
- [ ] Nhận tin ZNS "Đơn đã sẵn sàng" và SMS OTP trên điện thoại thật.

## Rollback

Bỏ biến env của provider → provider không đăng ký; chi nhánh không còn chọn được; đơn cũ giữ nguyên sổ.

## Rủi ro

- Mỗi provider có quy định chữ ký/IP/timeout riêng — chỉ code theo tài liệu chính thức bản hiện hành, ghi phiên bản API và
  ngày đọc vào code và tài liệu.
- Phí ZNS/SMS theo tin — có ước tính chi phí và giới hạn gửi theo ngày.
