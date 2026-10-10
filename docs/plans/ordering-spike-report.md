# Kết quả spike O0 — ordering

Ngày: 2026-10-10. Nhánh: `spike/ordering-plugin`. Spec: [`phases/phase-ordering-0-spike.md`](../phases/phase-ordering-0-spike.md).
Kế hoạch: [`ordering-spike.md`](ordering-spike.md).

Trạng thái: **automated verification passed** cho mọi mục kiểm thuộc O0; **UAT trong Admin đạt**
(local). Còn 1 gate: deploy staging Dokploy. Dữ liệu thử chỉ ở PostgreSQL local `salanca_ordering_spike`
(`scripts/spike-ordering/runtime.mjs` và `bootstrap()` của plugin đều từ chối DB khác).

## Quyết định rút ra

| # | Quyết định | Bằng chứng |
| --- | --- | --- |
| D1 | **Build:** server plugin build bằng `tsc -p src/plugins/ordering/server/tsconfig.json` ra `dist/server`; admin đọc thẳng source TS qua `exports['./strapi-admin'].import`. Không cần `@strapi/sdk-plugin` cho local plugin (cân nhắc lại khi tách npm). `config/plugins.ts` báo lỗi khi bật mà chưa build, vì Strapi bỏ qua plugin thiếu server entry mà không báo. | mục 1, 10 |
| D2 | **Migration:** bảng và cột do Strapi tạo từ content-type schema. Việc schema sync không làm được (backfill, ràng buộc, sequence, index) chạy bằng runner của plugin trong `bootstrap()`: bảng `plugins_ordering_migrations`, một `pg_advisory_xact_lock` cho cả lượt, forward-only, mỗi migration ghi tên sau khi chạy. | mục 5 |
| D3 | **Condition Admin:** handler nhận thẳng object user (đã gộp permission), không phải `{ user }`. Khi mọi condition trả giá trị không hợp lệ (`null`), engine **từ chối** (fail-closed); kết luận "fail-open" ở reference C17.1 bản đầu là sai và đã sửa. Service vẫn phải tự áp scope. | mục 8, 13 |
| D4 | **Body gốc và CORS:** `includeUnparsed` và hai header `X-Order-Token`, `Idempotency-Key` chỉ bật khi `ORDERING_ENABLED=true` (`config/middlewares.ts`). Webhook thiếu body gốc trả `RAW_BODY_UNAVAILABLE`, không serialize lại JSON. | mục 11, 12 |
| D5 | **Claim job:** `FOR UPDATE SKIP LOCKED` + lease + fencing theo owner + consumer idempotent (unique key) chạy đúng giữa các process. | mục 4 |
| D6 | **Types sinh tự động:** luôn sinh `types/generated/contentTypes.d.ts` với `ORDERING_ENABLED=true`. | mục bổ sung |
| D7 | **Giữ khung plugin** làm nền cho O1. Ở bước 1 của O1 bỏ phần chỉ để thử: route/controller webhook spike, Document Service middleware probe, condition `spike-null-probe`, config `spike`, attribute `upgradeMarker`, tên hiển thị "(O0 probe)" của action, adapter `salanca-spike-noop`, các content type tối giản (thay bằng schema của O1). | — |

## Từng mục kiểm (contracts mục 17)

