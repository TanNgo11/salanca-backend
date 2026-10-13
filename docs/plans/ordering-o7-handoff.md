# Prompt: thực hiện Phase O7 (vận hành bổ sung)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-o7` (không phải `salanca-backend` hay
`salanca-backend-o6`). Nhiệm vụ: code **Phase O7 — Vận hành bổ sung** của plugin `ordering`: giờ đặc biệt theo ngày,
giới hạn số phần mỗi ngày, nhân viên sửa đơn, trang di động cho người giao. Spec, kế hoạch, đặc tả màn hình và
mockup đã có; chỉ code theo đúng các tài liệu đó.

## Bước 0: worktree, nhánh, DB riêng

Worktree đã tạo sẵn: nhánh `feat/ordering-o7` từ `feat/ordering-o6` (`4d9272b`), `.env` đã copy. Hai thư mục
`D:\outsource\salanca\salanca-backend` (O5) và `D:\outsource\salanca\salanca-backend-o6` (O6, đang chạy gate) là
của session khác — **không sửa file, không chạy lệnh hay git trong đó**.

```bash
cd /d/outsource/salanca/salanca-backend-o7
git branch --show-current && git status --short    # feat/ordering-o7, sạch
pnpm install --frozen-lockfile
export ORDERING_TEST_DATABASE=salanca_ordering_o7   # harness tự tạo DB này lần đầu
```

**Mọi lệnh test dùng DB `salanca_ordering_o7`** (script `scripts/ordering/*`, `scripts/smoke-ordering-*.mjs` đọc
`ORDERING_TEST_DATABASE`; `check:phase3`, `smoke:reservation-form` đọc `DATABASE_NAME=salanca_ordering_o7`). UAT:
`ORDERING_TEST_DATABASE=salanca_ordering_o7_uat UAT_PORT=1352`. Không chạm `salanca_ordering_test`,
`salanca_ordering_o6*`, `salanca_ordering_uat`, `salanca_cms`, production.

O6 đã code xong và đã sửa sau review; gate đầy đủ đang chạy ở session khác. Session đó sẽ commit
`docs(ordering): ...` (số gate) lên `feat/ordering-o6`. Trước khi báo xong: `git merge feat/ordering-o6` nếu O6 có
commit mới (dừng và báo nếu conflict). Không merge `main`, không push khi chủ dự án chưa nói.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`, `docs/STATUS.md` (mục O3–O6 mới nhất).
2. **`docs/phases/phase-ordering-7-ops-extras.md`** (spec, test bắt buộc, UAT).
3. **`docs/plans/ordering-o7-ops-extras.md`** (kế hoạch 8 bước: data model, API, mã lỗi, thuật toán, file từng bước).
4. **`docs/plans/ordering-o7-screens.md`** (E1–E4) + quy ước chung đầu `ordering-o3-screens.md` + mục "Đã đổi khi
   code" của O3/O5/O6 screens. Đổi tên API thì sửa screens trong cùng commit.
5. `docs/plans/mockups/ordering-o7-ops-extras.html`; `docs/plans/ordering-reference.md` mục U7.
6. `docs/plans/ordering-core-contracts.md` mục 5 (`inventoryRef`), 19.3, 19.6, 19.8, 20.1, 21.5.
7. Completion record của `ordering-o5-delivery.md`, `ordering-o6-ops-golive.md`; `docs/ordering-api-contract.md`,
   `docs/ordering-staff-guide.md`.

## Quyết định đã chốt (chủ dự án, 2026-10-12) — không hỏi lại

- Trang người giao là **trang trong Admin**, bố cục điện thoại (`/plugins/ordering/courier`). Không làm magic link.
- Đơn đã trả trước mà sửa làm **tăng** tiền → phần chênh trả qua link thanh toán O4, group **không** đổi trạng thái
  (bếp làm tiếp); đơn trả khi nhận chỉ tăng số cần thu. Sửa làm **giảm** tiền → hoàn (tiền mặt `settled`, chuyển
  khoản phiếu `pending`).
- Các "Decision" khác trong plan là quyết định đã chốt; "Assumption" thì kiểm và ghi kết quả vào Completion record.

## Đã có từ O0–O6 (dùng lại, không làm lại)

- Lịch: `domain/branch-settings.ts` (`scheduleSchema`, `holidayDates`, `.prefault({})` cho object lồng),
  `domain/scheduling/slots.ts` (`rangesForDate` là chỗ duy nhất đọc giờ/ngày nghỉ — thêm `specialHours` ở đây),
  `services/pickup-scheduling.ts` (`resolveTiming`, `reserveInTransaction`), `services/hold.ts`.
- Tạm hết: `catalog-location-state`, `services/catalog-availability.ts`, trang `admin/src/pages/Availability/`.
- Đặt đơn: `services/order.ts` (`prepareOrder` dùng chung quote/create, `createOrder`, `recomputeProjection`),
  `services/storefront.ts`, `domain/storefront/parse.ts`.
- Hủy/hoàn: `services/line-cancel.ts` + preview bằng transaction rollback (`admin-orders.lineCancelPreview`),
  `services/refund.ts` (`createRefundInTransaction`), `admin-orders.refundHeld` (hủy/từ chối/hết hạn hoàn mọi
  payment còn giữ), `services/payment-link.ts` (`issue`). Hủy chỉ qua `POST /orders/:id/cancel`.
- Giao: `services/delivery-assignment.ts`, `admin-orders.cashHandover` (payment theo người giao), provider
  `self-delivery`, `requireDeliveryAddress`, `admin-orders.list` filter `assignee=mine`.
- O6: change-log, alert engine, chốt tiền mặt (`cash-closing.ts`), báo cáo, retention, `jobs/catalog.ts`.
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`, nhóm Vận hành / Món / Cấu hình …), `lib/permissions.ts`,
  chuỗi `translations/o7.ts` dạng `[vi, en]` merge trong `registerTrads`; test dịch phải đạt.
