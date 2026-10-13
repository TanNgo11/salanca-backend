# Phase O9 — Thẻ quà tặng

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o9-gift-cards.html`](../plans/mockups/ordering-o9-gift-cards.html).
**Đặc tả màn hình (bắt buộc khi code UI):** [`plans/ordering-o9-screens.md`](../plans/ordering-o9-screens.md) (nghiên cứu UI: reference mục U9).
Kế hoạch thực hiện: [`plans/ordering-o9-gift-cards.md`](../plans/ordering-o9-gift-cards.md).
Thiết kế: [`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md) (mục 5 product type, 8
`PaymentProvider`, 10 `VoucherProvider`, 12 outbox `voucher.issued`).

## Goal

Khách mua thẻ quà tặng mệnh giá cố định (online hoặc tại quầy), nhận mã qua email; người cầm mã dùng để trả một
phần hoặc toàn bộ đơn, số dư còn lại dùng tiếp. Quán tra cứu, khóa, gia hạn, phát thẻ tặng; báo cáo tách tiền
bán thẻ (nợ phải trả) và tiền dùng thẻ.

## Điều kiện bắt đầu

- O8 đã merge (hoặc làm song song trên nhánh riêng — O9 không phụ thuộc khuyến mãi).
- Code được trước khi có quyết định kế toán/pháp lý; **mở bán** thẻ cần các quyết định ở mục "Cổng mở bán".

## Scope

- **Bán thẻ:** product type `gift-card`; mệnh giá = biến thể (ví dụ 200.000đ, 500.000đ). Đơn thẻ là đơn riêng
  (không trộn món ăn — `MIXED_WORKFLOW_UNSUPPORTED`), workflow `gift-card` (chờ thanh toán → đã phát → xong),
  fulfillment `issue-code`. Online trả trước (SePay); tại quầy nhân viên tạo đơn hộ và thu tiền mặt.
  Phát mã khi tiền đã captured; email người nhận (người mua tự nhập email người nhận + lời chúc, tùy chọn).
- **Dùng thẻ:** payment provider `gift-card`. Khách nhập mã lúc thanh toán; trừ ngay khi tạo đơn (`captured`)
  tối đa số dư và số còn phải trả; phần còn lại trả bằng cách khác của đơn. Hủy/từ chối/hết hạn/hoàn → tiền về
  lại số dư thẻ. Không dùng thẻ mua thẻ.
- **Quản lý:** tra theo 4 ký tự cuối / mã đầy đủ / mã đơn; xem số dư và sổ thẻ; khóa/mở; gia hạn; phát thẻ tặng
  (không qua bán, bắt buộc lý do); điều chỉnh số dư có lý do (quyền riêng).
- **Hết hạn:** job hằng ngày đánh dấu hết hạn, ghi sổ `expire`.
- **Báo cáo:** "Bán thẻ" và "Thanh toán bằng thẻ" tách riêng; số dư thẻ đang lưu hành; chốt tiền mặt không tính thẻ.
- **Bảo mật:** mã 16 ký tự, chỉ lưu hash; giới hạn nhập sai + captcha; alert khi bị dò mã.

## Non-goals

- Mệnh giá tự chọn, nạp thêm, chuyển số dư, đổi ra tiền mặt; dùng thẻ ở POS ngoài plugin.
- ~~Thẻ giấy in sẵn mã~~ — đã chốt **có** (2026-10-13): thêm bước nhập/sinh lô mã, kích hoạt khi bán ở quầy.
- Hóa đơn điện tử.

## Cổng mở bán (quyết định của chủ dự án/kế toán/pháp lý — không chặn code)

**Đã chốt mặc định 2026-10-13** ([`plans/ordering-decisions-2026-10-13.md`](../plans/ordering-decisions-2026-10-13.md)): hạn 12 tháng, không xuất hóa đơn lúc bán thẻ (nhận trước),
thẻ giấy **có** (nhập lô, kích hoạt khi bán ở quầy), không hoàn tiền thẻ chưa dùng. Kế toán/pháp lý xác nhận trước mở bán.
Danh sách gốc:

- Hạn dùng (đề xuất 12 tháng từ ngày phát).
- Xuất hóa đơn lúc bán thẻ hay lúc dùng; xử lý số dư hết hạn.
- Có bán thẻ giấy ở quầy không.
- Có cho hoàn tiền thẻ chưa dùng không (mặc định code: không; quản lý chỉ khóa thẻ).

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check:ordering          # thêm gift-card-sale, gift-card-redeem, gift-card-race, gift-card-admin
pnpm run check:phase3            # DB test, plugin tắt và bật
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
pnpm exec strapi build           # plugin tắt và bật
```

Test bắt buộc:

- Bán: trả SePay → phát đúng số thẻ, email một lần, webhook gửi lại không phát thêm; đơn hết hạn không phát.
- Dùng: thẻ đủ trả cả đơn; thẻ trả một phần + tiền mặt/SePay; hai đơn tranh số dư → không âm; hủy trả về thẻ;
  hủy bớt món hoàn về thẻ trước; thẻ khóa/hết hạn/sai → lỗi; không mua thẻ bằng thẻ.
- Sổ thẻ: Σ sổ = số dư sau mọi thao tác; không có đường sửa/xóa sổ.
- Mã: không lưu mã gốc; log chỉ 4 ký tự cuối; nhập sai quá ngưỡng → captcha rồi `RATE_LIMITED`.
- Báo cáo: bán thẻ không vào doanh thu món; chốt tiền mặt không đổi khi có thanh toán thẻ.

### Manual UAT

- [ ] Mua thẻ 200.000đ bằng SePay (giao dịch nhỏ thật khi có tài khoản) → nhận email mã.
- [ ] Đặt đơn 150.000đ bằng thẻ → số dư 50.000đ; hủy đơn → 200.000đ.
- [ ] Đơn 300.000đ: thẻ 50.000đ + tiền mặt 250.000đ khi nhận.
- [ ] Khóa thẻ → dùng bị từ chối; mở lại → dùng được. Phát thẻ tặng có lý do → có trong sổ.

## Rollback

Tắt provider `gift-card` (cấu hình) và ẩn món thẻ. Thẻ đã phát giữ số dư (nợ với khách) — không xóa.

## Rủi ro

- Mã thẻ là tiền: lộ mã = mất tiền của khách → không log mã, cho khóa nhanh, giới hạn dò mã.
- Kế toán chưa chốt cách ghi doanh thu → báo cáo tách sẵn hai dòng.
