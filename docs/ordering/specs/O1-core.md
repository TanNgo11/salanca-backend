# O1 — Lõi đơn hàng

## 1. Mục tiêu

Có toàn bộ nghiệp vụ lõi của đơn hàng chạy bằng service và test, chưa có API, chưa có UI: dữ liệu, tiền, tính
giá, workflow, thanh toán/hoàn tiền, outbox, idempotency, giữ slot, chi nhánh và phân quyền theo chi nhánh.

## 2. Trạng thái

✅ **Đóng 2026-10-10** (UAT Admin đạt). Branch `feat/ordering-o1` (18 commit `f8220d1` … `bce6979` + docs),
đã push, **chưa merge `main`**.

## 3. Input / Output

Không có route HTTP. Đầu vào/đầu ra là **service** (gọi từ code):

| Service | Input | Output / Hiệu ứng | Lỗi chuẩn |
| --- | --- | --- | --- |
| `order.createOrder` | dòng hàng (ref, số lượng, biến thể, tùy chọn), chi nhánh, cách nhận, slot, liên hệ, `Idempotency-Key` | đơn + dòng + group + hold + timeline + outbox `order.placed`, **1 transaction**; trả mã đơn + `publicToken` (một lần) | `IDEMPOTENCY_PAYLOAD_MISMATCH`, `SELLABLE_UNAVAILABLE`, lỗi scope |
| `pricing` (thuần) | dòng hàng, điều chỉnh, thuế | 9 bước tính giá, phân bổ phần dư lớn nhất xuống từng dòng | — |
| `transition` | group, bước đích, actor | đổi bước dưới khóa dòng, cập nhật `order.status` (projection), timeline, outbox | `INVALID_TRANSITION`, xung đột khi 2 người bấm cùng lúc |
| `payment` / `refund` | số tiền, provider, event của provider | sổ thanh toán, hoàn tiền; event trùng bị bỏ | `needs-review` / `order-not-found` khi event không khớp |
| `line-cancel` | dòng, số lượng hủy | hủy một phần món, hoàn phần tiền tương ứng | — |
| `outbox` dispatcher | sự kiện chưa gửi | gọi consumer đúng một lần, retry, `failedAt` khi quá số lần | — |
| `scope` | admin user, chi nhánh | lọc mọi truy vấn đơn theo chi nhánh được gán | từ chối khi không có scope |
| `businessDate` | thời điểm, giờ chốt chi nhánh | ngày kinh doanh (vd thứ Bảy 01:30, chốt 04:00 → thứ Sáu) | — |

Dữ liệu: **20 content type nội bộ** `plugins_ordering_*` (order, line, group, fulfillment, adjustment, payment,
payment-event, refund, refund-line, timeline, outbox, idempotency, hold, job lock, staff scope, alert, branch,
change-log, …), ẩn khỏi Content Manager và Content-Type Builder. Migration `0001-o1-core`.

## 4. Đã làm

- 15 bước theo kế hoạch, mỗi bước 1 commit.
- Ví dụ trong mockup thành test: giảm 25.000đ chia 14.773 / 5.114 / 5.113; VAT 8% gồm trong giá
  8.535 / 2.955 / 2.955; hoàn Trà đào 39.886; hủy 1/3 Gỏi cuốn 13.296.
- 11 script tích hợp (`pnpm run check:ordering`): 200 đơn song song mã không trùng; 2 transition song song → 1
  đạt 1 bị từ chối; 500 event outbox giao đúng một lần qua 2 process; plugin tắt/bật không mất dữ liệu; scope
  qua engine phân quyền Strapi.
- README cho dev plugin (`src/plugins/ordering/README.md`).

## 5. Chưa làm (chuyển sang phase sau)

- Route HTTP, màn Admin (O3a, O3b).
- Provider thật: catalog (O2), thanh toán SePay (O4), tiền mặt (O3a), email (O3c). Hiện chỉ có provider test.
- Token khi gửi lại request tạo đơn: đã chốt lưu token mã hóa (O3a, dùng keyring của OF).
- Trạng thái "Không thể hoàn tất" (OF).

## 6. Lỗi đã gặp và cách xử lý

