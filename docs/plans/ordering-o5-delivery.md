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

Trạng thái: **automated verification passed; manual UAT passed** (browser, xem mục UAT bên dưới).
Chưa push, chưa merge — nhánh `feat/ordering-o5`.

### Bước → commit

| Bước | Nội dung | Commit |
| --- | --- | --- |
| 1 | Catalog đơn vị hành chính (loader + fixture XT) | `407aa65` |
| 2 | Vùng giao + phí theo branch settings, quote | `b10bfa2` |
| 3 | Provider `self-delivery`, phí vào `fulfillmentAmount` | `f313ef2` |
| 4 | Validate + snapshot địa chỉ giao (`communeCode`, alias `wardCode`) | `9359e59` |
| 5 | 3 workflow delivery + service `delivery-assignment` (gán/thất bại/thử lại/hoàn tất, đồng bộ group) | `33399c9` |
| 6 | Board Đơn giao: list filters, `delivery-staff`, UI gán nhân viên quán/xe ngoài | `006b773` |
| 7 | Email khách VI/EN với wording giao hàng (đang giao, thất bại + lý do, đã giao) | `03ef864` |
| 8 | `smoke-ordering-delivery.mjs`, UAT server seed đơn giao, sửa `paymentByToken`/`withinCancelWindow` theo receive kind, docs | `c0695bb` |

### Sửa sau review (2026-10-12)

| Finding | Sửa | Commit |
| --- | --- | --- |
| `POST /orders/:id/transition { to: canceled }` (quyền `order.process`) đóng đơn mà không hoàn tiền | Transition từ chối trạng thái hủy (`INVALID_TRANSITION`, `details.use: "cancel"`); hủy chỉ qua `/cancel` (`order.cancel`). Từ chối/hết hạn khi đơn đã có tiền thì hoàn trong cùng transaction: tiền mặt `settled`, chuyển khoản phiếu `pending` (contracts §19.1). Vòng hoàn tiền tách thành helper dùng chung với `cancel` | `6f68dbc` |
| `outbox-two-process.mjs` chập chờn trong full run: A boot trước, xử lý hết 500 event trước khi B kịp nhận batch | Worker in `READY` sau boot, chờ `go` trên stdin; parent thả cả hai cùng lúc. Chạy riêng 5/5 đạt | `49d3417` |
| Cảnh báo `pg` "client.query() when the client is already executing a query" | Không sửa: nguồn là `@strapi/database` populate (`Promise.all` theo từng relation, `dist/query/helpers/populate/apply.js`) khi `loadOrderAggregate` populate nhiều relation trong transaction. `pg` khóa `8.20.0`; xem lại khi nâng `pg@9` hoặc Strapi | — |
| STATUS ghi "working tree", số gate cũ | Cập nhật bên dưới và `docs/STATUS.md` | docs |

Chưa sửa: `phase-ordering-5-delivery.md` vẫn ghi "spec chờ duyệt" — duyệt spec và đóng phase là quyết định
của chủ dự án.

### Automated verification (tất cả exit 0)

- `pnpm run lint`, `pnpm run typecheck`
- `pnpm run test`: 159 file / 1097 test
- `pnpm run check:ordering`: 41/41 (gồm `admin-units`, `delivery-quote`, `delivery-assignment`, `notifications`)
- Chạy lại sau review (2026-10-12, sau `49d3417`, tuần tự): lint, typecheck, test 159 file / 1097,
  `check:ordering` 41/41 **hai lượt liên tiếp**, `check:phase3` tắt/bật, `smoke:reservation-form`,
  `smoke:ordering-pickup`, `smoke-ordering-sepay.mjs`, `smoke-ordering-delivery.mjs`, `strapi build` bật/tắt — tất cả exit 0
- `pnpm run check:phase3` plugin tắt và bật
- `node scripts/smoke-ordering-delivery.mjs`, `smoke:reservation-form`, `smoke:ordering-pickup`, `smoke-ordering-sepay.mjs`
- `pnpm run build` (strapi build) bật và tắt plugin

### Manual UAT — PASSED (2026-10-12, Chrome qua browse CLI)

Server: `scripts/ordering/uat-server.mjs` port 1350 trên DB riêng `salanca_ordering_uat`
(sau khi tách — xem note bên dưới). Tài khoản `quan-ly-chuoi UAT` (all locations).

- Board "Đơn giao" render đúng: `Sẵn sàng giao (1)`, `Đang giao (1)`, `Giao thất bại`;
  dòng SLC-000002 CHƯA GÁN, địa chỉ snapshot "12 Đường Bí Mật, Xã Đồng Thử", 200.000đ.
- Gán `lan-q1 UAT` → "Bắt đầu giao": `POST /ordering/orders/2/transition 200`; đơn chuyển
  sang Đang giao (2), cột người giao + giờ xuất phát hiện.
- "Giao thất bại": nút "Ghi nhận thất bại" **disabled khi chưa chọn lý do**; chọn
  "Không liên lạc được khách" → `POST .../transition 200`; đơn vào tab Giao thất bại (1).
- "Giao lại": `POST .../transition 200`; đơn về lại Sẵn sàng giao (1).
- "Thu tiền và giao" → "Đã thu 200.000đ": `POST /ordering/orders/3/cash-handover 200`;
  chi tiết đơn hiện `ĐÃ GIAO` + `ĐÃ TRẢ`, `Tiền mặt · lan-q1 UAT`, `capture cash•••`,
  chặng giao "Đã giao", địa chỉ snapshot đủ "Xã Đồng Thử, Tỉnh Thử Một".
- Quote phí bậc thang qua public API thật: subtotal 100.000đ → `fulfillmentTotal` 15.000đ;
  200.000đ → 0đ; xã ngoài vùng (XT02001) → `400 DELIVERY_UNAVAILABLE`
  (`details.communeCode`, `reason: outside`).

Lần chạy đầu (chung `salanca_ordering_test`) bị một process khác chạy `check:ordering`/
`run-all.mjs` truncate giữa session — request dispatch trả 404 `ORDER_NOT_FOUND` đúng hành
vi. Đã sửa bằng cách cho `uat-server` dùng DB riêng `salanca_ordering_uat` qua
`ORDERING_TEST_DATABASE`; 41 script integration vẫn dùng `salanca_ordering_test`.

### Open gates / notes

- Danh mục hành chính vẫn là **TEST FIXTURE** (2 tỉnh `XT01`/`XT02`, 5 xã/phường); chờ chủ
  dự án xác nhận nguồn chính thức trước khi đóng gói dữ liệu thật.
- Vùng giao, bảng phí, đơn tối thiểu của Salanca: chờ số liệu thật từ chủ dự án (hiện là
  fixture trong test/UAT).
- Không tích hợp hãng giao trong O5 — chỉ metadata xe ngoài (tên hãng, mã vận đơn, URL
  tracking tùy chọn).
- `/slots` chỉ phục vụ pickup; đơn giao kiểm lịch trong quote/create theo `deliverySettings`.
- Quyết định push/merge.
