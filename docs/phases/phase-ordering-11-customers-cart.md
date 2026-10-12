# Phase O11 — Khách hàng, giỏ hàng, quyền dữ liệu cá nhân

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o11-customers-cart.html`](../plans/mockups/ordering-o11-customers-cart.html).
**Đặc tả màn hình:** [`plans/ordering-o11-screens.md`](../plans/ordering-o11-screens.md) (reference mục U11).
Kế hoạch thực hiện: [`plans/ordering-o11-customers-cart.md`](../plans/ordering-o11-customers-cart.md).
Thiết kế: contracts mục 15 (PII), 21.4 (bằng chứng đồng ý), 21.9.

## Goal

Khách có hồ sơ (đăng nhập bằng mã OTP, không mật khẩu), sổ địa chỉ, lịch sử đơn và đặt lại đơn cũ; giỏ hàng lưu ở
server dùng được trên nhiều thiết bị và nhắc giỏ bỏ dở (khi khách đồng ý); khách và quán thực hiện được quyền xem/xuất/
xóa dữ liệu cá nhân (Nghị định 13/2023). Là nền cho tích điểm và giá theo nhóm khách sau này.

## Điều kiện bắt đầu

- O10 đã merge (webhook `customer.*`, mẫu email OTP sửa được).
- Kênh gửi OTP: email có sẵn; SMS/Zalo khi O13 xong (OTP qua điện thoại bật sau).
- Pháp lý xác nhận nội dung đồng ý và thời hạn giữ dữ liệu khách (chặn **mở** tính năng, không chặn code).

## Scope

- **Khách hàng:** hồ sơ theo số điện thoại (E.164, duy nhất) + email tùy chọn; tên; đồng ý tiếp thị (có bằng chứng);
  thống kê (số đơn, tổng chi, đơn gần nhất). Đơn cũ gắn với khách theo số điện thoại (backfill). Đặt đơn không đăng
  nhập vẫn được (khách vãng lai) — đơn tự gắn vào hồ sơ cùng số điện thoại.
- **Đăng nhập khách:** OTP 6 số qua email (và SMS/Zalo sau O13), hạn 5 phút, tối đa 5 lần thử, giới hạn gửi; phiên
  bằng token mờ (lưu hash), hạn 30 ngày, đăng xuất/thu hồi.
- **Sổ địa chỉ:** tối đa 10 địa chỉ (cùng định dạng địa chỉ O5), một mặc định.
- **Giỏ hàng server:** tạo giỏ (khách vãng lai có token giỏ), thêm/sửa/xóa dòng, chọn chi nhánh/cách nhận/giờ, mã
  khuyến mãi, thẻ quà tặng; mỗi lần đọc giỏ trả báo giá mới; checkout từ giỏ = tạo đơn (idempotent). Giỏ hết hạn 7 ngày.
  Đăng nhập thì gộp giỏ vãng lai vào giỏ của khách.
- **Nhắc giỏ bỏ dở:** email một lần sau 2 giờ không hoạt động, chỉ khi khách đồng ý tiếp thị; tắt được theo chi nhánh.
- **Đặt lại đơn cũ:** tạo giỏ từ đơn đã xong với giá hiện hành; món không còn bán được đánh dấu.
- **Quyền dữ liệu:** khách tải dữ liệu của mình (JSON), yêu cầu xóa; quán xử lý yêu cầu xóa: ẩn danh đơn (tên, SĐT, email,
  địa chỉ, ghi chú → thay bằng giá trị ẩn danh; giữ số tiền, món, thời gian, mã đơn cho sổ sách), xóa hồ sơ, địa chỉ,
  giỏ, phiên; ghi sổ yêu cầu.
- **Admin:** danh sách khách (tìm SĐT/tên/email), chi tiết (đơn, địa chỉ, đồng ý, yêu cầu dữ liệu), xuất dữ liệu, xóa.

## Non-goals

- Mật khẩu, đăng nhập mạng xã hội; tích điểm/hạng (để sau, dùng nền O11); nhóm khách và giá theo nhóm (O14); wishlist.
- Gộp hai hồ sơ khác số điện thoại.

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test
pnpm run check:ordering     # thêm customers, customer-auth, cart, cart-checkout, data-rights
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build      # plugin tắt và bật
```

Test bắt buộc:

- OTP: đúng mã → phiên; sai 5 lần → khóa mã; hết hạn; gửi quá 3 lần/10 phút/số → `RATE_LIMITED`; không lộ số/email có
  tồn tại hay không (luôn "Đã gửi nếu tài khoản có").
- Phiên: token chỉ lưu hash; hết hạn; thu hồi; khách A không đọc được dữ liệu khách B (404).
- Giỏ: báo giá luôn tính lại; checkout hai lần cùng `Idempotency-Key` → một đơn; giỏ hết hạn; gộp giỏ khi đăng nhập
  (cộng dòng trùng); món hết/tạm hết hiện lỗi theo dòng.
- Đặt lại: giá hiện hành; món ngừng bán bị đánh dấu, không chặn phần còn lại.
- Xóa dữ liệu: đơn còn mở → không xóa ngay (chờ đóng); đơn đã đóng ẩn danh đúng field, tổng tiền/sổ không đổi; báo
  cáo/chốt tiền O6 không đổi số; xuất dữ liệu chỉ của chính khách.
- Nhắc giỏ: chỉ khi đồng ý tiếp thị; một lần/giỏ.

### Manual UAT

- [ ] Đăng nhập OTP bằng email, thêm địa chỉ, đặt đơn bằng giỏ trên máy tính, mở giỏ trên điện thoại.
- [ ] Đặt lại một đơn cũ có một món đã ngừng bán.
- [ ] Khách yêu cầu xóa dữ liệu → quán xử lý → tra cứu đơn cũ thấy thông tin đã ẩn danh, báo cáo không đổi.

## Rollback

Tắt đăng nhập khách (`customers.enabled=false`) — đặt đơn vãng lai vẫn chạy; giỏ server có thể tắt (`carts.enabled`).

## Rủi ro

- OTP là đường chiếm tài khoản: giới hạn gửi/thử, mã một lần, so sánh hằng thời gian.
- Ẩn danh dữ liệu phải giữ được sổ sách (kế toán) — chỉ ẩn field cá nhân, test báo cáo trước/sau.
