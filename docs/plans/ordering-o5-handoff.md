# Prompt: thực hiện Phase O5 (giao tận nơi, quán tự giao)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`. Nhiệm vụ: code **Phase O5 — Giao tận nơi (quán tự giao)**
của plugin `ordering`. Spec, kế hoạch, mockup và đặc tả màn hình đã có; chỉ code theo đúng các tài liệu đó.

## Bước 0: nhánh

```bash
git switch feat/ordering-o4 && git status --short     # phải sạch (một stash "autostash" cũ có sẵn, không đụng)
git switch -c feat/ordering-o5
```

Làm toàn bộ O5 trên `feat/ordering-o5`. Không merge `main`, không push khi chủ dự án chưa nói. O4 đã code xong và
đã sửa sau review, nhưng **chưa UAT** (chưa có tài khoản SePay thử). Spec O5 ghi "O4 đóng" là điều kiện bắt đầu:
chủ dự án cho làm song song. Một session khác có thể commit `fix(ordering): ...` lên `feat/ordering-o4`; trước khi
báo xong, `git merge feat/ordering-o4` vào nhánh O5 nếu O4 có commit mới (dừng và báo nếu conflict).

## Hai quyết định của chủ dự án còn mở — xử lý thế này

1. **Nguồn danh mục xã/phường** (kế hoạch O5, "Owner decision required"; đề xuất danh mục Tổng cục Thống kê,
   34 tỉnh/thành, 3.321 xã/phường từ 01/07/2025). **Không tự bịa hay "nhớ lại" mã đơn vị hành chính.** Nếu chủ dự
   án chưa đưa file nguồn: làm loader, schema zod, service, API và tìm không dấu với một **fixture test nhỏ ghi rõ
   là test** (vài tỉnh/xã với mã giả có tiền tố dễ nhận biết, chỉ nạp khi `testing.builtins`). File dữ liệu thật
   `server/src/data/admin-units/<phiên bản>.json` để trống/không có; bootstrap báo rõ khi bật `delivery` mà chưa
   có danh mục. Ghi "chờ dữ liệu" trong Completion record. Có file nguồn thì kiểm số lượng đúng nguồn.
2. **Vùng giao, bảng phí, đơn tối thiểu của Salanca:** chỉ cần trước UAT. Test dùng dữ liệu giả.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`.
2. `docs/phases/phase-ordering-5-delivery.md` (spec, gồm "Bổ sung sau review").
3. `docs/plans/ordering-o5-delivery.md` (kế hoạch 8 bước).
4. **`docs/plans/ordering-o5-screens.md`**: D1–D4 (route, quyền, API, field, trạng thái). Đổi tên API thì sửa file
   này trong cùng commit. Quy ước chung ở đầu `ordering-o3-screens.md` (route Admin `/ordering/...`; mục "Đã đổi
   khi code O3"). Tab "Giao tận nơi" nằm trong màn Chi nhánh (S7) đã có.
5. `docs/plans/mockups/ordering-o5-delivery.html`; `docs/plans/ordering-reference.md` mục U5, B6, C17.4.
6. `docs/plans/ordering-core-contracts.md` mục 5 (`FulfillmentProvider`), 19.8 (`DeliveryZone`), 21 (21.1, 21.5,
   21.6, 21.9).
7. Completion record của `ordering-o3-pickup-cash.md` và `ordering-o4-sepay.md` (cấu trúc đã có, việc còn mở),
   `docs/ordering-api-contract.md`, `docs/ordering-payments-runbook.md`.

## Đã có từ O0–O4 (dùng lại, không làm lại)

- Content type `fulfillment` đã có `assigneeRef`, `addressSnapshot`, `trackingNumber`, `trackingUrl`,
  `shippedAt`, `deliveredAt`; `fulfillment-group` có `receiveMethod`, `fulfillmentAmount`, `estimatedReadyAt`.
  Kế hoạch ghi "không có bảng mới" — giữ đúng vậy. Thêm cột thì phải có lý do, ghi vào Completion record.
- `FulfillmentProvider` contract ở `contracts/fulfillment.ts`. Chưa có provider fulfillment nào; provider thanh toán
  mẫu: `providers/cash.ts`, `providers/sepay/`. Đăng ký qua `services/registry.ts` trong `register.ts`.
- Workflow ở `domain/workflow/definitions.ts`: `pickup-pay-on-pickup`, `pickup-prepay`, `pickup-accept-then-pay`.
  Workflow giao thêm 3 bản `delivery-*` cùng dạng. Đơn đã trả đủ: `payment-matching.advanceIfPaid`
  tự đẩy group ra khỏi `awaiting-payment`; giữ hành vi đó cho workflow giao.
- Giờ mở cửa, slot, lead time: `domain/scheduling/slots.ts` (`asapReadyAt` đã nối khoảng giờ qua nửa đêm),
  `services/pickup-scheduling.ts`, `services/branch.ts` (`pickupSettings`). Setting chi nhánh validate bằng zod
  (`domain/branch-settings.ts`, nhớ `.prefault({})` thay `.default({})` cho object lồng).
- Đặt đơn công khai: `services/storefront.ts`, `domain/storefront/parse.ts` (`receiveMethod.kind`), quote/giá ở
  server. Số điện thoại chuẩn hóa: `shared/contact/phone.ts` (O3).
- "Thu tiền và giao": `admin-orders.cashHandover` (một transaction: ghi tiền mặt + chuyển success). Người giao thu
  tiền phải ghi `actorRef` là người giao để O6 chốt theo người.
- Hủy/hoàn: `services/refund.ts`, `services/line-cancel.ts`; hoàn chuyển khoản là phiếu `pending` tới khi settle.
- Scope chi nhánh: `services/scope.ts` + `order.getOrder` (404 ngoài scope). Change log: `services/change-log.ts`.
- Thông báo khách: `services/notification.ts` + `domain/notifications/templates.ts` (thêm template VI/EN).
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`, nhóm Vận hành / Món / Cấu hình). "Đơn giao" vào nhóm
  **Vận hành**, ẩn theo quyền. Chuỗi giao diện: `translations/o5.ts` dạng `[vi, en]`, merge trong `registerTrads`
  như `o3.ts`/`o4.ts`; test dịch phải đạt.
