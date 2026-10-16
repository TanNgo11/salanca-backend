# Prompt: thực hiện SEO-2 (plugin `seo-toolkit` v0.2, trang "Kiểm tra SEO" trong admin)

Gửi cho agent: "Đọc `docs/plans/seo-toolkit-v0.2-handoff.md` trong worktree `salanca-seo` và làm theo phần dưới dấu `---`".

Chỉ giao sau khi chủ dự án (tan_ngo) duyệt spec và kế hoạch v0.2.

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-seo` (nhánh `feat/seo-toolkit`). v0.1 đã xong và nằm trên nhánh (commit `506d891`, `b04c43e`).

Nhiệm vụ: code **SEO-2 (v0.2)**: trang admin "Kiểm tra SEO" trong plugin local `src/plugins/seo-toolkit` (Strapi 5.51.1): điểm sức khỏe, lỗi theo loại hoặc theo trang, nút Sửa tới Content Manager, bỏ qua có lý do (cảnh báo và lưu ý) cùng khôi phục, bảng `dismissal` riêng của plugin, ba route admin mới, action quyền `plugin::seo-toolkit.manage`. Spec và kế hoạch 10 bước đã đối chiếu với code ngày 2026-10-17; code đúng theo đó.

Làm **tự chủ tới hết**: không có người trả lời câu hỏi giữa chừng. Gặp chỗ mơ hồ thì chọn phương án an toàn và đơn giản, ghi lý do vào "Điều lệch kế hoạch" của file kế hoạch. Chỉ dừng hỏi khi phải đổi phạm vi, bảo mật hoặc dữ liệu, hoặc khi `pnpm install` hay DB test bị chặn.

## Đọc trước khi code (theo thứ tự)

1. `docs/phases/phase-seo-toolkit-2-admin-audit.md`: spec. Đặc biệt mục 5 (server), 7 (hợp đồng `AuditView`), 8 (cách tính điểm), 9 (liên kết Sửa), Non-goals, Quyết định A1 đến A7.
2. `docs/plans/seo-toolkit-v0.2-admin-audit.md`: kế hoạch từng bước, hợp đồng kiểu, thuật toán `buildView`/`computeScore`, nội dung `guidance`, khóa dịch, cấu trúc file, các bảng test và các ca smoke. Đây là tài liệu chính để code.
3. `docs/plans/seo-admin-page-mockup.html` (tab Audit; mở file và đọc các hàm `renderAudit`, `issueRow`, `pageRow`) và `docs/plans/seo-admin-page-research.md`. **Chỉ lấy tab Audit**: banner go-live, tab Sitemap, tab Go-live, "Chạy lại check này", nhãn "Mới", sparkline, "Mở trang ↗" đều ngoài phạm vi (Non-goals).
4. Code v0.1 đang có (đọc để mở rộng, không viết lại): `src/plugins/seo-toolkit/shared/audit/*`, `server/src/{services,controllers,routes}/*`, `register.ts`, `scripts/seo-toolkit/_harness.mjs`, `admin-route-smoke.mjs`.
5. Mẫu cần nhân bản (đọc, không import): `src/plugins/ordering/package.json`, `tsconfig.ordering-admin.json`, `scripts/ordering/check-admin-imports.mjs`, `src/plugins/ordering/admin/src/{index.ts,pluginId.ts}`, `lib/{permissions,api,i18n}.ts`, `translations/o3.ts` và `o3.test.ts`, `pages/App.tsx`, `pages/Alerts/index.tsx`, `server/src/content-types/internal.ts`.

## Bước 0: môi trường

```powershell
Set-Location D:\outsource\salanca\salanca-seo
git status --short                    # chỉ có .commandcode/ (công cụ khác, không đụng)
git log --oneline -3                  # b04c43e (hoặc con của nó) ở trên cùng
pnpm install --frozen-lockfile        # KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:seo-toolkit
pnpm run typecheck
pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts
pnpm run smoke:seo-toolkit
```

Ghi baseline (kỳ vọng 94 test, smoke 8/8) vào Completion record. `pnpm install` bị `minimumReleaseAge` chặn vì `@tanngo11/log` thì **dừng và báo**, không tự hạ ngưỡng.

## Ranh giới

- Chỉ làm trong `D:\outsource\salanca\salanca-seo`. `salanca-backend`, `salanca-notify`, `salanca-web` là của session khác: không sửa, không chạy lệnh hay git trong đó. Không đụng `artifacts/`, `.commandcode/`.
- Không sửa `docs/STATUS.md`, schema/seed/content type của Salanca, khối cấu hình Salanca trong `config/plugins.ts`, `.npmrc`, `pnpm-workspace.yaml`, `eslint.config.mjs`. Không thêm dependency.
- **`AGENTS.md`: được sửa đúng một lần**, thêm đúng một bullet như spec mục 6, ngay sau bullet ngoại lệ ordering. Không sửa dòng nào khác.
- Plugin không import `src/domain`, `src/api`, `src/plugins/ordering`; mã `admin/` không import `server/` hay `@strapi/utils`; không ghi cứng UID Salanca trong plugin. Harness và smoke không import `scripts/ordering/*`.
- Engine v0.1, `POST /seo-toolkit/audit/run` và CLI **không đổi hành vi** (bỏ qua không áp dụng ở hai đường đó).
- Không SQL thô, không migration, không cron, không middleware.

## DB

- **Từ v0.2, không khởi động plugin với DB dev dưới mọi hình thức**, kể cả `pnpm run seo:audit`: khi `SEO_TOOLKIT_ENABLED=true`, lúc Strapi khởi động nó tự tạo bảng `plugins_seo_toolkit_dismissal`, tức là ghi vào DB. Phần "audit chỉ đọc" của v0.1 chỉ đúng với nội dung CMS, không còn đúng với DB nói chung.
- **Không bao giờ ghi vào DB dev** (`DATABASE_NAME` trong `.env`). Mọi thao tác ghi (role, user, dismissal, document nháp, file giả) chỉ trên DB test `salanca_seo_test` qua `_harness.mjs`, chốt bằng `SELECT current_database()`. Không tạo được DB test thì ghi lý do chặn, đánh dấu bước 7 và 8 là "chưa chạy", **không** chuyển sang DB dev.
- Không chạy `seed:*`, `data:import`, `export:cms-seed`, `media:*`, `smoke:*` có sẵn của repo, `check:phase3`. `.env` là bản sao gitignore, không commit, không in giá trị.
- `strapi build` dùng để kiểm gói admin biên dịch (bước 8). Nếu chỉ lỗi vì guard `S3_BUCKET` khi `NODE_ENV=production`, đặt biến giả trong lệnh (không ghi `.env`, không sửa guard) và ghi cách chạy.

## Gate (gọn)

Các lệnh ở mục "Verification" của kế hoạch. Không chạy toàn bộ bộ test, không UAT giao diện bằng công cụ (chủ dự án tự kiểm tay các mục Manual của spec).

## Commit và push

**Không commit, không push** cho tới khi chủ dự án (tan_ngo) nói.

## Báo cáo cuối

Dùng đúng trạng thái: `implemented`, `automated verification passed`, `ready for manual UAT`. Nêu:

- từng lệnh đã chạy và kết quả (kể cả lỗi sẵn có từ baseline);
- kết quả `smoke:seo-toolkit` (số ca của từng smoke, tên DB test), xác nhận **không ghi vào DB dev**;
- kết quả bước 8: bảng `plugins_seo_toolkit_dismissal` có tạo không, ràng buộc `unique` có hoạt động không (A5), `adminLabel` (A6), bảng còn hay mất khi tắt plugin, `strapi build` có bật plugin (cách chạy);
- điểm và số đếm từ smoke trên DB test (DB test gần như rỗng nên chỉ để kiểm logic); **không** chạy trên DB dev để lấy số thật, ước lượng 37/43 (~86%) trong kế hoạch là con số chủ dự án tự đối chiếu khi UAT;
- mục "Điều lệch kế hoạch" mới;
- danh sách file đã đổi (xác nhận chỉ trong phạm vi), các cổng thủ công còn mở (UAT trang, kiểm liên kết Sửa A7, cấp quyền `manage` cho vai trò chủ quán).

Điền Completion record trong `docs/plans/seo-toolkit-v0.2-admin-audit.md`.
