# Prompt: đóng SEO-1 (plugin `seo-toolkit` v0.1), bằng chứng route admin và ảnh chia sẻ

Gửi cho agent: "Đọc `docs/plans/seo-toolkit-v0.1-closeout-handoff.md` trong worktree `salanca-seo` và làm theo phần dưới dấu `---`".

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-seo` (nhánh `feat/seo-toolkit`). Code v0.1 đã viết và review xong (build, typecheck, 93 test, audit thật trên DB dev đều đạt). Việc này chỉ **đóng nốt bằng chứng** còn thiếu và sửa vài chỗ nhỏ. Không thêm tính năng, không đụng phạm vi v0.2.

Làm **tự chủ tới hết**. Gặp chỗ mơ hồ thì chọn phương án an toàn và đơn giản, ghi lý do vào "Điều lệch kế hoạch" của `docs/plans/seo-toolkit-v0.1-cms-audit.md`. Chỉ dừng hỏi khi phải đổi phạm vi, bảo mật hoặc dữ liệu.

## Đọc trước khi làm

1. `docs/plans/seo-toolkit-v0.1-cms-audit.md`: mục "Điều lệch kế hoạch" (mục 1 đến 16) và "Completion record", để biết cái gì đã xong.
2. `docs/phases/phase-seo-toolkit-1-cms-audit.md` mục 4 và 5 (hợp đồng báo cáo, service, API).
3. `src/plugins/seo-toolkit/server/src/{routes,controllers,services,register}`, `shared/cli.ts`, `scripts/seo-toolkit/audit.mjs`.
4. Mẫu cần nhân bản (đọc, không import): `scripts/ordering/_harness.mjs` (`configureTestEnvironment`, `ensureTestDatabase`, `bootOrderingTestApp`, `seedAdminHttpStaff`, cách `call` gọi route admin), và một script dùng nó, ví dụ `scripts/ordering/admin-units.mjs`.

## Ranh giới

- Chỉ làm trong `D:\outsource\salanca\salanca-seo`. Không đụng `salanca-backend`, `salanca-notify`, `salanca-web`, `artifacts/`, `.commandcode/`.
- Không sửa `docs/STATUS.md`, `AGENTS.md`, schema/seed/content type của Salanca, `.npmrc`, `pnpm-workspace.yaml`, không thêm dependency.
- Plugin không import `src/domain`, `src/api`, `src/plugins/ordering`. Script mới **không import** `scripts/ordering/_harness.mjs`: tạo harness riêng (T1) để seo-toolkit không phụ thuộc ordering.
- **Tuyệt đối không ghi vào DB dev** (`DATABASE_NAME` trong `.env`). Mọi lần ghi (tạo role, user, document, file media) chỉ trên DB test riêng ở T1. Không chạy `seed:*`, `data:import`, `export:cms-seed`, `media:*`, `smoke:*` đã có, `check:phase3`.
- `.env` trong worktree là bản sao gitignore, không commit, không in giá trị ra log hay báo cáo.
- **Không commit, không push** cho tới khi tan_ngo nói.

## T1 (chính): smoke HTTP cho route admin, trên DB test riêng

Mục tiêu: có bằng chứng chạy thật cho `POST /seo-toolkit/audit/run` (đang chỉ test bằng đơn vị và CLI), kèm bằng chứng trực tiếp cho `media.share-image-alt-missing` trên dữ liệu thật (DB dev chưa có ảnh chia sẻ nào), và cho `--status=draft` (chưa chạy trên dữ liệu thật).

Tạo:

- `scripts/seo-toolkit/_harness.mjs`: nhân bản phần cần thiết của harness ordering, đổi tên cho đúng:
  - DB test: `SEO_TOOLKIT_TEST_DATABASE` mặc định `salanca_seo_test`.
  - Giữ các chốt an toàn: chỉ host loopback, cấm `DATABASE_URL`, `DATABASE_NAME` bị ghi đè sang DB test, xác nhận `SELECT current_database()` đúng tên DB test rồi mới làm tiếp.
  - `SEO_TOOLKIT_ENABLED=true`, `ORDERING_ENABLED` tắt, `NODE_ENV=development` (shell công cụ có sẵn `NODE_ENV=production`, phải đặt lại), `STRAPI_TELEMETRY_DISABLED=true`, `S3_BUCKET` rỗng, tắt SMTP và webhook như harness ordering, `admin.autoOpen` tắt, cổng riêng.
  - Hàm tạo role + user admin theo danh sách action, đăng nhập `POST /admin/login` lấy Bearer token, và dọn sau khi xong.
- `scripts/seo-toolkit/admin-route-smoke.mjs`: boot app trên DB test, `app.listen()`, rồi kiểm (mỗi ca là một `assert`, in `[seo-toolkit-test] ...` không kèm email hay token):
  1. Không có token: `POST /seo-toolkit/audit/run` trả 401.
  2. User có role **không** chứa `plugin::seo-toolkit.audit.run`: trả 403.
  3. User có role chứa action đó: trả 200, body đúng hợp đồng (`generatedAt`, `scope`, `summary`, `issues`).
  4. Body sai (ví dụ `status: 'bogus'`, `contentTypes: 'x'`): trả 400, không 500.
  5. `contentTypes` chứa UID chưa khai báo: 400.
  6. Action `plugin::seo-toolkit.audit.run` có trong `app.admin.services.permission.actionProvider` (xác nhận quyền hiện trong Role).
  7. **Ảnh chia sẻ thật (A2 trực tiếp):** trên DB test, tạo một dòng `plugin::upload.file` không có `alternativeText` (qua `app.db.query`, không cần S3), rồi tạo bằng Document Service **bản nháp** của một content type Salanca đã cấu hình (chọn loại ít field bắt buộc nhất, đọc `schema.json`; bản nháp không ép `required`) với khối `seo` có `metaTitle`, `metaDescription` và `shareImage` trỏ tới dòng file đó. Gọi route với `{ "status": "draft", "contentTypes": ["<uid đó>"] }`: phải có `media.share-image-alt-missing`, và **không** có `media.share-image-missing` cho khối này. Rồi cập nhật file có `alternativeText` không rỗng, gọi lại: lỗi alt biến mất.
  8. Cùng dữ liệu đó ở `status: 'published'` (chưa publish): document không xuất hiện (0 entry cho UID đó). Đây là bằng chứng `status` được tôn trọng.
- `package.json`: thêm script `smoke:seo-toolkit` = `pnpm run build:seo-toolkit && node scripts/seo-toolkit/admin-route-smoke.mjs`. **Không** gộp vào `check:seo-toolkit` (cần PostgreSQL local).

Nếu DB test không tạo được (không có Postgres, thiếu quyền `CREATE DATABASE`), ghi lý do chặn, đánh dấu T1 là "chưa chạy", **không** chuyển sang DB dev.

## T2 (nhỏ): `--out` in một dòng tóm tắt

Hiện `pnpm run seo:audit -- --out=file` không in gì ngoài log Strapi, người chạy không thấy kết quả. Khi có `--out` mà không có `--json`, in thêm đúng một dòng ra stdout sau khi ghi file, dạng:
`SEO audit: entries=45 error=6 warn=15 notice=39 -> <đường dẫn file>`.
Đặt hàm định dạng ở `shared/cli.ts` (có test trong `cli.test.ts`), `audit.mjs` chỉ gọi. Không đổi mã thoát, không đổi nội dung file JSON.

## T3 (nhỏ): làm gọn Completion record

Phần bước 7 trong Completion record còn các dòng của lần chạy đầu (13 UID, "nghi `global-setting`, không tự bỏ UID nào", số 47/6/23/41). Giữ lịch sử nhưng thêm nhãn ngay đầu mục: "lần chạy đầu, trước khi bỏ `global-setting`; kết quả hiện tại ở mục Vòng sửa lần 2". Sửa dòng "khối Salanca 13 UID" thành 12. Không viết lại số liệu cũ.

## Không làm trong lượt này

- Không sửa lọc `locales` của `i18n.translation-missing` (v0.2).
- Không tách log Strapi khỏi stdout của `--json` (v0.2).
- Không đổi danh sách 12 content type, không sửa nội dung Salanca (seed bundle là việc riêng).
- Không bắt đầu v0.2.

## Gate (gọn)

```powershell
Set-Location D:\outsource\salanca\salanca-seo
pnpm run build:seo-toolkit
pnpm run typecheck
pnpm run typecheck:seo-toolkit
pnpm exec eslint src/plugins/seo-toolkit config/plugins.ts config/plugins.test.ts
pnpm exec vitest run src/plugins/seo-toolkit config/plugins.test.ts
pnpm run smoke:seo-toolkit
git diff --check
```

Không chạy toàn bộ bộ test. Script `.mjs` không nằm trong phạm vi eslint của repo (đã ghi ở "Điều lệch" mục 4).

## Báo cáo cuối

Dùng đúng trạng thái: `implemented`, `automated verification passed`, `ready for manual UAT`. Nêu:

- từng lệnh đã chạy và kết quả, kể cả `smoke:seo-toolkit` (số ca đạt, tên DB test đã dùng);
- kết quả 8 ca ở T1, đặc biệt ca 7 và 8 (bằng chứng A2 trực tiếp và `status`); ca nào không chạy được thì nói rõ lý do;
- xác nhận **không có thao tác ghi nào lên DB dev** (nêu cách đã chốt: tên DB trong log khởi động);
- mục "Điều lệch kế hoạch" mới (đánh số tiếp từ 17);
- danh sách file đã đổi (chỉ trong phạm vi), và việc còn mở cho tan_ngo (gọi thử route trên server dev bằng JWT thật nếu muốn, mở Admin xem quyền trong Role).

Điền các kết quả mới vào Completion record của `docs/plans/seo-toolkit-v0.1-cms-audit.md`.
