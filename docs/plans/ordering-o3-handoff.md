# Prompt: thực hiện Phase O3 (tự lấy + tiền mặt + hộp đơn)

Dán nguyên phần dưới vào session mới.

---

Làm việc trong `D:\outsource\salanca\salanca-backend`. Nhiệm vụ: code **Phase O3 — Đặt món tự lấy, trả tiền
mặt, hộp đơn Admin** của plugin `ordering`. Spec, kế hoạch, mockup và đặc tả màn hình đã được chủ dự án duyệt;
chỉ code theo đúng các tài liệu đó.

## Bước 0: chuẩn bị nhánh (làm trước mọi việc)

```bash
git switch feat/ordering-o2 && git status --short          # phải sạch (trừ file nháp chưa track)
git fetch origin
git switch -c feat/ordering-o3
git merge --no-ff origin/docs/ordering-ui-o3 -m "docs(ordering): merge UI research and screen specs"
```

Merge này đã được thử trước, không conflict. Nếu có conflict: dừng và báo, không tự chọn bên.
Làm toàn bộ O3 trên `feat/ordering-o3`. Không merge vào `main`, không push khi chủ dự án chưa nói.

## Đọc trước khi code (theo thứ tự)

1. `AGENTS.md`, `PLANS.md`.
2. `docs/phases/phase-ordering-3-pickup-cash.md`: spec O3, gồm "Bổ sung sau review", "Quyết định đã chốt trước
   O3" và "Bổ sung từ nghiên cứu UI".
3. `docs/plans/ordering-o3-pickup-cash.md`: kế hoạch 15 bước.
4. **`docs/plans/ordering-o3-screens.md`**: đặc tả 9 màn S1–S9 (route, quyền, API, field, trạng thái, component).
   Mọi màn UI làm đúng file này. Đổi tên API thì sửa file đó trong cùng commit.
5. `docs/plans/mockups/ordering-o3-pickup-cash.html`: số liệu mẫu, dùng làm ca test và UAT.
6. `docs/plans/ordering-reference.md` mục U3: nguồn UI đã học (TastyIgniter, Medusa, Saleor, Vendure).
7. `docs/plans/ordering-core-contracts.md`: mục 14 (quyền, bảo mật), 17, 19, 21. Đặc biệt **21.10**: khi
   replay `Idempotency-Key`, trả lại đúng order token. Token lưu mã hóa AES-256-GCM bằng
   `ORDERING_ENCRYPTION_KEY` trong bản ghi idempotency.
8. `src/plugins/ordering/README.md`, Completion record của `ordering-o1-core.md` và `ordering-o2-catalog.md`.

## Trạng thái hiện tại

- O0, O1 đã đóng. O2 đã code xong và qua review tự động. UAT giao diện O2 do chủ dự án làm song song, không chặn
  O3. Nếu chủ dự án báo lỗi UAT O2, sửa trên `feat/ordering-o3` bằng commit `fix(ordering): O2 ...` riêng.
- Catalog thật đã có (adapter `ordering-catalog`, product type `food`). O3 dùng catalog qua pipeline, không đọc
  bảng catalog trực tiếp.
- Test tích hợp: `scripts/ordering/*.mjs` + `_harness.mjs` trên `salanca_ordering_test`. `pnpm run check:ordering`
  hiện có 20 script, gồm guard import admin và build admin khi bật plugin.

## Bước 0b: sửa build server trước khi thêm code (từ review O2)

`scripts/ordering/build-server.mjs` dựng lại `dist/server` rồi thay chuỗi cố định
`../../../../shared/catalog/` trong file JS. Một file server ở độ sâu khác import `shared/` sẽ gãy lúc chạy, mà
O3 sẽ thêm module shared mới. Sửa để không phụ thuộc độ sâu, ví dụ:

- (khuyên dùng) tsc build thẳng `rootDir: ".."`, `outDir: "../dist"` (ra `dist/server/src/**` và
  `dist/shared/**`, giữ nguyên cấu trúc nên import tương đối luôn đúng), bỏ bước chép/thay chuỗi. Khi đổi entry
  phải sửa **cùng commit** mọi chỗ trỏ `dist/server/index.js`: `src/plugins/ordering/package.json` (`exports`),
  `config/plugins.ts` (`orderingServerEntry`, kiểm fail-fast), `scripts/ordering/jobs.mjs`,
  `scripts/ordering/build-server.mjs`, `scripts/backfill-media/backfill-media.helper.mjs` (nếu đụng tới). Grep
  `dist/server` để chắc không sót; hoặc
