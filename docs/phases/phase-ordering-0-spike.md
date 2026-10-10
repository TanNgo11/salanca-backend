# Phase O0 — Spike plugin `ordering` trống

Trạng thái: automated verification passed; UAT Admin đạt (local, 2026-10-10); chờ staging. Chủ dự án duyệt spec và cho bắt đầu O0 (2026-10-10). Roadmap:
[`plans/ordering-roadmap.md`](../plans/ordering-roadmap.md). Kế hoạch thực hiện
chi tiết: [`plans/ordering-spike.md`](../plans/ordering-spike.md). Thiết kế:
[`plans/ordering-core-contracts.md`](../plans/ordering-core-contracts.md).

## Goal

Chứng minh bằng code chạy thật rằng Strapi 5.51.1 của repo này làm được các việc lõi mà thiết kế plugin
`ordering` giả định, trước khi viết nghiệp vụ ở O1. Kết quả là báo cáo
`plans/ordering-spike-report.md` và quyết định cách đóng gói plugin.

## Scope

Các mục kiểm ở contracts mục 17 "Cần kiểm bằng plugin trống", trừ 6, 7, 9 (chuyển sang O1):

- Khung local plugin TypeScript tại `src/plugins/ordering`, bật bằng `ORDERING_ENABLED` (mặc định
  `false`); `resolve`, `default`/`validator`, thứ tự register/bootstrap; cách build chạy được trên Nixpacks.
- Content type tối thiểu `plugins_ordering_*`, ẩn khỏi Content-Type Builder, bảng nội bộ ẩn khỏi Content
  Manager, không tự mở REST.
- `strapi.db.transaction`, `forUpdate`, sequence PostgreSQL, `onCommit`/`onRollback`.
- Document Service middleware và đường vượt qua `strapi.db.query`.
- Action và condition theo chi nhánh (handler async; rủi ro trả `null`).
- Cron + claim `FOR UPDATE SKIP LOCKED` có lease với 2 process.
- `includeUnparsed` cho webhook, HMAC trên body gốc; CORS cho `X-Order-Token`, `Idempotency-Key`.
- Migration của plugin trên bảng có dữ liệu.
- Catalog trên Strapi: custom field chữ đa ngôn ngữ, field JSON, truy vấn `jsonb`, extension của app.
- Hàm `businessDate` qua nửa đêm.
- Deploy staging.

## Non-goals

- Nghiệp vụ: tính giá, workflow thật, SePay thật, giao hàng, web.
- Thay đổi content type, seed bundle hay dữ liệu của Salanca.
- Merge vào `main`: code ở nhánh `spike/ordering-plugin`; giữ làm khung hay bỏ quyết định sau báo cáo.

## Residual risk (accepted)

- Spike chạy trên DB riêng `salanca_ordering_spike`; kết quả trên DB thật có thể khác về khối lượng.
- Bước deploy staging cần chủ dự án chạy hoặc cấp quyền Dokploy.

## Acceptance

### Automated

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
# ORDERING_ENABLED=false: app như main
pnpm run check:phase3
# spike scripts, DB riêng
$env:DATABASE_NAME='salanca_ordering_spike'; $env:ORDERING_ENABLED='true'; node scripts/spike-ordering/<script>.mjs
```

### Manual Admin UAT

- [ ] Admin hiện mục plugin; Content Manager chỉ hiện `catalog-product` của plugin.
- [ ] Content-Type Builder không hiện content type nào của plugin.
- [ ] Ô nhập chữ đa ngôn ngữ hiện đúng trong trang product.
- [ ] Content của Salanca (i18n) vẫn sửa được như cũ.
- [ ] Staging: build đạt, Admin hiện plugin, `/_health` trả 204.

### Kết quả cần ghi

`plans/ordering-spike-report.md`: mỗi mục kiểm có đạt/không đạt/cách thay thế và bằng chứng; quyết định
cách build plugin và cách chạy migration.

## Bổ sung sau review (2026-10-10)

- Kiểm `types/generated/contentTypes.d.ts`: sinh với `ORDERING_ENABLED=true` cho ra nội dung ổn định;
  chốt quy tắc "luôn sinh với plugin bật" (contracts 21.9).
- Chạy `pnpm run verify:schema` và `pnpm run check:phase3` cả khi plugin bật lẫn tắt.
- Kiểm `strapi.eventHub.emit` từ plugin tới được listener của app (cho nhật ký thay đổi, contracts 21.6).

## Rollback

Xóa nhánh `spike/ordering-plugin` và `DROP DATABASE salanca_ordering_spike`. `main` không đổi.
