# O5 — Giao tận nơi (quán tự giao): kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-5-delivery.md`](../phases/phase-ordering-5-delivery.md)

Đặc tả màn hình: [`ordering-o5-screens.md`](ordering-o5-screens.md) (reference mục U5). Mọi màn UI làm theo file đó.

## Goal

Khách chọn giao tận nơi trong vùng, thấy phí trước khi đặt; quán gán người giao và theo dõi tới khi giao
xong; người giao thu tiền mặt.

## Non-goals

- Tích hợp hãng giao, tính khoảng cách bằng bản đồ, theo dõi vị trí người giao.

## Current evidence

- O4 xong.
- Đơn vị hành chính 2 cấp (34 tỉnh/thành, 3.321 xã/phường) từ 01/07/2025 (reference B6).
- TastyIgniter `CoveredArea`: rule theo giá trị đơn, rule đầu tiên khớp thắng, `-1` là không giao
  (reference C17.4).

## Decisions and assumptions

- Decision: khớp vùng theo mã xã/phường, không dùng bản đồ.
- Owner decision required: nguồn chính thức của danh mục xã/phường để đóng gói vào plugin (đề xuất danh
  mục của Tổng cục Thống kê); chủ dự án xác nhận trước bước 1.
- Owner decision required: danh sách xã/phường giao, bảng phí, đơn tối thiểu cho chi nhánh Salanca, trước
  UAT.

## Invariants

- Phí giao luôn tính ở server, nằm trong `fulfillmentAmount` của group, tổng đơn khớp.
- Đơn giao bắt buộc có số điện thoại và địa chỉ snapshot.
- Snapshot địa chỉ lưu cả mã và tên tại lúc đặt; đổi danh mục không sửa đơn cũ.

## Implementation steps

1. **Danh mục hành chính**
   - Files: `server/src/data/admin-units/<phiên bản>.json`, `services/admin-units.ts`,
     `GET /ordering/admin-units` (chỉ đọc, cache dài).
   - Verification: số tỉnh/thành và xã/phường đúng với nguồn; tìm theo tên không dấu chạy được.
2. **Vùng giao trong setting chi nhánh**
   - Files: `domain/delivery/zones.ts` (zod `DeliveryZone`, khớp vùng, rule phí), `admin/src/pages/Settings/DeliveryZones/`.
   - Verification: Vitest dạng bảng: đơn tối thiểu, các bậc phí, miễn phí, ưu tiên vùng, ngoài vùng.
3. **Provider `self-delivery`**
   - Files: `providers/self-delivery.ts`.
   - Làm: `getOptions`, `validate`, `calculatePrice`, `create` (fulfillment có `addressSnapshot`); ngoài vùng
     `DELIVERY_UNAVAILABLE`; thời gian giao cộng vào lead time.
   - Verification: tích hợp: quote ra đúng phí, tổng đơn khớp.
4. **Địa chỉ**
   - Files: `domain/contact/address.ts` (số điện thoại đã làm ở O3).
   - Verification: Vitest cho địa chỉ thiếu xã/phường, mã không có trong danh mục.
5. **Workflow giao**
   - Files: `domain/workflow/definitions/delivery-*.ts` (3 kiểu thanh toán), `services/delivery-assignment.ts`.
   - Làm: sẵn sàng → đang giao (gán `assigneeRef`, tracking tay) → đã giao | giao thất bại (lý do bắt buộc;
     giao lại hoặc hủy và hoàn); "Thu tiền và giao" cho người giao.
   - Verification: tích hợp các nhánh; hủy sau khi thu tạo refund đúng.
6. **Admin**
   - Files: `admin/src/pages/Deliveries/` (đơn đang giao theo người giao), nút trong chi tiết đơn.
   - Verification: UAT theo spec O5.
7. **Email khách** ở các bước giao công khai (template VI/EN).
8. **Smoke và tài liệu**
   - Files: `scripts/smoke-ordering-delivery.mjs`, `docs/ordering-staff-guide.md` (phần giao hàng),
     `docs/ordering-api-contract.md` (địa chỉ, phí giao).

## Data and rollback

- Migration/backfill: không có bảng mới (setting và fulfillment đã có); thêm file dữ liệu tĩnh.
- Rollback: tắt `delivery` trong setting chi nhánh.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`, `node scripts/smoke-ordering-delivery.mjs`.
- Manual UAT: theo spec O5.
- Evidence to record: Completion record, `docs/STATUS.md`.

## Documentation impact

- `docs/ordering-staff-guide.md`, `docs/ordering-api-contract.md`, `docs/STATUS.md`.

## Risks and blockers

- Chờ chủ dự án xác nhận nguồn danh mục và dữ liệu vùng giao.
- Danh mục hành chính có thể còn điều chỉnh: đóng gói theo phiên bản.

## Completion record

- Chưa bắt đầu.