- Harness test: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff`).
  `pnpm run check:ordering` chạy mọi script trong `run-all.mjs` — thêm script mới vào đó.
- UAT: `scripts/ordering/uat-server.mjs` (test DB, cổng 1350) — mở rộng thêm dữ liệu giao hàng.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint bằng migration plugin (`0004-o5-...` nếu cần).
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- Tranh chấp: khóa dòng (`repo.lockGroup`, `FOR UPDATE`) hoặc `pg_advisory_xact_lock`; khóa theo cùng một thứ tự.
- `db.raw` trả cột JSON dạng **chuỗi**, ORM trả object — parse khi đọc qua raw SQL.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung đặt ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); dùng nút/panel.
- `useRBAC` nhận mảng hằng (`lib/permissions.ts`). Lỗi HTTP đọc bằng `httpStatusOf` (`lib/api.ts`). Mã lỗi mới thêm
  vào `domain/errors.ts` (kèm HTTP status) và `error.<CODE>` trong translations.
- Field tên `locale` bị Strapi dành cho i18n.
- Test HTTP gửi tiếng Việt bằng node `fetch`, không bằng curl trong Git Bash.
- Test phụ thuộc giờ: dùng `now` cố định hoặc chi nhánh 24/7; kiểm cả lúc gần nửa đêm.

## Cách làm

- Đi đúng thứ tự 8 bước của `ordering-o5-delivery.md`. Mỗi bước: code → test → gate liên quan → một commit trên
  `feat/ordering-o5` (kết thúc bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion
  record khi làm.
- Phí giao luôn tính ở server, nằm trong `fulfillmentAmount`, tổng đơn khớp. Rule đầu tiên khớp thắng;
  `unavailable` là không giao; vùng `priority` cao xét trước; ngoài vùng → `DELIVERY_UNAVAILABLE`.
- Snapshot địa chỉ lưu cả mã và tên tại lúc đặt; đổi danh mục không sửa đơn cũ.
- Ca test bắt buộc: mọi mục "Test bắt buộc" của spec O5. Thêm: giao thất bại → giao lại; giao thất bại → hủy và hoàn
  (tiền mặt đã thu, và chuyển khoản → phiếu `pending`); hai nhân viên cùng gán người giao → một thành công; đơn giao
  `prepay` qua SePay vẫn tự chạy khi khớp tiền.
- Không log địa chỉ, tên, số điện thoại khách. Admin chỉ hiện địa chỉ cho người trong scope chi nhánh.
- Cấu hình vùng giao ghi `admin-change-log` (21.6).

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_test`; không chạm `salanca_cms` hay production. `check:phase3` và
  `smoke:reservation-form` luôn chạy với `DATABASE_NAME=salanca_ordering_test`.
- Không thêm dependency khi chưa hỏi (tìm không dấu: tự viết bỏ dấu bằng `normalize('NFD')`). Không chép code GPL
  (Vendure, WooCommerce, TastyIgniter, Action Scheduler) — chỉ học cách làm.
- `types/generated/contentTypes.d.ts` sinh với `ORDERING_ENABLED=true` (`strapi ts:generate-types`) nếu đổi schema.
- Không dùng `git stash` trần. Không in mật khẩu/token ra chat.
- Không tích hợp GHN/Ahamove/Grab, bản đồ hay định vị (non-goals).

## Cổng kiểm tra trước khi báo xong

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run smoke:reservation-form
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
node scripts/smoke-ordering-delivery.mjs
ORDERING_ENABLED=true pnpm exec strapi build && ORDERING_ENABLED=false pnpm exec strapi build
```

Tất cả exit 0. Chạy tuần tự (build xóa `dist` giữa chừng làm test khác hỏng). Ghi số thật vào Completion record của
`ordering-o5-delivery.md` và `docs/STATUS.md`. Cập nhật `docs/ordering-staff-guide.md` (phần giao hàng) và
`docs/ordering-api-contract.md` (địa chỉ, phí giao, admin-units). UAT trên Chrome (nếu được): dùng
`uat-server.mjs` mở rộng; liệt kê rõ phần đã làm / chưa làm.

## Báo cáo khi xong

Danh sách commit, số test, kết quả từng gate, chỗ lệch kế hoạch/đặc tả (kèm lý do), trạng thái danh mục hành chính
(dữ liệu thật hay chỉ fixture), việc còn mở cho O6.
