# Prompt: sửa 4 lỗi đồng thời sau review (cc47e33)

Gửi cho agent: "Đọc `D:\outsource\salanca\salanca-backend-finish\docs\plans\ordering-review-fixes-3-handoff.md` và làm theo
phần dưới dấu `---`".

---

Làm việc trong **worktree** `D:\outsource\salanca\salanca-backend-finish`, nhánh `feat/ordering-finish`, đang ở `cc47e33`
(cùng commit với `origin/feat/ordering`). Nhiệm vụ: sửa **4 lỗi đồng thời / lỗi giữa chừng** trong plugin `ordering`
(Strapi 5.51.1, `src/plugins/ordering`). Lỗi đã được review xác nhận, có vị trí cụ thể bên dưới.

Mỗi lỗi phải có **test tái hiện chạy trên PostgreSQL**, đỏ trước khi sửa và xanh sau khi sửa. Kiểm soát thứ tự bằng barrier
hoặc chạy song song thật, hoặc inject lỗi giữa hai bước — không dùng `sleep` đoán giờ.

Làm tự chủ tới hết. Gặp chỗ mơ hồ thì chọn cách an toàn, đơn giản, và ghi lý do.

## Môi trường

```bash
cd /d/outsource/salanca/salanca-backend-finish
git status --short                                  # sạch
pnpm install --frozen-lockfile                      # KHÔNG sửa .npmrc, pnpm-workspace.yaml
pnpm run build:ordering                             # bắt buộc trước khi chạy script
export ORDERING_TEST_DATABASE=salanca_ordering_review_fixes
```

- Chỉ dùng DB test `salanca_ordering_review_fixes`. **Tuyệt đối không** chạm `salanca_cms` hay production; không chạy
  `check:phase3`, `smoke:*`, `strapi develop`.
