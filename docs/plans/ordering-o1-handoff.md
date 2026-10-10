# Prompt: thực hiện Phase O1 (lõi đơn hàng)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`. Nhiệm vụ: code **Phase O1 — Lõi đơn hàng** của
plugin `ordering`. Spec, kế hoạch và mockup đã được chủ dự án duyệt; chỉ code theo đúng các tài liệu đó.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md` và `PLANS.md` (quy tắc repo, gate kiểm tra).
2. `docs/phases/phase-ordering-1-core.md` (spec O1, gồm mục "Bổ sung sau review").
3. `docs/plans/ordering-o1-core.md` (kế hoạch 15 bước, cấu trúc mã, invariants).
4. `docs/plans/mockups/ordering-o1-core.html` (luồng và ví dụ tính tiền có số; dùng làm ca test).
5. `docs/plans/ordering-core-contracts.md` mục 1–8, 12, 14, 15, 19, 21 (thiết kế; mục sau thắng mục trước).
6. `docs/plans/ordering-spike-report.md` (kết quả O0 và quyết định D1–D7, bắt buộc tuân theo).

## Trạng thái hiện tại

- Nhánh làm việc: `feat/ordering-o1` (đã tạo từ `spike/ordering-plugin`, chưa có commit). `main` chưa có
  code ordering. Không merge vào `main`.
- Khung plugin ở `src/plugins/ordering`: server build bằng `tsc -p src/plugins/ordering/server/tsconfig.json`
  (`pnpm run build:ordering`), admin đọc thẳng TS. Plugin chỉ bật khi `ORDERING_ENABLED=true`.
- Đã có và giữ lại: config + validator zod (`@strapi/utils` `z`), registry, runner migration
  (`server/src/migrations/runner.ts`, bảng `plugins_ordering_migrations` + advisory lock), hàm
  `businessDate`, condition `same-location`.

## Sự thật đã chứng minh ở O0 (không đọc lại source để cãi)

- Thứ tự: plugin register → app register → plugin bootstrap → app bootstrap.
- Strapi chỉ nạp server entry `.js`; thiếu bản build thì bỏ qua plugin không báo lỗi (`config/plugins.ts`
  đã tự báo lỗi).
- Handler condition Admin nhận **thẳng object user**, không phải `{ user }`. Trả `null` → bị từ chối
  (fail-closed). Vẫn trả `false` rõ ràng khi không có scope.
- Claim job: `FOR UPDATE SKIP LOCKED` + lease + fencing theo owner + consumer idempotent chạy đúng giữa
  2 process.
- Bảng/cột do Strapi tạo từ schema; backfill/ràng buộc/sequence/index đi qua runner migration.
- i18n coi mọi relation là theo ngôn ngữ → content type của plugin không bật i18n, không bật Draft & Publish.
- Content type plugin không tự mở REST.

## Cách làm

- Đi đúng thứ tự 15 bước trong `ordering-o1-core.md`. **Bước 1** gồm dọn code chỉ dùng cho spike
  (D7): route/controller webhook spike, Document Service middleware probe, condition `spike-null-probe`,
  config `spike` (cả trong `config/plugins.ts`), attribute `upgradeMarker`, service `spike-tx`, các
  `recordLifecycle`/`recordAppEvent`, adapter `salanca-spike-noop`, field `isFeatured` trong
  `src/extensions/ordering/strapi-server.ts` (đưa về ví dụ trong README), content type tối giản của O0,
  `scripts/spike-ordering/*` (giữ trong lịch sử git, xóa khỏi nhánh). Thay bằng cấu trúc mã ở kế hoạch.
- Logic thuần (`domain/`) không import Strapi, test bằng Vitest, đặt test cạnh file (`*.test.ts`).
- Test tích hợp là script `scripts/ordering/*.mjs` trên DB riêng **`salanca_ordering_test`** (tạo nếu
  chưa có; script phải assert tên DB và host loopback như `scripts/spike-ordering/runtime.mjs` cũ).
- Mỗi bước: code → test → chạy gate liên quan → commit một commit trên `feat/ordering-o1` (kết thúc
  message bằng dòng `Co-Authored-By` theo quy ước của repo). Không push nếu chủ dự án chưa nói.
- Ví dụ trong mockup O1 phải thành test: giảm 25.000đ cho 130.000 / 45.000 / 45.000 → 14.773 / 5.114 /
  5.113; VAT 8% gồm trong giá → 8.535 / 2.955 / 2.955; hoàn Trà đào = 39.886. Bảng projection
  `order.status` và bảng `businessDate` trong mockup cũng thành test.

## Quy tắc bắt buộc

- Plugin không import code của app; app chỉ gọi service công khai của plugin.
- Không sửa content type, seed bundle hay dữ liệu của Salanca. **Không bao giờ chạy `pnpm export:cms-seed`.**
- Không chạm DB dev `salanca_cms` hay production; chỉ dùng `salanca_ordering_test` (và
  `salanca_ordering_spike` nếu cần).
- Không log tên, số điện thoại, email, địa chỉ, token.
- Tiền là số nguyên VND an toàn (`Number.isSafeInteger`), không `decimal`, không `BigInt` trong JSON.
- Không thêm dependency mới nếu không thật cần; nếu cần, hỏi trước.
- Vendure, WooCommerce, Action Scheduler là GPL: chỉ học thiết kế, không chép code.
- `types/generated/contentTypes.d.ts` luôn sinh với `ORDERING_ENABLED=true`.
- Giữ nguyên thay đổi không liên quan trong working tree; không stage/commit chúng.
- Thấy tài liệu sai so với code chạy thật: sửa tài liệu tại chỗ, ghi lý do, báo lại. Đổi phạm vi hay thiết
  kế lớn: dừng và hỏi chủ dự án.

## Gate trước khi báo xong O1

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
$env:ORDERING_ENABLED='true'; pnpm run build
$env:DATABASE_NAME='salanca_ordering_test'; $env:ORDERING_ENABLED='false'; pnpm run check:phase3
$env:DATABASE_NAME='salanca_ordering_test'; $env:ORDERING_ENABLED='true';  pnpm run check:phase3
node scripts/ordering/<từng script>.mjs
```

`check:phase3` trên DB dev sẽ dừng ở `smoke:i18n` vì DB có nội dung thật (script cố ý đòi trống); chạy
trên DB test.

## Báo cáo khi xong

- Cập nhật "Completion record" trong `docs/plans/ordering-o1-core.md`, trạng thái trong
  `docs/phases/phase-ordering-1-core.md`, một dòng trong `docs/STATUS.md`, và
  `docs/plans/ordering-status-report.html`.
- Tin nhắn cuối: bước nào xong, lệnh đã chạy và kết quả, chỗ nào lệch kế hoạch và vì sao, việc còn mở.
