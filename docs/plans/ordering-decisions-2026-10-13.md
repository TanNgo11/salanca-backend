# Quyết định mặc định cho O9, O13, O16 (2026-10-13)

Chủ dự án giao: "cái nào quyết được thì quyết, còn lại chưa có thì build adapter trước". Mọi giá trị dưới đây là
**cấu hình** (config plugin hoặc Cài đặt bán hàng), đổi được trước khi mở cho khách thật mà không phải sửa code. Các ô
"Cần xác nhận" không chặn code; chúng chặn **mở bán / bật cho khách thật**.

## O9 — Thẻ quà tặng

| Câu | Mặc định | Cấu hình | Cần xác nhận |
| --- | --- | --- | --- |
| Hạn dùng | 12 tháng kể từ ngày phát; quản lý gia hạn được từng thẻ (có lý do, ghi O15) | `giftCards.validityMonths` = 12 | Pháp lý: công bố điều khoản cho khách |
| Hóa đơn | **Không** xuất hóa đơn lúc bán thẻ: tiền bán thẻ là khoản nhận trước (nợ với khách), báo cáo tách "Bán thẻ" khỏi doanh thu. Hóa đơn của món ăn xuất theo đơn khi dùng thẻ. Plugin không làm hóa đơn điện tử. | — | **Kế toán**: xác nhận ghi nhận doanh thu lúc dùng, trước khi mở bán |
| Số dư hết hạn | Job hằng ngày ghi sổ `expire`; báo cáo riêng "Số dư thẻ hết hạn" để kế toán xử lý | — | Kế toán: hạch toán khoản này |
| Thẻ giấy | **Có**: nhập lô mã in sẵn (CSV hoặc sinh lô để in), thẻ ở trạng thái `inactive`, chỉ kích hoạt khi bán ở quầy (đơn hộ + thu tiền) | `giftCards.physicalBatches` = true | Không |
| Hoàn tiền thẻ chưa dùng | **Không**. Quản lý chỉ khóa thẻ. Trường hợp đặc biệt: quản lý có quyền riêng điều chỉnh số dư về 0 kèm lý do và hoàn ngoài hệ thống | `giftCards.refundable` = false | Không |
| Mệnh giá | Biến thể cố định do quán tạo (vd. 200.000đ, 500.000đ); không mệnh giá tự chọn | — | Không |

## O13 — Provider

| Câu | Quyết định |
| --- | --- |
| Có làm không khi chưa có sandbox | **Có, build adapter trước** theo tài liệu công khai của từng hãng, test bằng server giả lập (fixture lấy từ tài liệu chính thức). Mỗi provider **tắt mặc định** (`providers.<code>.enabled = false`) và ghi rõ "chưa kiểm sandbox" trong Admin và Completion record. Bật thật chỉ sau UAT sandbox. Thay cho dòng "Thiếu provider nào thì bỏ — không code đoán" của spec. |
| Ví | MoMo và VNPay (cả hai). |
| Hãng giao | **Ahamove**. **Không làm GHN** trong O13 (để sau, adapter giống Ahamove nếu cần). |
| SMS | **eSMS.vn** (brandname + OTP, API HTTP JSON, phổ biến ở VN). Interface `notification-provider` giữ chung để thêm SpeedSMS/Viettel về sau mà không đổi lõi. |
| Zalo | Zalo ZNS qua Zalo OA. Map biến theo mẫu; mẫu chưa duyệt thì kênh ZNS không bật. |
| OTP O11 | Thêm kênh `sms` (và `zalo` khi bật) cho OTP; `email` vẫn là mặc định. |
| Chi phí | Ước tính phí theo tin cấu hình được; giới hạn gửi theo ngày `notifications.dailyLimit` = 2.000 tin. |

Cần chủ dự án: đăng ký và đưa tài khoản sandbox (MoMo, VNPay, Ahamove, Zalo OA + mẫu ZNS đã duyệt, eSMS) — **chặn bật
provider thật**, không chặn code.

## O16 — Tích điểm và hạng

| Tham số | Mặc định | Cấu hình |
| --- | --- | --- |
| Tích điểm | 1 điểm / 10.000đ tiền món **sau giảm giá**; không tính phí giao, phí dịch vụ, tip, phần trả bằng thẻ quà tặng hoặc bằng điểm. Chỉ khách đã xác minh OTP. Chỉ khi đơn `completed`. | `loyalty.earnPerAmount` = 10000 |
| Giá trị điểm | 1 điểm = 100đ khi dùng (≈ 1% hoàn lại ở hạng thường) | `loyalty.pointValue` = 100 |
| Dùng điểm | Tối thiểu 50 điểm/lần; tối đa giảm **50%** tiền món của đơn | `loyalty.minRedeemPoints` = 50, `loyalty.maxRedeemShare` = 0.5 |
| Hạn điểm | 12 tháng theo lô, dùng lô cũ trước; email nhắc trước 14 ngày (một lần) | `loyalty.expiryMonths` = 12, `loyalty.expiryReminderDays` = 14 |
| Hạng (chi tiêu 12 tháng gần nhất) | **Thành viên** 0đ, ×1.0 · **Bạc** từ 2.000.000đ, ×1.2 · **Vàng** từ 5.000.000đ, ×1.5 | Admin cấu hình hạng |
| Lên / xuống hạng | Lên ngay khi đơn hoàn tất vượt mốc; xuống khi xét lại hằng ngày, ân hạn 30 ngày | `loyalty.downgradeGraceDays` = 30 |
| Hạng ↔ nhóm giá O14 | Mỗi hạng gắn một `customer-group` (`hang-bac`, `hang-vang` tạo sẵn, **chưa** kèm bảng giá — quán tự thêm) | Admin |
| Chống gian lận | Tối đa 2.000 điểm/khách/ngày | `loyalty.dailyEarnCap` = 2000 |
| Hủy bớt món | Trả tiền theo phân bổ; **không** trả điểm phần đã dùng, trừ khi hủy cả đơn (trả lại toàn bộ điểm đã dùng, thu hồi điểm đã tích nếu có) | — |

Cần xác nhận trước khi mở cho khách: **pháp lý/kế toán** — điều khoản chương trình công bố cho khách, và hạch toán điểm
đang lưu hành (báo cáo "điểm × giá trị" đã có trong plan).
