# Kết quả spike O0 — ordering

Ngày: 2026-10-10. Nhánh: `spike/ordering-plugin`. Trạng thái: automated verification passed; chờ
manual UAT và staging nên chưa đóng phase.
Chủ dự án đã duyệt spec và cho tiếp tục code. Dữ liệu thử chỉ trên PostgreSQL local
`salanca_ordering_spike`; không dùng DB dev/production.

## Gate nền sau khôi phục stash

- `pnpm run typecheck`: đạt.
- `pnpm run test`: đạt, 111 file / 667 test.
- `pnpm run build`: đạt, khung plugin TypeScript build trước app.
- `pnpm run lint`: đạt sau khi bổ sung đường dẫn JavaScript sinh trong `src/plugins/ordering/dist`
  vào ignores.
- `pnpm run test`: đạt lần chạy đơn độc cuối, **112 file / 676 test**. Một lần chạy đồng thời với
  các Strapi process khác làm test media timeout 5 giây; chạy lại đơn độc đạt.
- `pnpm run build`: đạt (server plugin build riêng rồi Strapi build Admin).
- `ORDERING_ENABLED=true pnpm exec strapi ts:generate-types`: đạt hai lần; SHA-256 của
  `types/generated/contentTypes.d.ts` giống nhau (`7EAFA4F29DDE9429594B8AE564FDD17932BEF365BF064855199CF3F1A76079D0`).

## Probe O0 đã chạy trên DB spike

- `node scripts/spike-ordering/load.mjs`: đạt; lifecycle `plugin.register → app.register →
  plugin.bootstrap → app.bootstrap`, adapter registry và event bridge tới app đều nhận được.
- `node scripts/spike-ordering/tx.mjs`: đạt; 20 cập nhật đồng thời không mất lần, 200 sequence
  unique, rollback callback chạy và không để lại dòng.
- `node scripts/spike-ordering/middleware.mjs`: đạt; Document Service update bị chặn, `db.query`
  vẫn đi qua để chứng minh đường vượt.
- `node scripts/spike-ordering/scope.mjs`: đạt; không có scope bị từ chối, scope chi nhánh trả
  điều kiện query, `allLocations` cho phép.
- `node scripts/spike-ordering/dispatch.mjs`: đạt; 100/100 dòng được claim duy nhất bằng
  `FOR UPDATE SKIP LOCKED` và lease 30 giây.
- `node scripts/spike-ordering/webhook.mjs`: đạt; HMAC trên body gốc trả `200`, đổi body trả
  `401`; route thực tế là `/api/v1/ordering/webhooks/spike` vì Strapi tự thêm prefix plugin.
- `node scripts/spike-ordering/migrate.mjs`: đạt; migration probe chạy idempotent với hai runner
  đồng thời, dữ liệu legacy còn nguyên.
- `node scripts/spike-ordering/catalog.mjs`: đạt; localized JSON, truy vấn `jsonb`, modifier
  groups và field do app extension thêm đều tồn tại.
- `pnpm run verify:schema`: đạt. Có 8 bảng plugin `plugins_ordering_*` trong DB spike; bảng nối
  relation được tạo.

## Gate còn mở

- Admin UAT và deploy staging Dokploy.
- Quyết định giữ khung plugin / cách migration sau khi có đủ bằng chứng.

## Gate chưa đạt / không thể chạy trong môi trường hiện tại

- `pnpm run check:phase3` chạy trên DB mặc định đã qua `verify:schema` và CRUD smoke, nhưng dừng ở
  `smoke:i18n`: script yêu cầu singleton `global-setting` rỗng, trong DB `salanca_cms` hiện có 4
  bản ghi nội dung thật. Không xóa dữ liệu thật để ép smoke xanh.
- Staging Dokploy chưa chạy; cần quyền hoặc thao tác triển khai của chủ dự án.
- Admin UAT (Content Manager, Content-Type Builder, custom field, content Salanca) chưa thực hiện.

Tham khảo API plugin chính thức: [Strapi Server API](https://docs.strapi.io/cms/plugins-development/server-api).
Kết luận cho phiên bản cài trong repo phải dựa trên source local và script chạy thật, không suy ra từ roadmap.
