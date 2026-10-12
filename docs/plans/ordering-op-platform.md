# OP — Đóng gói và chất lượng: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt: giấy phép, dependency Playwright, nơi phát hành), AI thực hiện
Last updated: 2026-10-12
Related phase: [`phases/phase-ordering-p-platform.md`](../phases/phase-ordering-p-platform.md)

## Goal

CI, Playwright, đóng gói plugin, product type `retail` có tồn kho.

## Non-goals

- Phát hành npm công khai/marketplace; kho nhiều cấp, nhà cung cấp, lô/hạn dùng.

## Current evidence

- Repo **không có CI** (AGENTS.md/STATUS: gate chạy tay, ghi vào `docs/STATUS.md`).
- `scripts/ordering/run-all.mjs` chạy tuần tự 47+ script, mỗi script boot Strapi + truncate DB (≈ 35 giây/script);
  harness đọc `ORDERING_TEST_DATABASE` và tự tạo DB; cổng `PORT` theo pid.
- `strapi build` xóa `dist` — phải tuần tự với test trong cùng thư mục.
- Plugin `src/plugins/ordering/package.json`: `name: strapi-plugin-ordering`, `version: 0.0.0`, `license: UNLICENSED`;
  server build `scripts/ordering/build-server.mjs`; admin build qua `strapi build` của app.
- Product type: chỉ `food` (`register.ts` `registerProductType(foodProductType)`); `ProductTypeDefinition` có
  `validateLine`, `quoteLine`, `selectWorkflow`. `catalog-variant` có `trackInventory`, `inventoryRef` (chưa dùng); O7 có
  giới hạn theo ngày (`catalog-daily-*`) — khác tồn kho cộng dồn.
- `uat-server.mjs` seed dữ liệu UAT cho Admin (cổng, DB riêng).

## Decisions and assumptions

- Decision: CI = GitHub Actions (repo trên GitHub — kiểm khi làm; nếu không phải GitHub thì đổi sang runner tương ứng).
- Decision: chia `check:ordering` thành N shard (mặc định 4) bằng `run-all.mjs --shard i/N` (chia đều theo thời gian chạy đã
  ghi), mỗi shard một job, DB `salanca_ordering_ci_<i>`; build chạy ở job riêng trên bản checkout riêng.
- Decision: Playwright là **devDependency mới** → chờ chủ dự án đồng ý; chạy Chromium headless, `uat-server` seed, đăng nhập
  admin UAT bằng tài khoản seed (mật khẩu sinh lúc seed, truyền qua env CI, không commit).
- Decision: đóng gói dạng **workspace package** trước (`packages/strapi-plugin-ordering` trong monorepo pnpm hoặc repo riêng —
  chủ dự án chọn), build `dist` server + admin bằng `@strapi/sdk-plugin` nếu tương thích Strapi 5.51.1 (kiểm; không thì giữ
  build hiện tại), app Salanca phụ thuộc bằng `workspace:*`/đường dẫn.
- Decision: `retail` dùng bảng `inventory-level` (variant × chi nhánh: `onHand`, `reserved`, `lowStockThreshold`) và
  `inventory-movement` (append-only: kind `receive|adjust|reserve|release|fulfill`, qty, order?, actor, reason); giữ hàng khi
  tạo đơn bằng UPDATE có điều kiện (`onHand - reserved >= qty`), trừ `onHand` khi group `completed`, trả khi `canceled`.
- Owner decision required: giấy phép (MIT / Apache-2.0 / thương mại đóng), tên package, nơi phát hành (npm private, GitHub
  Packages, chỉ nội bộ).
- Owner decision required: đồng ý thêm `@playwright/test` (devDependency).

## Invariants

- CI không dùng dữ liệu/secret production; DB test riêng mỗi shard.
- Package không phụ thuộc code Salanca; Salanca chỉ cấu hình + extension như hiện tại.
- Tồn kho: `0 ≤ reserved ≤ onHand`; Σ movement = onHand; không bán vượt khi đặt song song.

## Implementation steps

1. **Shard cho `run-all.mjs`**
   - Files: `scripts/ordering/run-all.mjs` (`--shard i/N`, ghi thời gian từng script vào `scripts/ordering/.timings.json` để
     chia đều; mặc định chia theo thứ tự nếu chưa có file).
   - Verification: chạy 4 shard song song trên 4 DB local → tổng = 47+ script, không trùng/không sót.