| # | Mục | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Build plugin TypeScript | Đạt | `pnpm run build` (server plugin trước, rồi admin); D1 |
| 2 | Transaction, khóa dòng, sequence, relation | Đạt | `tx.mjs`: 20/20 cập nhật song song không mất lần, 200 mã sequence không trùng, rollback không để lại dòng; 8 bảng `plugins_ordering_*` và bảng nối relation |
| 3 | Document Service middleware, đường vượt `db.query` | Đạt (phần UI chờ UAT) | `middleware.mjs`: update qua Document Service bị chặn, `db.query` đi qua |
| 4 | Cron/claim với 2 process | Đạt | `dispatch-two-process.mjs`: 2 process Node riêng, worker B tắt sau khi claim 10 dòng; 200/200 giao đúng một lần (unique log); 10 dòng được nhận lại sau lease 3 giây |
| 5 | Migration trên bảng có dữ liệu | Đạt | `migrate-runner.mjs`: 1.000 dòng cũ, thêm cột nullable → backfill theo lô 200 → `NOT NULL`; 2 runner đồng thời, mỗi migration chạy một lần, chạy lại không làm gì; D2 |
| 6 | Contract test phản hồi SePay/VNPAY/MoMo | Chuyển O4 | nghiệp vụ |
| 7 | Trộn loại hàng, voucher, lịch hẹn | Chuyển O1 | nghiệp vụ |
| 8 | Hai chi nhánh, hai nhân viên | Đạt | `scope-engine.mjs`: admin user thật, ability từ engine Strapi (`generateTokenAbility` + `createPermissionsManager().getQuery()`): nhân viên A chỉ thấy đơn A, B chỉ thấy B, không có scope không thấy gì |
| 9 | Làm tròn nhiều line, giảm giá, VAT | Chuyển O1 | nghiệp vụ |
| 10 | `resolve`, `validator`, app đăng ký adapter | Đạt | `load.mjs`: plugin register → app register → plugin bootstrap → app bootstrap; 4 test validator; 3 test khai báo plugin |
| 11 | Body gốc cho webhook | Đạt | `webhook.mjs`: chữ ký đúng 200, sửa body 401; `http.mjs`: thiếu body gốc 500 `RAW_BODY_UNAVAILABLE`; `smoke:reservation-form`, `smoke:contact-form` đạt khi bật body gốc; multipart (upload) không bị ảnh hưởng vì `koa-body` chỉ giữ body gốc cho json/form/text |
| 12 | CORS cho `X-Order-Token`, `Idempotency-Key` | Đạt (Cloudflare chờ staging) | `http.mjs`: preflight 204, `allow-headers` có hai header; unit test `middlewares.test.ts` |
| 13 | Condition async, handler trả `null` | Đạt | `scope-engine.mjs`: handler async được await; `null` một mình → từ chối; `null` cạnh condition khác → bị bỏ qua; D3 |
| 14 | Ngày kinh doanh qua nửa đêm | Đạt | `business-date.test.ts`: giờ chốt 04:00, server UTC |
| 15 | Custom field chữ đa ngôn ngữ, field JSON | Đạt phía server (ô nhập chờ UAT) | `register()` đăng ký `plugin::ordering.localized-text`; `catalog.mjs` lưu và đọc JSON |
| 16 | Catalog tắt i18n khi app bật i18n | Đạt | `check:phase3` với plugin bật: `smoke:i18n` đạt |
| 17 | Truy vấn JSON trên PostgreSQL | Đạt | `catalog.mjs`: `slug->>'vi'` |
| 18 | Field của app qua extension, sống qua nâng cấp plugin | Đạt | `extension-upgrade.mjs`: process v1 tạo product `isFeatured=true`; process v2 (plugin thêm `upgradeMarker`) còn cột và giá trị `is_featured` |
| 19 | Build SDK, không tự mở REST | Đạt | `http.mjs`: route công khai của plugin chỉ có `POST /api/v1/ordering/webhooks/spike`; 6 đường đoán theo tên content type đều 404. SDK: xem D1 |
| + | Types sinh ổn định | Đạt | 2 lần `strapi ts:generate-types` với plugin bật cho cùng SHA-256 |
| + | `verify:schema`, `check:phase3` khi plugin bật/tắt | Đạt | trên DB spike: tắt 159 giây, bật 177 giây; 112 file / 677 test |
| + | Plugin phát event tới app | Đạt | `load.mjs`: listener của app nhận `ordering.spike.ready` |

## Gate tự động (chạy lại sau khi bổ sung, 2026-10-10)

```powershell
pnpm run lint                      # đạt
pnpm run typecheck                 # đạt
pnpm run test                      # đạt, 112 file / 677 test
$env:ORDERING_ENABLED='true'; pnpm run build   # đạt
$env:DATABASE_NAME='salanca_ordering_spike'; $env:ORDERING_ENABLED='false'; pnpm run check:phase3  # đạt
$env:DATABASE_NAME='salanca_ordering_spike'; $env:ORDERING_ENABLED='true';  pnpm run check:phase3  # đạt
node scripts/spike-ordering/{load,tx,middleware,scope,scope-engine,dispatch,dispatch-two-process,webhook,http,migrate,migrate-runner,catalog,extension-upgrade}.mjs   # đạt cả 13
```

`check:phase3` trên DB dev `salanca_cms` dừng ở `smoke:i18n` vì script cố ý đòi các singleton trống
(DB dev có nội dung thật). Không xóa dữ liệu thật; chạy trên DB spike thì đạt.

## UAT trong Admin (2026-10-10, local)

`pnpm run develop` với `ORDERING_ENABLED=true` trên DB spike, cổng 1399, admin thử tạo bằng
`strapi admin:create-user` (chỉ tồn tại trong DB spike). Kiểm bằng Chrome:

- [x] Menu "Bán hàng" hiện; trang plugin mở được ("Plugin ordering đang ở giai đoạn spike").
- [x] Content Manager: của plugin chỉ có `catalog-product`; các type nội bộ không hiện.
- [x] Content-Type Builder: chỉ có type của Salanca và `User`, không có type nào của plugin.
- [x] Ô nhập `name` hiện 2 ô "name (VI)", "name (EN)"; lưu xong DB có
  `{"vi":"Món thử UAT","en":"UAT dish"}`; field `isFeatured` của app (extension) hiện trong form.
- [x] Content Salanca: form tạo "Món" đủ field, nhãn tiếng Việt, gợi ý "Giá trị này riêng cho ngôn ngữ
  đang chọn", Draft & Publish như cũ.

## Gate còn mở

- **Staging Dokploy:** build Nixpacks có plugin, `ORDERING_ENABLED=true`, Admin hiện plugin, `/_health`
  trả 204, preflight qua Cloudflare.

Tham khảo: [Strapi Server API](https://docs.strapi.io/cms/plugins-development/server-api). Kết luận dựa
trên source local 5.51.1 và script chạy thật.
