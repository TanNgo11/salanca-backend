# Phase O16 — Tích điểm và hạng thành viên

Trạng thái: spec chờ duyệt (2026-10-12); điều kiện bắt đầu (O8, O11, O14) đã merge vào `feat/ordering`; kế hoạch thực hiện đã đối chiếu code 2026-10-15. Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o16-loyalty.html`](../plans/mockups/ordering-o16-loyalty.html).
Kế hoạch thực hiện (gồm đặc tả màn hình Y1–Y4): [`plans/ordering-o16-loyalty.md`](../plans/ordering-o16-loyalty.md).

## Goal

Khách đã đăng nhập (O11) tích điểm theo tiền món sau khi đơn hoàn tất, dùng điểm để giảm giá đơn sau, lên hạng theo chi tiêu
12 tháng; hạng mang quyền lợi (nhân điểm, giá nhóm O14, khuyến mãi riêng O8). Quán cấu hình chương trình, xem/điều chỉnh điểm
có lý do, theo dõi số điểm đang lưu hành (nợ điểm).

Chủ dự án chọn tính năng này sau review 2026-10-12.

## Điều kiện bắt đầu

- O8 (khuyến mãi, pipeline `target`), O11 (khách + OTP), O14 (nhóm khách) đã merge.
- **Tham số đã chốt mặc định 2026-10-13** ([`plans/ordering-decisions-2026-10-13.md`](../plans/ordering-decisions-2026-10-13.md)): 1 điểm/10.000đ, 1 điểm = 100đ, dùng tối đa 50%,
  hạn 12 tháng, hạng Thành viên / Bạc 2tr ×1.2 / Vàng 5tr ×1.5, ân hạn 30 ngày. Tất cả là cấu hình.
- **Chủ dự án chốt tham số chương trình** (tỉ lệ tích, giá trị điểm, trần dùng điểm, hạn điểm, mốc hạng) — code để cấu hình,
  không chặn code; chặn mở cho khách thật.

## Scope

- **Tích điểm:** khi đơn `completed`, điểm = floor(cơ sở / đơn vị tích) × hệ số hạng; cơ sở = tiền món sau giảm giá (không tính
  phí giao, phí dịch vụ, tip, thẻ quà tặng mua, phần trả bằng điểm). Chỉ khách đã xác minh (OTP). Đơn hoàn tiền → trừ lại điểm
  tương ứng (có thể âm tạm thời → bù ở lần tích sau, không cho đổi khi âm).
- **Dùng điểm:** khách đăng nhập chọn dùng điểm ở checkout; 1 điểm = X đồng; tối đa Y% tiền món sau khuyến mãi; tối thiểu Z điểm; là adjustment
  giảm giá `loyalty` áp **sau** khuyến mãi O8, chia xuống dòng (hoàn đúng khi hủy món); giữ điểm khi tạo đơn, trả lại khi đơn
  hủy/từ chối/hết hạn.
- **Hạn điểm:** điểm tích có hạn N tháng (theo lô, dùng lô cũ trước); job hằng ngày hết hạn + email nhắc trước 14 ngày (nếu
  khách đồng ý tiếp thị).
- **Hạng:** Thành viên / Bạc / Vàng (tên, mốc chi tiêu 12 tháng, hệ số điểm, nhóm khách O14 gắn kèm); job hằng ngày xét hạng;
  lên hạng ngay khi đơn hoàn tất vượt mốc; xuống hạng khi xét lại hằng ngày (có 30 ngày ân hạn).
- **Admin:** cấu hình chương trình + hạng, điểm của khách (số dư, lô, sổ, điều chỉnh có lý do, quyền riêng), báo cáo (điểm phát,
  dùng, hết hạn, đang lưu hành quy ra tiền), O15 log mọi điều chỉnh.
- **Phía khách (OW):** số điểm, hạng + tiến độ lên hạng, lịch sử điểm, "Dùng N điểm (−X đ)" ở checkout, dự kiến điểm nhận.

## Non-goals

- Đổi điểm lấy quà/món tặng; chuyển điểm giữa khách; điểm cho hành động ngoài mua hàng (đánh giá, giới thiệu); liên kết chương
  trình đối tác; thẻ thành viên vật lý.

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test     # domain/loyalty (tích, dùng, lô FIFO, hạng)
pnpm run check:ordering     # thêm loyalty-earn, loyalty-redeem, loyalty-expiry, loyalty-tiers, loyalty-race
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build
```

Test bắt buộc:

- Tích: chỉ khi `completed`; cơ sở đúng (loại phí giao/dịch vụ/tip/thẻ/phần trả bằng điểm); hệ số hạng; khách chưa xác minh không
  tích; đơn hoàn tất chạy lại consumer không tích hai lần.
- Hoàn tiền một phần → trừ điểm tỉ lệ; hoàn toàn → trừ hết; điểm âm chặn đổi.
- Dùng: trần %/tối thiểu; quote = create; hai đơn song song cùng dùng hết điểm → một thành công (`LOYALTY_INSUFFICIENT`); hủy trả
  điểm; hủy bớt món hoàn tiền theo phân bổ, không trả điểm phần đã dùng trừ khi hủy cả đơn (quyết định ở plan).
- Hạn: lô cũ dùng trước; job hết hạn đúng lô, chạy lại không trừ hai lần; email nhắc một lần.
- Hạng: vượt mốc lên ngay; xét lại hằng ngày xuống hạng sau ân hạn; hạng gắn nhóm O14 → giá nhóm; khuyến mãi O8 điều kiện hạng.
- Sổ điểm append-only; Σ sổ = số dư; điều chỉnh tay cần quyền + lý do, có log O15.

### Manual UAT

- [ ] Khách đăng nhập đặt đơn 300.000đ → hoàn tất → nhận điểm đúng; đơn sau dùng điểm giảm.
- [ ] Hủy đơn đã dùng điểm → điểm về lại.
- [ ] Đặt mốc Bạc thấp để thử → lên hạng → thấy giá nhóm Bạc.

## Rollback

`loyalty.enabled=false`: không tích/không dùng mới; số dư giữ nguyên (nợ với khách), sổ giữ nguyên.

## Rủi ro

- Điểm là nợ phải trả với khách: báo cáo "điểm đang lưu hành × giá trị" cho kế toán; hạn điểm và điều khoản phải công bố cho khách
  (chờ pháp lý).
- Gian lận tạo nhiều tài khoản: chỉ khách xác minh OTP mới tích; giới hạn điểm/ngày cấu hình được.
