# Prompt: thực hiện SEO-1 (plugin `seo-toolkit` v0.1, audit dữ liệu SEO trong CMS)

Gửi cho agent: "Đọc `docs/plans/seo-toolkit-v0.1-handoff.md` trong worktree `salanca-seo` và làm theo phần dưới dấu `---`".

---

Làm việc trong **worktree riêng** `D:\outsource\salanca\salanca-seo` (nhánh git `feat/seo-toolkit`, tách từ `feat/ordering` tại `f74d655`).

Nhiệm vụ: code **SEO-1 (v0.1)**: plugin Strapi local `src/plugins/seo-toolkit` (Strapi 5.51.1) cùng lệnh `pnpm run seo:audit` và route admin `POST /seo-toolkit/audit/run`. Spec và kế hoạch 10 bước đã đối chiếu với code ngày 2026-10-16; code đúng theo đó.

Làm **tự chủ tới hết**: không có người trả lời câu hỏi giữa chừng. Gặp chỗ mơ hồ thì chọn phương án an toàn và đơn giản, ghi lý do vào "Điều lệch kế hoạch" của file kế hoạch. Chỉ dừng hỏi khi phải đổi phạm vi, bảo mật hoặc dữ liệu, hoặc khi `pnpm install` bị chặn.

## Đọc trước khi code (theo thứ tự)

1. `docs/phases/phase-seo-toolkit-1-cms-audit.md`: spec. Đặc biệt mục 3 (11 quy tắc), **3b (định nghĩa chính xác)**, 4 (hợp đồng báo cáo), 5 (service, API, lệnh).
2. `docs/plans/seo-toolkit-v0.1-cms-audit.md`: kế hoạch từng bước, hợp đồng kiểu, thuật toán engine, bảng thông điệp, hai bảng test. Đây là tài liệu chính để code.
3. `docs/plans/seo-toolkit-roadmap.html`: chỉ mục "Luật tổng quát" (G1 đến G8) và card v0.1. Bỏ qua các release sau.
4. Mẫu cần nhân bản (đọc, không import): `src/plugins/ordering/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/config/index.ts`, `server/src/routes/index.ts`, `server/src/register.ts` (mảng `adminActions` và `registerMany`), `services/provider-status.test.ts` (kiểu `strapi` giả), `scripts/ordering/build-server.mjs`, `scripts/lib/strapi-load.mjs`, `scripts/create-preview-token.mjs`, `config/plugins.ts` (`resolveOrderingPluginConfig`) và `config/plugins.test.ts`.

## Bước 0: môi trường

```powershell
Set-Location D:\outsource\salanca\salanca-seo
git status --short                    # chỉ có các file docs SEO chưa commit (và .commandcode/ của công cụ khác, không đụng)
git log --oneline -1                  # f74d655 hoặc con của nó
pnpm install --frozen-lockfile        # KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:ordering               # baseline
pnpm run typecheck                    # baseline
pnpm exec vitest run config/plugins.test.ts
```

Ghi kết quả baseline (kể cả lỗi sẵn có) vào Completion record. Nếu `pnpm install` bị `minimumReleaseAge` chặn vì `@tanngo11/log` mới phát hành, **dừng và báo**, không tự hạ ngưỡng.

## Ranh giới

- Chỉ làm trong `D:\outsource\salanca\salanca-seo`. Các thư mục khác dưới `D:\outsource\salanca\` (`salanca-backend`, `salanca-notify`, `salanca-web`) là của session khác: **không sửa file, không chạy lệnh hay git trong đó**. Thư mục `artifacts/` (nếu thấy) không đụng.
- Không sửa `docs/STATUS.md`, `AGENTS.md`, schema/seed/content type của Salanca, `.npmrc`, `pnpm-workspace.yaml`.
- Plugin không import `src/domain`, `src/api`, `src/plugins/ordering`; không ghi cứng UID Salanca (UID Salanca chỉ ở `config/plugins.ts`).
- Audit chỉ đọc. Không thêm content type, migration, cron, middleware. Không SQL thô.
- Sửa `package.json` đúng như bước 1 của kế hoạch (ba dòng sẵn có và bốn script mới), không thêm dependency.

## DB (bước 7)

Cần Postgres local và `.env` dev thường dùng. Audit chỉ đọc, nhưng khởi động Strapi chạy các bootstrap thường lệ. **Không** đặt `ORDERING_ENABLED`, **không** chạy `seed:*`, `data:import`, `media:*`, `smoke:*`, `check:phase3` hay bất kỳ script nào ghi dữ liệu. Không có DB thì ghi lý do chặn, đánh dấu A1 và A2 là "chưa chạy thật", và **không** coi bước 7 là qua.

## Gate (gọn)

Chỉ chạy các lệnh ở mục "Verification" của kế hoạch. Không chạy toàn bộ bộ test.

## Commit và push

**Không commit, không push** cho tới khi chủ dự án (tan_ngo) nói. Để thay đổi ở working tree và báo cáo. (Quy tắc của chủ dự án: chỉ commit khi được yêu cầu.)

## Báo cáo cuối

Dùng đúng trạng thái: `implemented`, `automated verification passed`, `ready for manual UAT`. Nêu:

- từng lệnh đã chạy và kết quả (kể cả lỗi baseline sẵn có);
- kết quả bước 7: số entry, số lỗi mỗi mức, mã lỗi xuất hiện, các lỗi `error`, dương tính giả, loại nội dung nào có vẻ không phải trang thật (không tự bỏ UID nào);
- kết quả A1 và A2;
- mục "Điều lệch kế hoạch";
- danh sách file đã đổi (xác nhận chỉ trong phạm vi) và các cổng thủ công còn mở.

Điền Completion record trong `docs/plans/seo-toolkit-v0.1-cms-audit.md`.