- Các thư mục khác dưới `D:\outsource\salanca\` và `C:\Users\tan_ngo\orca\workspaces\salanca-backend\` là của session khác
  (3 agent đang làm O9, O12, O13). **Không sửa, không chạy lệnh hay git trong đó.**

## 4 lỗi cần sửa

### 1. [P1] Xóa dữ liệu báo xong nhưng vẫn còn đơn mang thông tin khách

**Vị trí:** `server/src/services/data-rights.ts` khoảng dòng 250–300 (hàm xử lý yêu cầu xóa).

**Lỗi:**
- Hàm đếm đơn đang mở (`openCount`) **ngoài** transaction, rồi mới mở transaction xóa hồ sơ.
- Một đơn mới tạo chen vào giữa hai bước này (khách đang đăng nhập đặt đơn, hoặc vãng lai cùng số).
- Kết quả: yêu cầu `done`, khách `erased`, nhưng đơn mới vẫn `open`, vẫn liên kết hồ sơ và giữ số điện thoại.

**Hướng sửa:**
- Bước hoàn tất và bước liên kết khách khi tạo đơn phải **đồng bộ trên cùng một khóa**.
  - `services/customer.ts` `linkForOrder` đã dùng `pg_advisory_xact_lock(hashtext('ordering-customer:<phoneHash>'))` cho
    nhánh theo số điện thoại. Nhánh `sessionCustomerId` thì **chưa khóa**.
- Trong transaction hoàn tất erasure, theo đúng thứ tự:
  1. lấy khóa advisory của khách (theo `phoneHash`; hồ sơ chỉ có email thì dùng khóa dẫn xuất từ id);
  2. `SELECT … FOR UPDATE` dòng khách;
  3. **đếm lại** đơn đang mở bên trong transaction — còn đơn mở thì quay về `waiting`, không xóa.
- `linkForOrder` nhánh session cũng lấy cùng khóa, và kiểm `status <> 'erased'` dưới khóa. Khóa giữ tới khi đơn commit, vì
  `linkForOrder` chạy trong transaction của `createOrder`.

**Test:**
- Erasure dừng sau bước đếm (hook hoặc barrier); trong lúc đó tạo một đơn cho đúng khách đó; cho erasure chạy tiếp.
- Kết quả đúng: hoặc yêu cầu thành `waiting` và đơn còn nguyên, hoặc đơn không gắn vào hồ sơ đã xóa.
- Không bao giờ được: `done` mà còn đơn `open` liên kết khách hoặc giữ số điện thoại.

### 2. [P1] Webhook mất sự kiện vĩnh viễn

**Vị trí:** `server/src/services/webhook-delivery.ts` khoảng dòng 365–405 (`fanout`).

**Lỗi:**
- `INSERT` dòng giao (payload `'{}'`, `next_attempt_at` NULL) rồi `UPDATE` payload là **hai câu lệnh rời**.
- Lỗi giữa hai câu (tiến trình chết, lỗi khi đọc khách) để lại dòng `pending`, payload `{}`, `next_attempt_at` NULL.
- Outbox retry thì `ON CONFLICT DO NOTHING` bỏ qua dòng này. Dispatcher chỉ lấy `next_attempt_at <= now`, nên không bao giờ
  gửi nó → sự kiện mất hẳn.

**Hướng sửa (chọn một, hoặc cả hai):**
- (a) Ghi dòng giao **hoàn chỉnh trong một transaction**: dựng payload trước rồi insert một lần có payload và
  `next_attempt_at`; hoặc insert + update trong cùng transaction.
- (b) Khi retry gặp conflict, nếu dòng hiện có còn `next_attempt_at IS NULL` (chưa hoàn chỉnh) thì **hoàn chỉnh lại** nó
  thay vì bỏ qua.

Nên làm (a) và giữ (b) để chữa các dòng hỏng đã có. Không được gửi trùng: một (endpoint, event) chỉ một lần giao thành công.

**Test:**
- Inject lỗi ngay sau insert ở lần fanout đầu.
- Chạy lại consumer của outbox như retry thật.
- Dispatcher phải gửi đúng 1 lần, với payload đúng.

### 3. [P2] Gộp giỏ đồng thời tự nhân đôi số lượng

**Vị trí:** `server/src/services/cart.ts` khoảng dòng 389 (`merge`); `resolve` ở dòng 371 gọi nó.

**Lỗi:**
- `merge` khóa giỏ đích (`mutateLocked`) nhưng **không khóa và không đọc lại giỏ nguồn** (giỏ vãng lai).
- Hai request cùng lúc mang cùng `X-Cart-Token` và cùng phiên khách → cả hai cộng món của giỏ vãng lai vào giỏ tài khoản.
  1 phần thành 2 phần.

**Hướng sửa:**
- Trong cùng transaction: khóa **cả hai** giỏ theo thứ tự id tăng dần (tránh deadlock), rồi đọc lại giỏ nguồn.
- Giỏ nguồn không còn `active` (request kia đã gộp) thì **không cộng gì**, trả giỏ đích.
- Đánh dấu giỏ nguồn `expired` trong cùng transaction đó.
- Nhánh "khách chưa có giỏ" (gán `customer` cho giỏ vãng lai) cũng làm dưới khóa và kiểm lại trạng thái.

**Test:** 2–3 request `merge` song song thật trên cùng cặp giỏ (barrier). Số lượng sau gộp phải bằng số lượng ban đầu.
Thêm vào `scripts/ordering/review-extra.mjs` hoặc `cart.mjs`.

### 4. [P2] Gửi OTP đồng thời vượt giới hạn theo email

**Vị trí:** `server/src/services/customer-auth.ts` khoảng dòng 191 (`requestOtp`).

**Lỗi:**
- Hàm đếm số challenge gần đây (`recent`) rồi mới `create`, không có khóa giữa hai bước.
- Giới hạn `sendMax = 3`, nhưng 8 request cùng lúc cùng email tạo được 8 challenge thật và gửi 8 email.

**Hướng sửa:**
- Bọc bước đếm và bước tạo challenge trong transaction có
  `pg_advisory_xact_lock(hashtext('ordering-otp:<targetHash>'))`.
- Gửi email **sau** khi transaction commit, không giữ khóa trong lúc gửi mail.
- Khi vượt ngưỡng vẫn trả challenge giả, cùng hình dạng response (giữ hành vi chống dò hiện có).

**Test:** 8 request song song cùng email → đúng 3 challenge thật trong DB và đúng 3 email trong capture provider; các request còn
lại nhận challenge giả. Thêm vào `scripts/ordering/customer-auth.mjs`.

## Đã có, dùng lại

- **Mẫu test 2 process có barrier:** `scripts/ordering/promotion-race.mjs`, `scripts/ordering/outbox-two-process.mjs`.
- **Mẫu test cho review:** `scripts/ordering/review-extra.mjs` — chạy song song trong cùng process bằng `Promise.all`.
- **Mẫu khóa:**
  - `services/customer.ts` `linkForOrder` (advisory lock theo `phoneHash`);
  - `services/cart.ts` `mutateLocked` (khóa dòng giỏ, đọc lại, ghi);
  - `services/idempotency.ts` (advisory lock theo key).
- **Ghi chú review trước:** `docs/plans/ordering-review-fixes.md` — đọc trước để giữ nguyên các bản sửa đợt 1 và 2.

## Những điều đã chứng minh

- `strapi.db.transaction` lồng nhau dùng lại transaction ngoài; `onCommit` chạy sau commit ngoài cùng.
- `pg_advisory_xact_lock` giữ tới khi transaction **ngoài cùng** kết thúc.
- knex/`db.raw` có thể trả JSON dạng chuỗi — parse khi đọc qua raw SQL.
- `pnpm run typecheck` ở root **không** kiểm server plugin; lỗi kiểu server chỉ hiện ở `pnpm run build:ordering`.
- Cảnh báo `pg` "client.query() when the client is already executing a query" là lỗi cũ từ populate của `@strapi/database` —
  không sửa, không tính là lỗi.

## Quy tắc

- Không thêm hay nâng dependency. Không sửa schema/content type, trừ khi bắt buộc; nếu buộc phải sửa thì thêm migration plugin mới
  với tên chưa dùng, **không** dùng `0010`–`0012` (O9/O12/O13 đã giữ).
- Không `git stash`. Không in token, OTP hay số điện thoại ra log.
- Mỗi lỗi một commit, kết thúc message bằng dòng `Co-Authored-By` của agent.

## Kiểm tra (gọn — không chạy `check:ordering`)

```bash
pnpm run lint && pnpm run typecheck
pnpm exec vitest run src/plugins/ordering
pnpm run build:ordering
node scripts/ordering/review-extra.mjs
node scripts/ordering/data-rights.mjs
node scripts/ordering/webhooks-out.mjs
node scripts/ordering/cart.mjs
node scripts/ordering/customer-auth.mjs
node scripts/ordering/create-order.mjs
```

- Cộng các script test mới, nếu tách file riêng.
- Lỗi ở bước nào thì chỉ chạy lại bước đó.
- Không cần `strapi build`, vì không đổi giao diện Admin.

## Khi xong

1. Ghi mục "Third review round" vào `docs/plans/ordering-review-fixes.md`: từng lỗi, cách sửa, test, kết quả lệnh thật.
2. `git fetch origin && git merge origin/feat/ordering` — các phase O9/O12/O13 có thể đã vào. Giải conflict bằng cách lấy cả
   hai bên. Rồi `pnpm run build:ordering` và chạy lại kiểm tra gọn.
3. `git push origin HEAD:feat/ordering-finish` rồi `git push origin HEAD:feat/ordering`. Bị từ chối thì fetch, merge, kiểm lại,
   push lại. **Không** force push, không merge vào `main`.
4. Báo cáo:
   - danh sách commit;
   - test tái hiện đỏ trước / xanh sau cho từng lỗi;
   - kết quả từng lệnh;
   - trạng thái push.
