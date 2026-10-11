# O6 — Vận hành, báo cáo ngày và go-live

## 1. Mục tiêu

Quán xem doanh thu theo ngày, chốt tiền mặt cuối ngày, xuất CSV; kỹ thuật thấy hệ thống có khỏe không và nhận
cảnh báo; hạ tầng sẵn sàng chạy thật.

## 2. Trạng thái

📝 **Có spec cũ, giữ gần nguyên.** Chưa code. Báo cáo tháng, biểu đồ, món bán chạy, Excel, danh sách khách đã
chốt **để sau go-live** (`later.md`).

## 3. Input / Output

| Màn / Job | Input | Output |
| --- | --- | --- |
| **Báo cáo ngày** | khoảng ngày kinh doanh, chi nhánh | số đơn hoàn tất, hủy, từ chối, **không thể hoàn tất** (tách riêng), doanh thu gộp, giảm giá, phí giao, hoàn tiền, doanh thu thuần; theo cách thanh toán, cách nhận |
| **Chốt tiền mặt** | ngày kinh doanh, chi nhánh, số đếm thực tế | `cash-closing`, chênh lệch theo nhân viên / người giao |
| **Xuất CSV đơn** | khoảng ngày (giới hạn), chi nhánh | file CSV, tối đa 10.000 dòng; quyền `export` |
| **Tình trạng vận hành** | — | outbox đang chờ + tuổi lâu nhất, webhook thành công gần nhất theo provider, lần chạy job gần nhất, cảnh báo đang mở |
| **Cảnh báo** | rule + ngưỡng (cài đặt) | `webhook-failing`, `payment-unmatched`, `outbox-stuck`, `job-heartbeat-missed`, `order-awaiting-acceptance`, `reconciliation-mismatch`, `manual-payment-unconfirmed`, `cash-closing-mismatch`, `secret-rotation-due` |
| **Job xóa dữ liệu theo hạn** | thời hạn (cài đặt) | xóa field cá nhân trong payload thô (mặc định 180 ngày), outbox đã giao 30 ngày, lỗi 90 ngày |
| **Màn Khóa & bí mật** | — | danh sách key, tuổi, lần xoay gần nhất, số bản ghi còn dùng key cũ; **không hiện giá trị** |

## 4. Đã làm

Ngày kinh doanh, outbox, khóa job, bảng alert có từ O1. App đã có xuất CSV lead (`src/shared/csv`, giới hạn 10.000
dòng) dùng lại được.

## 5. Chưa làm

1. Báo cáo ngày (đọc từ snapshot, không tính lại từ catalog hiện tại).
2. Chốt tiền mặt.
3. Xuất CSV.
4. Trang tình trạng + đủ rule cảnh báo + người nhận theo vai trò.
5. Job xóa dữ liệu theo hạn.
6. Màn Khóa & bí mật + nhắc xoay key.
7. Hạ tầng: Cloudflare cho webhook, SSE qua proxy, backup, deploy Dokploy có plugin.
8. Runbook tiếng Việt: nhân viên (xử lý đơn, giao dịch, chốt tiền), kỹ thuật (cảnh báo, đối soát, khôi phục,
   **xoay từng secret**). Diễn tập xoay secret trên staging.

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Báo cáo chậm, N+1 | Query tổng hợp theo nhóm, index theo `businessDate` + chi nhánh; test đếm query |
| Báo cáo đổi khi sửa giá món | Đọc từ snapshot dòng hàng |
| CSV lộ dữ liệu cá nhân | Quyền `export` riêng, giới hạn khoảng ngày, ghi audit mỗi lần xuất |
| Cảnh báo dồn dập | Gộp theo key, "đã biết", ngưỡng critical |

## 7. Edge case

- Đơn lúc 01:30 sáng thuộc ngày kinh doanh hôm trước.
- Hoàn tiền ngày khác với ngày đặt → ghi vào ngày hoàn.
- Chốt tiền mặt hai lần cùng ngày → lần sau sửa lần trước, có lịch sử.
- Job xóa dữ liệu chạy giữa lúc đối soát → khóa job tránh chồng.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Deploy thật và hạ tầng.** Lý do: gate staging của O0 đã bị dời tới đây, nên mọi thứ chỉ kiểm được trên server
thật (Dokploy, Cloudflare, SSE qua proxy, webhook công khai) đều dồn vào phase này; lỗi hạ tầng khó tái hiện ở
local và mỗi vòng sửa phải deploy lại.

## 9. Gate / Acceptance

lint, typecheck, test, build, `check:ordering`. UAT: báo cáo ngày khớp đơn thử; chốt tiền mặt có chênh lệch;
CSV mở được bằng Excel; tắt dispatcher → cảnh báo `outbox-stuck`; webhook qua Cloudflare đạt.

**Cổng go-live (không phải code):** tài khoản SePay thật thử bằng giao dịch nhỏ; kế toán chốt hóa đơn điện tử và
VAT; pháp lý chốt thời hạn lưu và nội dung đồng ý; nội dung email đã duyệt; kết quả gate O1–O6 ghi trong
`docs/STATUS.md`; quyết định số instance.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-6-ops-golive.md`, `docs/plans/ordering-o6-ops-golive.md`,
`docs/plans/ordering-o6-screens.md`, contracts mục 12, 15, 19.3.