| Lỗi | Phát hiện | Xử lý |
| --- | --- | --- |
| **Tắt plugin làm mất mọi bảng** `plugins_ordering_*` | `check:phase3` tắt rồi bật → index của migration biến mất | Bootstrap ghi tên bảng vào core store `persisted_tables` (cơ chế Strapi dùng cho bảng audit EE). Script `disable-survives.mjs` kiểm bật → tắt → bật còn dữ liệu và index. Commit `bce6979` |
| **`unique: true` không tạo unique index** ở PostgreSQL (Strapi chỉ kiểm ở tầng entity, 2 request song song vẫn trùng) | Khi viết test mã đơn song song | Migration tự tạo unique index cho `order.code`, `publicTokenHash`, `branch.code`, `staff-location-scope.adminUserId`, `outbox.uniqueKey`. Commit `8e1f9fd` |
| Condition `same-location` đăng ký ở `bootstrap()` không có hiệu lực | Test scope | Đăng ký trong `register()` |
| Replay idempotent không có `publicToken` (token chỉ cấp một lần) → khách mất link theo dõi nếu rớt mạng lúc đặt | Review O1 | Chốt: lưu token mã hóa AES-256-GCM trong bản ghi idempotency, replay trả lại token cũ (làm ở O3a) |
| Outbox retry vô hạn khi consumer luôn lỗi | Review | Thêm `failedAt`, dừng sau `maxAttempts` |

## 7. Edge case đã có test

- 2 nhân viên bấm cùng một đơn cùng lúc → chỉ 1 đạt.
- Cùng `Idempotency-Key` khác payload → `IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Worker chết khi đang giữ event → event được nhận lại sau lease.
- Event thanh toán trùng từ provider → ghi một lần.
- Event không khớp đơn nào → `needs-review`.
- Làm tròn tiền mặt nửa ra xa số 0 (195.500 → 196.000).
- Hoàn tiền không mở lại đơn đã hoàn tất; đơn "completed" khi `Σ đã thu ≥ tổng`.
- Hủy một phần món không tự hủy group, không đổi tổng đơn ban đầu.
- Ngày kinh doanh qua nửa đêm; mã chi nhánh không đổi được sau khi tạo.

## 8. Lỗi tốn thời gian nhất và vì sao

**Tắt plugin làm mất bảng** (commit `bce6979`). Theo git: bước cuối O1 commit 15:09, bản sửa 15:52 →
**khoảng 45 phút** (ước lượng; commit được gộp nên không chính xác tuyệt đối). Lâu vì:

1. **Triệu chứng xa nguyên nhân.** Thấy "mất index", không thấy "mất bảng". Bảng bị Strapi xóa rồi tạo lại
   rỗng khi bật lại; còn bảng `plugins_ordering_migrations` (do runner tạo, không thuộc schema) vẫn còn, nên
   runner tưởng migration đã chạy và **không tạo lại index**.
2. **Nguyên nhân nằm sâu trong schema sync của Strapi**, không có trong tài liệu: Strapi xóa bảng có trong
   schema lưu lần trước mà không có trong schema hiện tại.
3. **Mỗi lần thử lại tốn ~6 phút** (`check:phase3` tắt ~159 s + bật ~177 s) và phải chạy theo đúng thứ tự.
4. **Cách sửa không có tài liệu**: phải tìm ra core store `persisted_tables`, cơ chế Strapi dùng cho bảng
   audit bản EE.

Hệ quả: rollback "tắt cờ `ORDERING_ENABLED`" trong các spec chỉ an toàn từ bản này. Mọi phase sau phải giữ
`disable-survives.mjs` đạt.

## 9. Gate đã chạy (2026-10-10, DB `salanca_ordering_test`)

lint, typecheck, test (129 file / 857 test), build, `check:phase3` tắt và bật, `check:ordering` 11/11 — đều
đạt. UAT: 20 bảng nội bộ không hiện ở Content Manager/Content-Type Builder.

## 10. Tài liệu chi tiết

`docs/plans/ordering-o1-core.md` (Completion record), `docs/phases/phase-ordering-1-core.md`,
`docs/plans/ordering-core-contracts.md` mục 3–8, 12, `src/plugins/ordering/README.md`.
