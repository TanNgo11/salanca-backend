# O0 — Thử nghiệm plugin trên Strapi 5.51.1

## 1. Mục tiêu

Chứng minh Strapi 5.51.1 làm được các việc kỹ thuật lõi trước khi viết nghiệp vụ: plugin TypeScript, transaction
và khóa dòng, migration riêng, phân quyền theo chi nhánh, job chạy nhiều process, webhook đọc body gốc, custom
field đa ngôn ngữ, mở rộng field từ app.

## 2. Trạng thái

✅ **Đóng 2026-10-10.** Branch `spike/ordering-plugin` (5 commit `2c5b3c7` … `562ad18`). UAT Admin đạt local.
Gate staging Dokploy được chủ dự án bỏ, dời sang O6.

## 3. Input / Output

Không có API nghiệp vụ. Kết quả là **7 quyết định kỹ thuật D1–D7** dùng cho mọi phase sau:

| # | Quyết định |
| --- | --- |
| D1 | Server plugin build bằng `tsc` ra `dist/server`; admin đọc source TS. `config/plugins.ts` báo lỗi khi bật mà chưa build |
| D2 | Bảng/cột do Strapi tạo; việc schema sync không làm được (index, ràng buộc, backfill) chạy bằng **migration runner của plugin** (bảng `plugins_ordering_migrations`, advisory lock, chỉ tiến) |
| D3 | Condition Admin nhận thẳng object user; trả `null` là **từ chối** (fail-closed). Service vẫn tự áp scope |
| D4 | Body gốc (`includeUnparsed`) và CORS cho `X-Order-Token`, `Idempotency-Key` chỉ bật khi `ORDERING_ENABLED=true` |
| D5 | Claim job: `FOR UPDATE SKIP LOCKED` + lease + fencing + consumer idempotent |
| D6 | Luôn sinh `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true` |
| D7 | Giữ khung plugin làm nền O1, bỏ code chỉ để thử |

## 4. Đã làm

19 mục kiểm + 3 mục thêm, có script chạy thật (`scripts/spike-ordering/*.mjs`, 13 script):
- Transaction: 20/20 cập nhật song song không mất; 200 mã sequence không trùng; rollback sạch.
- Job 2 process: 200/200 giao đúng một lần; 10 dòng được nhận lại sau lease 3 giây khi một worker chết.
- Migration trên bảng 1.000 dòng: thêm cột → backfill theo lô → `NOT NULL`; 2 runner chạy cùng lúc, mỗi
  migration chạy đúng một lần.
- Phân quyền: admin thật, engine thật của Strapi: nhân viên A chỉ thấy đơn A.
- Webhook: chữ ký đúng 200, sửa body 401, thiếu body gốc 500 `RAW_BODY_UNAVAILABLE`.
- Field app thêm qua extension còn nguyên sau khi nâng phiên bản plugin.
- Plugin không tự mở REST theo tên content type (6 đường đoán đều 404).
- UAT: menu "Bán hàng", type nội bộ ẩn khỏi Content Manager/Content-Type Builder, ô nhập VI/EN lưu đúng JSON.

## 5. Chưa làm

- Deploy thử lên Dokploy, preflight qua Cloudflare (dời O6).
- Contract test phản hồi SePay/VNPAY/MoMo (dời O4).

## 6. Lỗi đã gặp và cách xử lý

| Lỗi | Xử lý |
| --- | --- |
| Đọc source kết luận condition trả `null` là **mở quyền** (fail-open) — sai | Chạy engine thật với admin thật: `null` một mình → từ chối; `null` cạnh condition khác → bị bỏ qua. Sửa tài liệu reference C17.1 |
| Strapi **bỏ qua im lặng** plugin chưa build server (không báo lỗi) | D1: `config/plugins.ts` kiểm `dist/server` tồn tại, báo lỗi rõ |
| Bật body gốc có thể phá upload | Kiểm: `koa-body` chỉ giữ body gốc cho json/form/text; multipart không ảnh hưởng; smoke form đạt |
| `check:phase3` trên DB dev dừng ở `smoke:i18n` | Script cố ý đòi DB trống; chạy trên DB riêng, không xóa dữ liệu thật |

## 7. Edge case đã kiểm

Worker chết giữa chừng khi đang giữ job; 2 runner migration cùng lúc; ngày kinh doanh qua nửa đêm khi server
chạy UTC; plugin bật/tắt nhiều lần; app bật i18n nhưng catalog không i18n; truy vấn JSON `slug->>'vi'`.

## 8. Lỗi tốn thời gian nhất và vì sao

**Kết luận sai về condition `null`.** Thời gian chính xác không ghi lại (commit gộp). Lâu vì:
- Kết luận ban đầu đến từ **đọc source**, trông hợp lý nên đã ghi vào tài liệu reference.
- Muốn kiểm phải dựng **admin user thật + permission thật + engine thật** (`generateTokenAbility`,
  `createPermissionsManager`), không mock được.
- Hệ quả nếu sai rất nặng (lộ đơn chi nhánh khác), nên phải kiểm cả hai trường hợp (`null` một mình, `null`
  cạnh condition khác).

Bài học ghi vào quy tắc: **hành vi bảo mật của Strapi phải chứng minh bằng script chạy thật, không kết luận từ
đọc code.**

## 9. Gate đã chạy

lint, typecheck, test (112 file / 677 test), build, `check:phase3` bật và tắt plugin (159 s / 177 s), 13 script
spike — đều đạt.

## 10. Tài liệu chi tiết

`docs/plans/ordering-spike-report.md`, `docs/plans/ordering-spike.md`, `docs/phases/phase-ordering-0-spike.md`.