- Harness: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedAdminHttpStaff`, dọn user
  test cũ khi reset); thêm script mới vào `run-all.mjs`; `uat-server.mjs` mở rộng seed O7.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint/CHECK bằng migration plugin (`0005-o7-...`).
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- Tranh chấp: khóa dòng (`repo.lockGroup`, `FOR UPDATE`) hoặc SQL có điều kiện; khóa theo cùng một thứ tự.
- `db.raw` trả cột JSON dạng **chuỗi**, ORM trả object — parse khi đọc qua raw SQL. Cột `date` trả chuỗi `YYYY-MM-DD`.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung ở `src/plugins/ordering/shared/`.
- Trong `Modal` không dùng `SimpleMenu`/dropdown mới (đã treo trang ở O3); dùng nút/panel.
- `useRBAC` nhận mảng hằng (`lib/permissions.ts`). Lỗi HTTP đọc bằng `httpStatusOf`. Mã lỗi mới vào
  `domain/errors.ts` (kèm HTTP status) và `error.<CODE>` trong translations.
- Field tên `locale` bị Strapi dành cho i18n.
- Test HTTP gửi tiếng Việt bằng node `fetch`. Test phụ thuộc giờ dùng `now` cố định hoặc chi nhánh 24/7; kiểm
  quanh 04:00 (giờ chốt ngày kinh doanh) và nửa đêm.
- Test nhiều process phải có barrier (xem `outbox-two-process.mjs`), không dựa vào thời gian boot; lease/khóa trong
  test phải dài hơn thời gian process kia chạy.
- Cảnh báo `pg` "client.query() when the client is already executing a query" đến từ populate của
  `@strapi/database` (`pg` 8.20.0) — không sửa.
- Alert do job định kỳ mở phải tự truyền `severity`; chỉ rule đếm sự kiện thật mới nâng theo `count`
  (`COUNT_ESCALATED` trong `services/alert.ts`).

## Cách làm

- Đi đúng thứ tự 8 bước của `ordering-o7-ops-extras.md`. Mỗi bước: code → test → gate liên quan → một commit trên
  `feat/ordering-o7` (kết thúc bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion
  record khi làm.
- Sửa đơn chạm tiền: viết hàm thuần tính chênh lệch/hoàn trước (`domain/order-edit.ts` + unit test, có property test
  "tổng sau sửa = Σ dòng còn hiệu lực + phí + adjustment + thuế"), rồi mới nối DB.
- Ca test bắt buộc: mọi mục "Test bắt buộc" của spec O7, thêm: đơn trả cả tiền mặt và chuyển khoản rồi sửa giảm
  (thứ tự hoàn ghi rõ); sửa đơn có món giới hạn ngày (reserve/release phần chênh); người giao gọi `cash-handover`
  cho đơn không phải của mình → 404.
- UAT trang người giao trên điện thoại sớm (sau bước 7); nếu Strapi Admin không dùng được ở 360px thì ghi rủi ro, đề
  xuất hướng khác trong báo cáo — không tự làm magic link.
- Không log tên, số điện thoại, địa chỉ khách. Timeline sửa đơn che PII.

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_o7` / `salanca_ordering_o7_uat`.
- Không thêm dependency khi chưa hỏi. Không chép code GPL (WooCommerce, TastyIgniter, Action Scheduler) — chỉ học.
- Đổi schema thì sinh lại `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true` (`strapi ts:generate-types`).
- Không dùng `git stash` trần. Không in mật khẩu/token ra chat.
- Non-goals: kho nguyên liệu, khách tự sửa đơn, đổi chi nhánh/cách nhận, định vị/bản đồ, app native.

## Cổng kiểm tra trước khi báo xong

```bash
export ORDERING_TEST_DATABASE=salanca_ordering_o7
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering            # chạy 2 lượt liên tiếp
DATABASE_NAME=salanca_ordering_o7 ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_o7 ORDERING_ENABLED=true  pnpm run check:phase3
DATABASE_NAME=salanca_ordering_o7 ORDERING_ENABLED=true  pnpm run smoke:reservation-form
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
node scripts/smoke-ordering-delivery.mjs
ORDERING_ENABLED=true pnpm exec strapi build && ORDERING_ENABLED=false pnpm exec strapi build
```

Tất cả exit 0. Chạy tuần tự (build xóa `dist` giữa chừng làm test khác hỏng). Một lượt đạt không chứng minh hết
chập chờn — `check:ordering` 2 lượt. Ghi số thật vào Completion record của `ordering-o7-ops-extras.md` và
`docs/STATUS.md`. Cập nhật `docs/ordering-staff-guide.md`, `docs/ordering-api-contract.md`, mục "Đã đổi khi code
O7" trong `ordering-o7-screens.md`. UAT trên Chrome (nếu được) bằng `uat-server.mjs` mở rộng; liệt kê rõ phần đã
làm / chưa làm.

## Báo cáo khi xong

Danh sách commit, số test, kết quả từng gate (số thật), chỗ lệch kế hoạch/đặc tả (kèm lý do), kết quả UAT trang
người giao trên điện thoại, việc còn mở cho O8.
