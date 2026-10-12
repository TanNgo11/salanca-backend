# Phase O12 — Tính năng nhà hàng

Trạng thái: spec chờ duyệt (2026-10-12). Roadmap: [`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md).
Mockup: [`plans/mockups/ordering-o12-restaurant.html`](../plans/mockups/ordering-o12-restaurant.html).
**Đặc tả màn hình:** [`plans/ordering-o12-screens.md`](../plans/ordering-o12-screens.md) (reference mục U12).
Kế hoạch thực hiện: [`plans/ordering-o12-restaurant.md`](../plans/ordering-o12-restaurant.md).

## Goal

Đủ công cụ cho quán ăn vận hành đơn online và tại chỗ: in phiếu bếp/hóa đơn tạm, màn hình bếp, tạm dừng nhận đơn khi
đông, tự từ chối đơn không ai nhận, phí dịch vụ/đóng gói, tiền tip, thông tin dị ứng/ăn kiêng, đặt món tại bàn bằng QR.

## Điều kiện bắt đầu

- O7 đã merge (sửa đơn, giới hạn ngày). Không phụ thuộc O8–O11 (tip/phí đi qua pipeline chung).

## Scope

- **In:** trang in khổ 58/80 mm cho phiếu bếp (món, tùy chọn, ghi chú, giờ nhận, không giá) và hóa đơn tạm (giá, giảm,
  phí, tip, tổng, cách trả, QR thanh toán nếu còn nợ); in tay từ chi tiết đơn; tự in khi nhận đơn (máy quầy mở trang
  in tự động — Chrome kiosk-printing). Mẫu in theo chi nhánh (tên, địa chỉ, dòng cuối).
- **Màn hình bếp (KDS):** cột Mới / Đang làm / Xong, thẻ to, thời gian chờ tô màu theo ngưỡng; bấm từng món "xong"; bấm
  thẻ "Xong cả đơn" → chuyển `ready`; âm báo đơn mới; lọc theo trạm (nhóm món: bếp nóng, quầy nước).
- **Tạm dừng nhận đơn:** "Tạm dừng 15/30/60 phút / đến hết ngày" theo chi nhánh và cách nhận, tự mở lại; "Quán đông: cộng
  thêm 10/20/30 phút" vào giờ sẵn sàng ASAP trong khoảng thời gian chọn. Web và quote trả trạng thái rõ.
- **Tự từ chối đơn không ai nhận:** sau N phút ở chờ nhận (cấu hình theo chi nhánh/cách nhận) hệ thống từ chối với lý do
  "Quán không phản hồi", hoàn tiền (đường hoàn O5), email khách.
- **Phí dịch vụ / đóng gói:** cấu hình theo chi nhánh: tên, số tiền hoặc %, theo cách nhận, có chịu thuế; vào pipeline
  là adjustment `fee`; hiện trong quote/đơn/hóa đơn.
- **Tip:** khách chọn 0/5/10/15% hoặc số tiền (cấu hình theo chi nhánh), cộng vào tổng, không bị giảm giá; ghi riêng
  `tipAmount`; tip tiền mặt vào chốt tiền của người thu (cột riêng); báo cáo tip theo ngày/người giao.
- **Dị ứng/ăn kiêng:** món có danh sách chất gây dị ứng (14 nhóm phổ biến + tự thêm) và nhãn (chay, cay, không đường…);
  API catalog trả; lọc được.
- **Đặt món tại bàn (QR):** bàn theo chi nhánh có mã QR (token); khách quét → menu của chi nhánh, đơn `dine-in` gắn bàn;
  nhiều đơn của một bàn gom vào **phiên bàn**; thanh toán một lần khi khách xong (tiền mặt/chuyển khoản tại quầy) hoặc
  trả trước từng đơn (cấu hình); quán đóng phiên. Không cần đăng nhập khách.

## Non-goals

- Driver máy in ESC/POS, in qua mạng LAN trực tiếp, app in riêng (dùng hộp thoại in của trình duyệt/kiosk).
- Sơ đồ bàn kéo thả, ghép/tách bàn, chia hóa đơn theo người, gọi phục vụ.
- POS bán tại quầy đầy đủ (chỉ có đơn tại bàn + đơn hộ khách O3).

## Acceptance

### Automated

```powershell
pnpm run lint; pnpm run typecheck; pnpm run test
pnpm run check:ordering     # thêm print, kds, pause, auto-reject, fees-tips, allergens, dine-in
pnpm run check:phase3       # DB test, plugin tắt và bật
pnpm exec strapi build      # plugin tắt và bật
```

Test bắt buộc:

- Tạm dừng: quote/tạo đơn trong lúc dừng → `LOCATION_PAUSED` (kèm `resumeAt`); tự mở lại đúng giờ; "quán đông" cộng phút
  vào `estimatedReadyAt` ASAP, hết hạn thì thôi.
- Tự từ chối: đúng phút; đơn đã trả → hoàn (tiền mặt `settled`, chuyển khoản `pending`, thẻ O9 về số dư); chạy hai
  process không từ chối hai lần; đơn được nhận ngay trước hạn không bị từ chối.
- Phí: % và cố định; theo cách nhận; tổng khớp; hủy bớt món tính lại phí % đúng (phí cố định giữ).
- Tip: không bị khuyến mãi giảm; hoàn khi hủy; chốt tiền tách tip; quote = create.
- KDS: chỉ đơn trong scope; bấm món xong idempotent; "Xong cả đơn" = transition `ready` (người khác đã chuyển → 409).
- Tại bàn: token QR sai/bàn tắt → 404; 3 đơn cùng bàn → một phiên; đóng phiên khi còn nợ → chặn; trả một lần cho cả
  phiên ghi payment đúng từng đơn; phiên quên đóng tự đóng cuối ngày kinh doanh + alert.
- Dị ứng: catalog trả đúng; lọc `excludeAllergens`.
- In: trang in đúng nội dung, không lộ SĐT đầy đủ trên phiếu bếp.

### Manual UAT

- [ ] Máy quầy Chrome kiosk-printing tự in phiếu bếp khi nhận đơn trên máy in nhiệt 80 mm thật.
- [ ] KDS trên TV/tablet trong giờ cao điểm thử (10 đơn).
- [ ] Tạm dừng 15 phút → web báo tạm dừng → tự mở lại.
- [ ] Quét QR bàn 5, đặt 2 lần, thanh toán một lần tại quầy, đóng bàn.

## Rollback

Mỗi tính năng có cờ trong setting chi nhánh (`printing`, `kds`, `autoReject`, `fees`, `tips`, `dineIn`); tắt là về hành
vi O7. Bảng mới giữ lại.

## Rủi ro

- Tự từ chối đơn chạm tiền và trải nghiệm khách → mặc định tắt, quán tự bật và chọn số phút.
- Đơn tại bàn trả sau có thể bị bỏ dở → job đóng phiên cuối ngày + alert, báo cáo phiên còn nợ.
