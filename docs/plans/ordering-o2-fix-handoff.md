# O2 — Prompt sửa sau review (2026-10-10)

Dán nguyên phần dưới vào session code O2 (repo `D:\outsource\salanca\salanca-backend`, nhánh `feat/ordering-o2`).

---

Review O2 phát hiện lỗi chặn đóng phase. Sửa theo thứ tự dưới đây, giữ mọi quy tắc của
`docs/plans/ordering-o2-handoff.md` (không chạy `pnpm export:cms-seed`, không đụng DB `salanca_cms` hay production,
chỉ dùng `salanca_ordering_test`, không đổi content type/seed/data của Salanca, không log PII/token, không thêm
dependency khi chưa hỏi chủ dự án, commit theo từng bước, **không push**).

## 1. (Chặn) Admin build hỏng khi bật plugin

Tái hiện:

```bash
ORDERING_ENABLED=true pnpm exec strapi build
# ✖ Building admin panel
# @strapi/utils/dist/file.mjs (1:9): "Writable" is not exported
```

Nguyên nhân: `src/plugins/ordering/admin/src/custom-fields/bundle-slots/Input.tsx` và
`.../modifier-groups/Input.tsx` import `validateBundleSlots` / `validateModifierGroups` từ
`server/src/domain/catalog/*`; hai file đó `import { z } from '@strapi/utils'` — package chỉ chạy trên Node, kéo vào
bundle trình duyệt là vỡ. Lần build "✓" trong completion record chạy khi plugin tắt nên không bắt được.

Cách sửa (không thêm dependency):

- Tạo `src/plugins/ordering/shared/catalog/` chứa validator **thuần TypeScript, không import gì từ `@strapi/*`,
  `node:*`, hay `server/`**: kiểm tra cấu trúc `modifierGroups` / `bundleSlots` bằng code tay, trả cùng dạng lỗi
  (path + code + message) như hiện tại.
- Server (`server/src/domain/catalog/*`) gọi lại validator shared; phần ref-check với DB giữ ở server. Nếu vẫn cần
  `z` của Strapi ở server thì chỉ dùng ở server.
- Admin chỉ import từ `shared/`. Đảm bảo `server/tsconfig.json` (build ra `dist/server`) vẫn compile được file shared
  (thêm vào `include` hoặc `rootDir` phù hợp) và đường dẫn trong `dist` vẫn đúng khi Strapi load.
- Unit test cũ của validator phải chạy trên bản shared, cùng kết quả (không giảm ca test).
- Nếu muốn dùng `zod` trực tiếp thay vì viết tay: **dừng và hỏi chủ dự án** trước khi thêm dependency.

Chặn tái phát:

- Thêm script `scripts/ordering/admin-build.mjs` (hoặc bước trong `run-all.mjs`) chạy
  `ORDERING_ENABLED=true strapi build` và fail nếu exit ≠ 0; đưa vào `check:ordering`.
- Thêm test/lint rule (vd. test quét import) bảo đảm không file nào dưới `admin/src/**` import `server/**` hay
  `@strapi/utils`.

## 2. (Ghi lại, không code) Rate limit public catalog

`server/src/controllers/catalog.ts:52` lấy `ctx.request.ip`. Sau Cloudflare hoặc khi web Next.js gọi từ server,
mọi khách chung một IP ⇒ chung một bucket. Không sửa ở O2; ghi vào `docs/plans/ordering-o2-catalog.md` mục
Completion record → "Việc mở cho OW": cần chốt nguồn IP tin cậy (header IP khách + shared secret giống form intake,
hoặc `CF-Connecting-IP` khi request đến thẳng từ Cloudflare) trước khi làm OW.

## 3. Cổng kiểm tra trước khi báo xong

Chạy lại và dán số thật vào Completion record (thay số cũ):

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering                      # phải gồm bước admin build mới
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run check:phase3
```

Cả hai lần `check:phase3` phải exit 0 (gồm `smoke:i18n` và build admin). `check:phase3` luôn chạy trên
`salanca_ordering_test`, không chạy trên `salanca_cms`.

Sau đó boot dev với plugin bật trên test DB (`DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true pnpm develop`),
mở Admin, vào sửa một sản phẩm combo và một sản phẩm có nhóm tùy chọn: hai editor custom field phải hiện và báo lỗi
validate đúng như trước. Ghi kết quả vào Completion record.

## 4. Báo cáo

Báo lại: danh sách commit mới, số test, kết quả 2 lần `check:phase3`, đường dẫn module shared, và mọi chỗ lệch so với
prompt này (kèm lý do).