- viết lại import bằng cách tính đường dẫn tương đối thật từ vị trí từng file (không thay chuỗi cố định).

Thêm kiểm tra trong `check:ordering`: sau build, mọi import tương đối trong `dist/**/*.js` phải trỏ tới file có
thật. Một commit riêng. Gates: `check:ordering`, `check:phase3` với plugin bật.

## Những điều đã chứng minh (không đọc lại source để cãi)

- Strapi 5.51.1 **không tạo unique index cho `unique: true`**. Unique (mã đơn, `Idempotency-Key`, slot hold…)
  tạo bằng migration plugin. Migration O3 đặt tên `0003-o3-...`.
- Bảng plugin giữ khi tắt plugin nhờ `persisted_tables`. `disable-survives.mjs` phải vẫn đạt.
- **Code admin không được import `server/**` hay `@strapi/utils`** (vỡ bundle trình duyệt; guard đã có). Logic dùng
  chung cả admin và server đặt ở `src/plugins/ordering/shared/`, TypeScript thuần, không import `@strapi/*`,
  `node:*`.
- Handler condition Admin nhận thẳng object user; không có scope thì trả `false`.
- `includeUnparsed` có raw body (dùng ở O4, không cần ở O3).
- CORS: `X-Order-Token`, `Idempotency-Key` đã có trong `config/middlewares.ts` (chỉ khi `ORDERING_ENABLED=true`).
  Bước 6 của kế hoạch chỉ cần kiểm test và preflight, không thêm lại.
- Outbox dùng `FOR UPDATE SKIP LOCKED` + lease (O1). Email gửi qua consumer outbox, không gửi trong request.

## Quyết định mới cho O3: IP khách cho rate limit và Turnstile

Sau Cloudflare, hoặc khi web Next.js gọi từ server, `ctx.request.ip` là IP của proxy hoặc của server web. Cả
public catalog (O2) lẫn storefront O3 đều cần IP thật. Chốt:

- Plugin có `server/src/domain/client-ip.ts` (thuần) với `resolveClientIp(ctx, config)`. Config plugin nhận
  `clientIp: { sharedSecret?: string, secretHeader: string, ipHeader: string }` từ `config/plugins.ts` của app.
- Chỉ tin `ipHeader` khi `secretHeader` khớp `sharedSecret` (so sánh timing-safe) và giá trị là IP hợp lệ.
  Ngược lại dùng `ctx.request.ip`. Header sai không bao giờ làm request bị từ chối.
- Salanca: `config/plugins.ts` truyền `secretHeader: 'x-salanca-intake-secret'`, `ipHeader:
  'x-salanca-visitor-ip'`, `sharedSecret: env('FORM_INTAKE_SHARED_SECRET')`, giống form intake hiện có
  (`src/domain/form-intake/client-ip.ts`). Đọc file đó để hiểu hành vi, **không import** (plugin không import
  code app). Viết lại trong plugin, không chép nguyên.
- Dùng cho: rate limit catalog (thay `ctx.request.ip` ở `controllers/catalog.ts`), mọi rate limit storefront O3,
  `remoteip` của Turnstile.
- Test: Vitest cho các nhánh (không secret, sai secret, IP rác, đúng); tích hợp: hai IP khác nhau qua header có
  secret đúng thì có hai bucket riêng.
- Ghi vào `docs/security-baseline.md` và README plugin (phần config). Ghi thêm việc mở cho OW: web phải gửi hai
  header này khi gọi API ordering từ server (hiện web chỉ gửi cho form).

## Khóa mã hóa `ORDERING_ENCRYPTION_KEY` (chưa có trong repo)

Contracts 21.10 cần khóa này ở bước 5, nhưng hiện chưa có ở `.env.example` hay config. Làm:

- Định dạng: 32 byte, base64. Plugin nhận qua config (`encryptionKey: env('ORDERING_ENCRYPTION_KEY')` trong
  `config/plugins.ts`), không đọc `process.env` trực tiếp trong service.
- Bản mã lưu kèm tiền tố phiên bản khóa (vd. `v1:`) để sau này đổi khóa được.
- Thiếu hoặc sai định dạng khi `ORDERING_ENABLED=true` thì bootstrap báo lỗi rõ tên biến (không in giá trị).
  Plugin tắt thì không đòi.