2. **GitHub Actions**
   - Files: `.github/workflows/ordering.yml` (jobs: lint-typecheck-test; ordering-shard ×4 (service postgres:16, env DB riêng);
     phase3 tắt/bật; smoke; build tắt/bật; artifact log khi lỗi), `.github/workflows/README` ngắn.
   - Verification: PR thử xanh; commit cố ý hỏng → đỏ đúng job.
3. **Playwright (sau khi được đồng ý)**
   - Files: `e2e/playwright.config.ts`, `e2e/*.spec.ts` (8 luồng trong spec), `scripts/ordering/uat-server.mjs` thêm chế độ
     `--e2e` (seed xác định, cổng cố định, không mở trình duyệt), job CI `e2e` (cài Chromium, cache).
   - Verification: 3 lần chạy liên tiếp xanh; ảnh chụp khi lỗi trong artifact.
4. **Đóng gói**
   - Files: chuyển `src/plugins/ordering` → package (giữ lịch sử git bằng `git mv`), `package.json` (tên, version `0.1.0`,
     license, `peerDependencies` `@strapi/strapi 5.51.x`), `README.md`, `CHANGELOG.md` (từ O0–O13), `UPGRADING.md` (migration
     plugin chạy khi bootstrap; không hạ cấp), `config/plugins.ts` của Salanca trỏ package; cập nhật mọi đường dẫn script/test.
   - Verification: gate đầy đủ xanh sau khi chuyển; cài vào một app Strapi 5.51.1 trống theo README (script
     `scripts/ordering/fresh-install.mjs` tạo app tạm, cài package, boot, gọi `/api/v1/ordering/config`).
5. **Tài liệu tích hợp**
   - Files: gom `docs/ordering-*` thành `docs/` của package: cài đặt, cấu hình env, quyền, workflow, provider (link O13
     `ordering-writing-providers.md`), webhook/OpenAPI (O10), điểm mở rộng (product type, catalog adapter, extension field).
   - Verification: người ngoài làm theo được (UAT).
6. **Product type `retail`**
   - Files: `providers/product-types/retail.ts`, content type `inventory-level`, `inventory-movement`, migration (số tiếp
     theo), `services/inventory.ts` (`reserve/release/fulfill/adjust/receive`), nối `createOrder`/transition (giống O7 daily
     stock), Admin T1–T2 (dưới đây), alert `low-stock`.
   - Verification: `scripts/ordering/retail-inventory.mjs`: đủ ca trong spec + 2 process tranh món cuối (barrier);
     `check:ordering`.
7. **Gate + tài liệu**
   - Files: `docs/STATUS.md` (CI thay cho bảng gate tay), roadmap, Completion record.

### Màn hình tồn kho (retail)

- **T1. Tồn kho** (Món → Tồn kho, quyền `catalog.manage`): chọn chi nhánh; bảng SKU, tên món/biến thể, Tồn, Đang giữ, Có thể
  bán, Ngưỡng sắp hết (sửa tại chỗ), `Badge` Sắp hết/Hết; nút "Nhập hàng", "Điều chỉnh" (panel: số lượng ±, lý do bắt buộc).
- **T2. Lịch sử tồn** (panel theo SKU): bảng movement (lúc, loại, số lượng, đơn, người, lý do) — chỉ thêm, không sửa.

## Data and rollback

- Migration cho `inventory-*`. CI/Playwright không đổi dữ liệu. Rollback package: trỏ lại thư mục local (giữ một bản tag).

## Verification

- CI xanh trên PR; Playwright 3 lần xanh; fresh-install script xanh; gate đầy đủ xanh sau đóng gói.

## Documentation impact

- README/CHANGELOG/UPGRADING của package, docs tích hợp, STATUS (CI), AGENTS.md (lệnh gate mới), roadmap.

## Risks and blockers

- Chờ quyết định giấy phép, Playwright, nơi phát hành.
- Đổi đường dẫn plugin chạm mọi script — làm trong một PR riêng, không trộn với tính năng.

Ước lượng thô: 2–3 tuần rải song song (1–2: 3 ngày; 3: 3–4 ngày; 4–5: 4–5 ngày; 6: 4 ngày; 7: 1 ngày).

## Completion record

- Chưa bắt đầu.
