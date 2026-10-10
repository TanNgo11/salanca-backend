# Prompt: thực hiện Phase O2 (module catalog)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`. Nhiệm vụ: code **Phase O2 — Module catalog** của
plugin `ordering`. Spec, kế hoạch và mockup đã được chủ dự án duyệt; chỉ code theo đúng các tài liệu đó.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`.
2. `docs/phases/phase-ordering-2-catalog.md` (spec O2, gồm "Bổ sung sau review").
3. `docs/plans/ordering-o2-catalog.md` (kế hoạch 11 bước + bước 7b).
4. `docs/plans/mockups/ordering-o2-catalog.html` (7 màn hình + mẫu API; dùng làm ca test và UAT).
5. `docs/plans/ordering-core-contracts.md` mục 4, 20 (catalog), 21 (bổ sung), 14 (quyền, bảo mật).
6. `docs/plans/ordering-reference.md` C18, C19, C20 (vì sao không i18n, không Draft & Publish, không component).
7. `src/plugins/ordering/README.md` và "Completion record" trong `docs/plans/ordering-o1-core.md`
   (cấu trúc mã, harness test, các lệch đã gặp ở O1).

## Trạng thái hiện tại

- O0 và O1 đã đóng. Code ở nhánh `feat/ordering-o1` (đã push, chưa merge `main`).
- **Tạo nhánh `feat/ordering-o2` từ `feat/ordering-o1`** và làm trên đó. Không merge vào `main`.
- Adapter `ordering-catalog` hiện là stub (`server/src/providers/ordering-catalog-stub.ts`); O2 thay bằng adapter
  thật đọc content type catalog.
- Test tích hợp: `scripts/ordering/*.mjs` + harness `_harness.mjs` trên DB `salanca_ordering_test`;
  `pnpm run check:ordering` chạy tất cả. Builtin test bật bằng `ORDERING_TEST_BUILTINS=true`.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 **không tạo unique index cho `unique: true`**: mọi ràng buộc unique (kể cả slug theo ngôn ngữ
  ở bảng `catalog-slug`) phải tạo bằng migration của plugin (`server/src/migrations/`).
- Bảng plugin được giữ khi tắt plugin nhờ `persisted_tables` (bootstrap tự thêm mọi bảng `plugins_ordering_*`,
  kể cả bảng nối). Bảng catalog mới sẽ tự được thêm; `disable-survives.mjs` phải vẫn đạt.
- Index do migration tạo không bị schema sync xóa khi thêm/bỏ cột (đã probe khi review O1).
- i18n coi mọi relation là theo ngôn ngữ → catalog **không bật i18n**, chữ dịch nằm trong custom field
  `localized-text` (JSON `{ vi, en }`). Không bật Draft & Publish; product dùng field `status`.
- Plugin không nạp được component theo đường chuẩn → không dùng component; dùng content type + relation hoặc
  custom field JSON có validate.
- Custom field: server `strapi.customFields.register({ name, plugin: 'ordering', type: 'json' })` trong
  `register()`; admin `app.customFields.register(...)` với ô nhập React. O0 đã có `LocalizedTextInput.tsx` mẫu.
- Content Manager đi qua Document Service → validate `modifierGroups`, `bundleSlots`, `localized-text`, slug bằng
  Document Service middleware cho các type catalog.
- App thêm field cho product bằng `src/extensions/ordering/strapi-server.ts` (thêm attribute bằng code, không
  chép `schema.json`).
- Handler condition Admin nhận thẳng object user; trả `false` khi không có scope.

## Cách làm

- Đi đúng thứ tự 11 bước của `ordering-o2-catalog.md`. Mỗi bước: code → test → gate liên quan → một commit
  trên `feat/ordering-o2` (message kết thúc bằng dòng `Co-Authored-By` theo quy ước repo). Không push khi chủ
  dự án chưa nói.
- Content type catalog: `collectionName` tiền tố `plugins_ordering_`, ẩn khỏi Content-Type Builder; các type
  nhân viên sửa (`catalog-category`, `catalog-product`, `catalog-variant`, `catalog-price`,
  `catalog-modifier-group`, `catalog-modifier`, `catalog-availability-window`) **hiện** ở Content Manager;
  `catalog-slug`, `catalog-location-state` ẩn.
- Logic thuần (`domain/catalog/*`: validate JSON, chọn giá, availability, combo) không import Strapi, test Vitest.
- Ca test bắt buộc lấy từ mockup O2: topping "Giò heo" giá thư viện 20.000 ghi đè 25.000 cho Bún bò; combo trưa
  99.000 với "Tô đặc biệt +20.000" và "Trà đào +15.000"; Trà đào tạm hết → chỉ ẩn lựa chọn đó; nhóm bắt buộc hết
  sạch → combo hết; khung "Đêm khuya 22:00–02:00" qua nửa đêm; slug trùng cùng ngôn ngữ bị từ chối, khác ngôn
  ngữ thì được; API chỉ trả product `active` + `sellOnline`.
- Kế hoạch có bước **7b: màn hình "Danh mục"** (cây, thêm/sửa/xóa, kéo thả đổi thứ tự và đổi cha, quy tắc xóa)
  do chủ dự án thêm sau khi duyệt; làm theo mockup màn 4b.
- Nếu editor React cho `modifierGroups`/`bundleSlots` tốn quá nhiều công: dùng editor JSON có schema như kế hoạch
  cho phép, ghi lại trong Completion record.
- Quyền: action `plugin::ordering.catalog.manage`, `plugin::ordering.catalog.toggle-availability`; màn "Tạm hết
  món" lọc theo scope chi nhánh ở service. Kiểm thêm role không phải Super Admin cần quyền Content Manager nào
  để sửa type catalog, ghi vào `docs/admin-roles.md`.
- Bảo mật: route catalog công khai `auth: false`, có giới hạn kích thước, sanitize theo danh sách field cho
  phép, ghi vào `docs/security-baseline.md`.

## Quy tắc bắt buộc

- Plugin không import code của app. Không sửa content type, seed bundle hay dữ liệu của Salanca (`menu-item`,
  `menu-category`, `menu-package` giữ nguyên). **Không bao giờ chạy `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_test`; không chạm `salanca_cms` hay production.
- Không log dữ liệu cá nhân hay secret. Tiền là số nguyên VND an toàn.
- Không thêm dependency mới nếu chưa hỏi. Không chép code GPL (Vendure, WooCommerce, Action Scheduler).
- `types/generated/contentTypes.d.ts` luôn sinh với `ORDERING_ENABLED=true`.
- Giữ nguyên thay đổi không liên quan trong working tree.
- Tài liệu sai so với code chạy thật: sửa tại chỗ, ghi lý do, báo lại. Đổi phạm vi/thiết kế lớn: dừng và hỏi.

## Gate trước khi báo xong O2

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
$env:ORDERING_ENABLED='true'; pnpm run build
$env:DATABASE_NAME='salanca_ordering_test'; $env:ORDERING_ENABLED='false'; pnpm run check:phase3
$env:DATABASE_NAME='salanca_ordering_test'; $env:ORDERING_ENABLED='true';  pnpm run check:phase3
pnpm run check:ordering
```

`check:phase3` trên DB dev dừng ở `smoke:i18n` vì DB có nội dung thật; chạy trên DB test. Test media
`processor.test.ts` đôi khi timeout khi máy bận; chạy lại riêng file đó trước khi kết luận lỗi.

## UAT trong Admin (làm bằng Chrome nếu có, hoặc ghi lại để chủ dự án làm)

Theo danh sách "Manual Admin UAT" trong spec O2 và 6 màn hình của mockup: tạo danh mục cha/con, product 2 biến
thể, gắn nhóm Topping và ghi đè giá, combo có nhóm chọn, nhập tên VI/EN, nhân viên chi nhánh A bật "tạm hết" ở
A nhưng không thấy B, Content-Type Builder không hiện type nào của plugin, content Salanca vẫn như cũ.

## Báo cáo khi xong

- Cập nhật "Completion record" trong `docs/plans/ordering-o2-catalog.md`, trạng thái trong
  `docs/phases/phase-ordering-2-catalog.md`, một dòng trong `docs/STATUS.md`.
- Tin nhắn cuối: bước nào xong, lệnh đã chạy và kết quả, chỗ lệch kế hoạch và lý do, việc còn mở.
