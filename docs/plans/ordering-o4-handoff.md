# Prompt: thực hiện Phase O4 (chuyển khoản SePay)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`. Nhiệm vụ: code **Phase O4 — Chuyển khoản qua SePay** của plugin
`ordering`. Spec, kế hoạch, mockup và đặc tả màn hình đã duyệt; chỉ code theo đúng các tài liệu đó.

## Bước 0: nhánh

```bash
git switch feat/ordering-o3 && git status --short     # phải sạch
git switch -c feat/ordering-o4
```

Làm toàn bộ O4 trên `feat/ordering-o4`. Không merge `main`, không push khi chủ dự án chưa nói. Một session khác có thể
đang UAT O3 và commit `fix(ordering): ...` lên `feat/ordering-o3`; trước khi báo xong, `git merge feat/ordering-o3`
vào nhánh O4 nếu O3 có commit mới (dừng và báo nếu conflict).

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`.
2. `docs/phases/phase-ordering-4-sepay.md` (spec, gồm "Bổ sung sau review").
3. `docs/plans/ordering-o4-sepay.md` (kế hoạch 13 bước).
4. **`docs/plans/ordering-o4-screens.md`**: đặc tả màn P1–P8 (route, quyền, API, field, trạng thái). Đổi tên API thì sửa
   file này trong cùng commit. Quy ước chung và các chỗ đã đổi khi code O3 nằm ở đầu `ordering-o3-screens.md`
   (route Admin là `/ordering/...`, không có `/admin`).
5. `docs/plans/mockups/ordering-o4-sepay.html`; `docs/plans/ordering-reference.md` mục U4, B5, C10, C11.
6. `docs/plans/ordering-core-contracts.md` mục 8, 12, 14, 19.1, 19.7, 21.
7. Completion record của `docs/plans/ordering-o3-pickup-cash.md` (cấu trúc đã có, việc còn mở) và
   `docs/ordering-api-contract.md`.

## Đã có từ O0–O3 (dùng lại, không làm lại)

- `includeUnparsed: true` cho `strapi::body` đã bật khi `ORDERING_ENABLED=true` (`config/middlewares.ts`, có test). Body
  gốc đọc qua `Symbol.for('unparsedBody')` (O0 đã chứng minh). Bước 1 chỉ còn: bootstrap báo lỗi rõ khi provider cần
  chữ ký mà body gốc không có.
- Ledger: `payment`, `payment-event` (unique `(providerCode, providerTransactionId)`), `services/payment.ts`
  (`createPayment`, `recordPaymentEvent`, `capturePayment`), `services/refund.ts` (`createRefundInTransaction`),
  `services/line-cancel.ts`. `PaymentProvider` contract ở `contracts/payment.ts`; provider mẫu `providers/cash.ts`
  (`isOnlinePaymentProvider` = capability `online` — SePay phải khai `online`).
- Workflow `pickup-prepay` và `pickup-accept-then-pay` đã có, đang dừng ở `awaiting-payment`. Chi nhánh chọn
  `paymentTiming` + `paymentProviders` (validate: `prepay`/`accept-then-pay` cần provider online đang bật).
- `GET /api/v1/ordering/orders/payment` (token) trả `presentation: null` — O4 điền QR/tài khoản/memo/hạn.
- Outbox + consumer, `services/alert.ts` (`open`/`resolve` theo dedupe key, email chi nhánh qua `ops-alert.opened`),
  `order-job-lock` + `jobLock.withLock`, `services/notification.ts` (thêm template nếu cần).
- Admin: menu con "Bán hàng" (`admin/src/pages/App.tsx`) — màn "Duyệt chuyển khoản" thêm vào nhóm **Vận hành**, ẩn theo
  quyền `payment.review`; khối thanh toán P1 nằm trong `pages/Orders/OrderDetailPage.tsx`. Chuỗi giao diện thêm vào
  `translations/o3.ts` (hoặc file `o4.ts` cùng dạng `[vi, en]`, merge trong `registerTrads`); test dịch phải đạt.
- Harness test: `scripts/ordering/_harness.mjs` (`withApp`, `seedBranches`, `seedMenu`, `seedStaff`,
  `seedAdminHttpStaff` — đăng nhập Admin thật qua HTTP). `pnpm run check:ordering` chạy mọi script trong `run-all.mjs`.
- UAT: `scripts/ordering/uat-server.mjs` (test DB, cổng 1350).

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 không tạo unique index cho `unique: true` → constraint bằng migration plugin (`0004-o4-...`).
- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- Tranh chấp: khóa dòng (`repo.lockGroup/lockPayment`, `FOR UPDATE`) hoặc `pg_advisory_xact_lock` trong transaction.
- Code admin không import `server/**` hay `@strapi/utils`; logic dùng chung đặt ở `src/plugins/ordering/shared/`.
- Bên trong `Modal` không dùng `SimpleMenu`/dropdown (đã làm treo trang ở O3); dùng nút/panel trong modal.
- `useRBAC` nhận mảng hằng (khai ở `lib/permissions.ts`), không tạo mảng mới mỗi render. Lỗi HTTP đọc bằng
  `httpStatusOf` (`lib/api.ts`).
- Tên field `locale` bị Strapi dành cho i18n — không đặt field tên `locale`.
- Test HTTP gửi tiếng Việt bằng node `fetch`, không bằng curl trong Git Bash.

## Cách làm

- Đi đúng thứ tự 13 bước của `ordering-o4-sepay.md`. Mỗi bước: code → test → gate liên quan → một commit trên
  `feat/ordering-o4` (kết thúc bằng dòng `Co-Authored-By` theo quy ước repo). Ghi bảng bước → commit vào Completion
  record khi làm.
- **Không gọi mạng thật trong test**: SePay API client và QR có bản giả (inject qua provider/registry dưới
  `testing.builtins`, giống `test-captcha`). Webhook test ký bằng secret giả.
- Ca test bắt buộc: các mục "Test bắt buộc" của spec O4 (ACK đúng body, trùng `id`, `transferType=out`, đủ 7
  `reviewReason`, gán tay rồi chuyển bù, ghi tay rồi webhook tới, đối soát song song 2 process ghi đúng một lần) +
  link thanh toán hết hạn + hủy một phần đơn chuyển khoản.
- Duyệt chuyển khoản: scope chi nhánh ở service; tiền không rõ chi nhánh chỉ người `allLocations` thấy; hai người xử lý
  cùng event → một thành công (`REVIEW_ALREADY_RESOLVED`); ghi `admin-change-log`.
- Secret (`SEPAY_WEBHOOK_SECRET`, API token) chỉ qua env/config, không hiện trên Admin, không log. Log không có tên người
  chuyển, số tài khoản đầy đủ hay nội dung chuyển khoản thô. Thêm biến vào `.env.example`.

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed hay dữ liệu Salanca. **Không chạy `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_test`; không chạm `salanca_cms` hay production. `check:phase3` và
  `smoke:reservation-form` luôn chạy với `DATABASE_NAME=salanca_ordering_test`.
- Không thêm dependency khi chưa hỏi. Không chép code GPL (Vendure, WooCommerce, Action Scheduler).
- `types/generated/contentTypes.d.ts` sinh với `ORDERING_ENABLED=true` (`strapi ts:generate-types`).
- Không dùng `git stash` trần.
- UAT với giao dịch SePay thật cần chủ dự án cấp tài khoản thử; không có thì ghi "chưa UAT", không claim.

## Cổng kiểm tra trước khi báo xong

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run smoke:reservation-form
pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
ORDERING_ENABLED=true pnpm exec strapi build && ORDERING_ENABLED=false pnpm exec strapi build
```

Tất cả exit 0. Ghi số thật vào Completion record của `ordering-o4-sepay.md` và `docs/STATUS.md`. UAT trên Chrome (nếu
được): dùng `uat-server.mjs` mở rộng thêm dữ liệu O4; liệt kê rõ phần đã làm / chưa làm.

## Báo cáo khi xong

Danh sách commit, số test, kết quả từng gate, chỗ lệch kế hoạch/đặc tả (kèm lý do), việc còn mở cho O5.