- Thêm vào `.env.example` (comment, cách sinh: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
  README plugin, `docs/security-baseline.md`.
- `_harness.mjs` và các script test đặt sẵn một khóa test cố định nếu env chưa có, để `check:ordering` và
  `check:phase3` (plugin bật) chạy được trên máy chưa cấu hình. `.env` local của dev: tự sinh khóa riêng, không
  commit.
- Vitest: mã hóa rồi giải mã ra đúng token; sửa 1 byte bản mã thì giải mã lỗi; khóa sai định dạng bị từ chối.

## Cách làm

- Đi đúng thứ tự 15 bước của `ordering-o3-pickup-cash.md` (sau bước 0, 0b và phần client IP; client IP có thể gộp
  vào bước 4 "Captcha và rate limit"). Mỗi bước: code → test → gate liên quan → một commit trên
  `feat/ordering-o3` (message kết thúc bằng `Co-Authored-By` theo quy ước repo).
- Ca test bắt buộc lấy từ mockup O3 và acceptance của spec, gồm:
  - hai đơn tranh slot cuối thì một bị từ chối;
  - replay `Idempotency-Key` trả cùng order token;
  - token trong query string bị từ chối;
  - "Thu tiền và giao" lỗi giữa chừng thì không đổi gì;
  - hủy một phần hoàn **87.940**;
  - hai người cùng nhận một đơn thì một thành công;
  - "Nhận và lùi" đổi `estimatedReadyAt` và gửi email đúng một lần;
  - tra cứu sai số điện thoại không lộ đơn có tồn tại hay không;
  - thiếu `consent` thì `CONSENT_REQUIRED`.
- Màn Admin: theo `ordering-o3-screens.md`. Dùng Strapi Design System 2.2.3 và helper `@strapi/strapi/admin`
  (`Layouts`, `Page`, `useFetchClient`, `useNotification`, `useRBAC`). Mỗi màn có đủ 5 trạng thái (đang tải, trống,
  lỗi, không có quyền, đang lưu). Chuỗi hiển thị qua `admin/src/translations/{vi,en}.json`.
- Quyền kiểm ở service theo action + scope chi nhánh. Ẩn nút trên UI không thay cho kiểm ở API. Mỗi route admin
  mới phải có ca "nhân viên chi nhánh A gọi đơn chi nhánh B bị từ chối".
- SSE: dùng lại cách cấu hình chống buffer của hộp thư đặt bàn (đọc `src/api/reservation-inbox`, không import).
  Ghi giới hạn 1 instance.
- Email: Mailpit local. Không log địa chỉ email, số điện thoại hay token.

## Quy tắc bắt buộc

- Plugin không import code app. Không sửa content type, seed bundle hay dữ liệu của Salanca. **Không bao giờ chạy
  `pnpm export:cms-seed`.**
- Chỉ dùng DB `salanca_ordering_test`; không chạm `salanca_cms` hay production. `check:phase3` luôn chạy với
  `DATABASE_NAME=salanca_ordering_test`.
- Không log dữ liệu cá nhân hay secret. Tiền là số nguyên VND an toàn.
- Không thêm dependency mới khi chưa hỏi. Không chép code GPL (Vendure, WooCommerce, Action Scheduler).
- `types/generated/contentTypes.d.ts` luôn sinh với `ORDERING_ENABLED=true`.
- Không dùng `git stash` trần. Nếu phải stash: `git stash push -u -m "<tag riêng>"`, rồi `apply` theo SHA.

## Cổng kiểm tra trước khi báo xong

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run check:ordering
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=false pnpm run check:phase3
DATABASE_NAME=salanca_ordering_test ORDERING_ENABLED=true  pnpm run check:phase3
pnpm run smoke:reservation-form
node scripts/smoke-ordering-pickup.mjs
```

Tất cả exit 0. Ghi số thật (số file/test, số script) vào Completion record của `ordering-o3-pickup-cash.md` và
`docs/STATUS.md`. UAT thủ công (hai tab, hai chi nhánh, Mailpit) liệt kê rõ phần nào đã làm, phần nào chưa làm được.
Không claim phần chưa làm.

## Báo cáo khi xong

Danh sách commit, số test, kết quả từng gate, các chỗ lệch so với kế hoạch hoặc đặc tả màn hình (kèm lý do), việc
còn mở cho O4.
