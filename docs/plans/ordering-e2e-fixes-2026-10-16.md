# Ordering — sửa lỗi từ báo cáo E2E 16/10/2026

Status: Automated verification passed và đã commit cục bộ, chưa push (Nhóm A, 2026-10-16; BUG-03/04 nằm trong commit R1 `80dcecd`) — chưa `Complete`: còn UAT tay của user và các quyết định D0–D4. D0–D3 chốt theo mặc định đề xuất; D2/D3 có chỗ lệch đã ghi ở Completion record.
Owner: AI thực thi do user chỉ định; user duyệt kết quả và tự UAT UI
Last updated: 2026-10-16
Related phase: nhánh `feat/ordering-notify-release`; nguồn lỗi là `docs/BAO-CAO-E2E-ORDERING.md` (bản HTML có ảnh: `C:\Users\tan_ngo\Downloads\BAO-CAO-E2E-ORDERING.html`)

> **For agentic workers:** dùng `superpowers:executing-plans` (nếu có) và làm tuần tự từng task, tick checkbox `- [ ]` khi xong. Chỉ một AI sửa code tại một thời điểm.

## Goal

Sửa 13 bug (BUG-01…13), lỗi "Yêu cầu dữ liệu xóa không cần xác nhận" và các điểm UX lộ thông tin nội bộ trong báo cáo E2E, theo đúng thứ tự ưu tiên của báo cáo (§5), mỗi lỗi có test hoặc bước kiểm chứng đo được.

## Non-goals

- Không đụng schema Salanca CMS; chỉ code trong `src/plugins/ordering`, `scripts/ordering`, `docs`.
- Không chạy `scripts/ordering/run-all.mjs` toàn bộ và không chạy UAT UI bằng AI (memory: *Ordering targeted gates*). User tự UAT UI.
- Không sửa `0007-o11-customers.ts` (migration đã chạy; sửa lịch sử là sai). Lỗi dữ liệu cũ xử lý bằng migration mới.
- Không thêm redirect, không đụng nội dung CMS/`bundle.json`.
- Không sửa lỗi môi trường tester (DNS `example.com` → 198.18.0.1, cổng 1337, Node 20, rate limit thiếu intake secret).

## Current evidence

Đã đối chiếu từng bug với code hiện tại (đọc trực tiếp, chưa chạy lại E2E):

| Bug | Kết quả đối chiếu | Bằng chứng |
|---|---|---|
| Yêu cầu dữ liệu xóa | **Xác nhận** | `data-rights.ts:693` gọi `process()` ngay sau `create`; UI `DataRequests/index.tsx:84` mặc định `'erase'`, `:137` POST thẳng. Server tự xóa của khách (`/me/erase`) đòi `confirm:true` (`controllers/customer.ts:156`) nhưng đường staff thì không. |
| BUG-01 Bếp trống | **Xác nhận** | `controllers/kitchen.ts:42` trả `{ item: board }`; `Kitchen/index.tsx:136` `setBoard(data as KitchenBoard)` rồi đọc `board.orders` → `undefined`. |
| BUG-02 Tổng chi | **Xác nhận** | `customer.ts:384` `sum + order.totalAmount`; `order.totalAmount` là `biginteger` (`order/schema.ts:37`) → Postgres trả chuỗi → `0 + "45000" + "30000"` = `"04500030000"`. Bỏ qua `canceledAmount` (`schema.ts:42`). Test cũ không bắt được vì `customers.mjs:140,146,400` chỉ có **1** đơn hoàn tất mỗi khách: `Number("0195000") === 195000`. |
| BUG-03 Proxy đệ quy | **Xác nhận** | `registry.ts:136-152`: `get('send')` trả closure gọi `target.send` **lúc gọi**; `set` ghi đè `target.send`. `review-otp-race.mjs:26-27` làm `originalSend = capture.send; capture.send = async (…a) => originalSend(…a)` → closure gọi lại chính nó. |
| BUG-04 test registry | **Xác nhận** | `registry.ts:56` đòi `({ strapi })`; `registry.test.ts` gọi `createRegistry()` ở dòng 19, 31, 45, 55, 78, 94. |
| BUG-05 seed UAT | **Xác nhận bằng đọc code** | `uat-server.mjs:491` `dailyLimit: 5`; comment `:483-485` nói hai đơn O7 đã lấy 4 suất bún bò; đơn dine-in `:593` xin thêm 2. Chưa chạy lại seed. |
| BUG-06 Chênh lệch chốt tiền | **Xác nhận** | `cash-closing.ts:299` `snapshot()` trả `differenceAmount` đã đóng băng lúc chốt; UI `CashClosing/index.tsx:333-335` hiện đúng số đó. `expectedAmount` thì tính lại theo sổ (`:314`). |
| BUG-07 trang trắng khi 403 | **Xác nhận nguyên nhân chính, một phần còn mở** | (1) `permissions.ts:85` `RBAC_KITCHEN` có cả `order.process`, nhưng mọi route bếp chỉ cần `kitchen.read` (`routes/index.ts:245-249`) → vai trò giao hàng thấy mục Bếp rồi gặp lỗi tải. (2) `Categories` và `Availability` không có chặn quyền nào, 403 chỉ ra toast + trang rỗng. (3) `Tables/index.tsx:187` **đã có** chặn quyền và khớp `table.manage`, nên "giao-q1 mở Bàn & QR trắng" chưa giải thích được → Task 8 Step 7 xin console/Network nếu còn thấy. |
| BUG-13 route lạ | **Xác nhận** | `App.tsx:370-401` không có `<Route path="*">`; route `index` trả `null` khi `first` rỗng. |
| BUG-08 lỗi form tiếng Anh | **Xác nhận** | Server đưa `message` zod thô vào `details.issues` (`domain/loyalty/settings.ts:45-46,77-79`, `price-list-input.ts:82-84,163-165`, …); `Loyalty/index.tsx:117` in nguyên chuỗi; `PriceLists` chỉ toast `error.PRICE_LIST_INVALID` (Task 10). |
| BUG-09 giờ UTC ở xem trước khuyến mãi | **Không phải bug plugin** | `PromotionEditor.tsx:97-103,700` dùng giờ của **trình duyệt**; tester chạy trình duyệt UTC. Đóng sau khi user kiểm trên trình duyệt múi giờ VN (Task 11). |
| BUG-10 OpenAPI | **Xác nhận** | `operations.ts:835-841` không khai query bắt buộc; `loyalty-settings` PUT từ chối `startsAt` do `loyaltySettingsInputSchema.omit().strict()` (`domain/loyalty/settings.ts:34`) (Task 12). |
| BUG-11 thiếu `key` | **Chưa tái hiện bằng đọc code** | Mọi `.map` trong `Providers/index.tsx` đã có `key` (`:133,139,189`). Cần nguyên văn cảnh báo console trước khi sửa (Task 11). |
| BUG-12 hiện mã tag | **Xác nhận** | `rating.ts:116,168` trả mã; `Ratings/index.tsx:119-123,368-370` in mã; nhãn ở `ratingTags[].label` (Task 11). |

Sweep anh em của BUG-01/02 (làm trong Task 2 và 3, kết quả ghi vào Completion record): các `setX(data as …)` ở `admin/src/pages` còn chưa đối chiếu envelope; các `reduce` cộng cột `biginteger` ở `server/src/services` (`carrier-assignment.ts:438`, `payment-matching.ts`, `order-edit.ts:554,574`, `order.ts:1072`).

## Decisions and assumptions

- **D0 — ĐÃ CHỐT (user: "không sao"):** công việc R1a/notify (`registry.ts`, `config/plugins.ts`, `scripts/ordering/notify-*.mjs`, …) **chưa commit** và BUG-03/04 nằm trong đó. Cứ sửa thẳng trên working tree hiện tại, **không commit R1a**. AI thực thi: không `git stash`, không commit/push, không stage; chỉ sửa đúng file ghi trong từng task rồi báo danh sách file đã đổi. Commit khi user nói.
- **D1 — ĐÃ CHỐT theo mặc định (Task 1):** staff xóa dữ liệu = bắt buộc xác nhận hai bước ở UI + `confirm:true` ở server, vẫn xử lý ngay. Thời gian chờ/hoàn tác (ví dụ 24 giờ) là việc riêng, ngoài plan này.
- **D2 — ĐÃ CHỐT theo mặc định (Task 3):** "Tổng chi" = `Σ max(0, totalAmount − canceledAmount)` trên đơn `completed` (đúng `payableTotal` ở `domain/payable.ts:14`), chưa trừ hoàn tiền. Kèm migration `0014` tính lại dữ liệu đã hỏng. Site chưa live nên migration chỉ sửa dữ liệu UAT/dev; vẫn có để DB nào chạm lỗi cũng tự lành.
- **D3 — ĐÃ CHỐT theo mặc định (Task 7):** nâng giới hạn bún bò 5 → 7 (giữ "gần hết" 4/7 → 6/7) thay vì 20 như tester; bước 1b kiểm lại ngưỡng "gần hết" thật, nếu không khớp thì chuyển sang phương án giảm đơn dine-in còn 1 suất. Cả hai cách đều sửa comment `:483-485`.
- **D4 — ghi nhận, không sửa:** `cash-closing.ts:593` (`adjust`) gọi `collectorBucket(...)` **không** truyền `trx` và không lấy advisory lock như `close`; có thể lệch với posting đồng thời. Không thuộc báo cáo; chỉ ghi lại, sửa khi user đồng ý.
- Assumption: Postgres trả `biginteger` dạng chuỗi (đã thấy ở `customer.ts:58 Number(row.totalSpent)` và `cash-closing.ts:94 int()`).
- Assumption: scripts tích hợp import `src/plugins/ordering/dist/...` → **phải `pnpm build:ordering` trước khi chạy script** sau mỗi lần sửa server.

## Invariants

- `audit-event`/`change-log` append-only; hành động xóa dữ liệu vẫn ghi `data-request.create` (`data-rights.ts:684`).
- Quyền theo chi nhánh (scope) không đổi: ngoài scope vẫn trả 404/403 như cũ.
- `closing.differenceAmount` đã lưu **không đổi** (bằng chứng kiểm toán); chỉ thêm trường tính trực tiếp.
- Allowlist thông báo (R1a) vẫn chặn người nhận ngoài danh sách khi `mode=allowlist`.
- Không trường biginteger nào được cộng trước khi ép `Number`.

## Bối cảnh cho AI thực thi

- Repo: `D:\outsource\salanca\salanca-notify` (Strapi backend; plugin ở `src/plugins/ordering`), nhánh `feat/ordering-notify-release`, Windows. Đọc `AGENTS.md` và `docs/STATUS.md` trước khi sửa.
- **Làm ở đâu:** ngay tại worktree này (`D:\outsource\salanca\salanca-notify`, nhánh `feat/ordering-notify-release`; đây đã là một git worktree riêng, tách khỏi `salanca-backend` và `salanca-seo`). **Không tạo worktree mới** khi R1a còn chưa commit: worktree mới từ HEAD sẽ không có `registry.ts` đã sửa (Task 5/6 vô nghĩa) và khi gộp lại sẽ xung đột với 11 file của plan đang bị sửa dở (`registry.ts`, `App.tsx`, `permissions.ts`, `i18n.ts`, `Providers/index.tsx`, `operations.ts`, `ordering-admin-openapi.json`, `STATUS.md`, `run-all.mjs`, `_harness.mjs`, `o3.test.ts`). Chỉ **một** AI sửa trong thư mục này tại một thời điểm; nếu AI làm R1a/notify còn đang chạy, chờ nó xong.
- Nguồn lỗi: `docs/BAO-CAO-E2E-ORDERING.md` (ảnh minh họa chỉ có trong `C:\Users\tan_ngo\Downloads\BAO-CAO-E2E-ORDERING.html`). Script E2E của tester **không có trong repo**; đừng tìm chúng, test mới nằm trong repo (vitest và `scripts/ordering/*.mjs`).
- Working tree đang có ~35 file R1a chưa commit và nhiều file không liên quan (`.commandcode/`, `artifacts/`). Không đụng, không xóa, không format lại chúng. Task 5/6 sửa `registry.ts` và `registry.test.ts` vốn đang bị sửa dở (R1a): sửa chồng lên, giữ phần R1a.
- Script `scripts/ordering/*.mjs` import mã **đã build** (`src/plugins/ordering/dist/...`): sau mỗi sửa phía server phải `pnpm build:ordering` trước khi chạy script. Biến môi trường DB/Node: đọc đầu `scripts/ordering/_harness.mjs`; tester cần Node 22 và Postgres local.
- Không chạy `scripts/ordering/run-all.mjs`, không chạy Playwright/UAT UI. Chỉ chạy lệnh ghi trong từng task.
- Gặp chỗ plan nói "định vị bằng `rg`" thì làm đúng lệnh đó trước khi sửa; nếu kết quả khác giả định trong plan, **dừng và ghi vào Completion record** thay vì đoán.
- Làm theo nhóm: **Nhóm A (bug)** = Task 1–8, 10–12 (+ tài liệu ở Task 13); **Nhóm B (UX)** = Task 9, chỉ làm khi user nói.

## Thứ tự và bảng theo dõi

| Wave | Task | Bug | Mức | Gate chính |
|---|---|---|---|---|
| 0 | 0 | kiểm working tree | — | đã chốt D0 |
| 1 | 1 | Yêu cầu dữ liệu | Cao | vitest + `data-rights.mjs` |
| 1 | 2 | BUG-01 Bếp | Cao | vitest `board.test.ts` + typecheck:admin |
| 1 | 3 | BUG-02 Tổng chi | Cao | vitest `stats.test.ts` + `customers.mjs` |
| 1 | 4 | BUG-06 Chốt tiền | TB | `cash-closing.mjs` |
| 2 | 6 (làm **trước** 5) | BUG-04 Test registry | TB | vitest `registry.test.ts` |
| 2 | 5 (làm **sau** 6) | BUG-03 Proxy | TB | vitest + `review-otp-race.mjs`, `review-round3.mjs` |
| 2 | 7 | BUG-05 Seed UAT | TB | chạy seed |
| 3 | 8 | BUG-07, BUG-13 | TB | typecheck:admin + user UAT |
| 4 | 10 | BUG-08 lỗi form | Thấp | typecheck:admin |
| 4 | 11 | BUG-09, 11, 12 | Thấp | typecheck:admin |
| 4 | 12 | BUG-10 OpenAPI | Thấp | `node scripts/ordering/openapi.mjs` |
| 5 | 13 | Docs + gate cuối nhóm A | — | lint, typecheck, vitest |
| 6 (nhóm B, sau cùng) | 9 | UX lộ nội bộ / key thô | — | typecheck:admin + `o3.test.ts` |

Gate chuẩn mỗi task (không chạy gì ngoài danh sách này): `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:admin`, `pnpm vitest run <file>`, `pnpm build:ordering` + `node scripts/ordering/<script>.mjs`.

Quy tắc commit: **không tự commit/push**. Mỗi task kết thúc bằng "dừng, báo file đã đổi + kết quả lệnh, chờ user cho commit". Khi user cho commit: fix nhỏ = một commit mỗi task (rồi push), migration `0014` = commit riêng. Message gợi ý ghi ở từng task.

---

## Implementation steps

### Task 0: Kiểm tra working tree (D0 đã chốt: không commit R1a)

**Files:** không sửa.

- [ ] **Step 1:** `git status --short` và lưu lại danh sách file đang thay đổi (đây là "đường nền"). Tiếp tục chỉ khi có `src/plugins/ordering/server/src/services/registry.ts` ở trạng thái `M` (R1a chưa commit); nếu đã sạch thì R1a đã được commit — vẫn làm tiếp nhưng ghi lại.
- [ ] **Step 2:** `pnpm vitest run src/plugins/ordering/server/src/services/registry.test.ts` — phải thấy đúng 6 fail `Cannot destructure property 'strapi' of 'undefined'` (đường nền BUG-04).
- [ ] **Step 3:** Ghi đường nền vào Completion record. Sau mỗi task, `git status --short` chỉ được thêm các file ghi trong task đó.

---

### Task 1: Yêu cầu dữ liệu — xóa phải xác nhận (Cao)

**Files:**
- Modify: `src/plugins/ordering/server/src/services/data-rights.ts:626-635` (`createStaffRequest`)
- Modify: `src/plugins/ordering/admin/src/pages/DataRequests/index.tsx:84,134-152,333-375`
- Modify: bản dịch chứa `dataRequests.create.*` (định vị: `rg -n "dataRequests.create.confirm" src/plugins/ordering/admin/src/translations`)
- Modify: mọi chỗ khác POST `kind: 'erase'` lên `/ordering/data-requests` (định vị bước 4)
- Test: `scripts/ordering/data-rights.mjs`, `scripts/ordering/admin-customers.mjs`

**Interfaces:**
- Produces: `POST /ordering/data-requests` với `kind:'erase'` **bắt buộc** `confirm: true`, thiếu thì `400 VALIDATION_ERROR`, `details.field = 'confirm'`.

- [ ] **Step 1: Viết test đỏ** — trong `scripts/ordering/data-rights.mjs`, ngay sau block "Self erase" (khoảng dòng 255), thêm: gọi staff `POST /data-requests {phone, kind:'erase'}` **không** `confirm` → `assert.equal(res.status, 400)`, `res.body.error.details.field === 'confirm'`, và khách vẫn `status !== 'erased'`. Tìm helper gọi staff bằng `rg -n "'/data-requests'" scripts/ordering/data-rights.mjs`.
- [ ] **Step 2: Chạy, thấy đỏ:** `pnpm build:ordering; node scripts/ordering/data-rights.mjs` → fail (hiện trả 200 và khách bị xóa).
- [ ] **Step 3: Sửa server** — trong `createStaffRequest`, ngay sau khối kiểm `kind`:

```ts
      if (input.kind === 'erase' && input.confirm !== true) {
        throw new OrderingError('VALIDATION_ERROR', 'confirm:true is required to erase data', {
          details: { field: 'confirm' },
        });
      }
```

  và thêm `confirm?: unknown` vào kiểu `input` của hàm (cùng chỗ với `phone`, `customerId`, `kind`, `note`).
- [ ] **Step 4: Cập nhật mọi caller cũ** — tìm theo **endpoint** chứ không theo chuỗi `'erase'` (có chỗ truyền `kind` qua biến): `rg -n "data-requests['\`?]|createStaffRequest\(" scripts/ordering src/plugins/ordering/admin`. Đã biết: `Customers/CustomerDetailPage.tsx:192` (`{ customerId: id, kind: 'erase' }` — nút này có dialog xác nhận riêng `eraseOpen`, chỉ cần thêm `confirm: true`), `admin-customers.mjs:244,260,272`, `data-rights.mjs:209,361`. Với từng chỗ: nếu là ca erase **thành công** thì thêm `confirm: true`; nếu là ca kiểm quyền bị từ chối (`:209`, `:272`) thì giữ nguyên nhưng chắc rằng quyền vẫn bị chặn **trước** kiểm `confirm`. Kiểm `uat-server.mjs` và `data-request-overdue.mjs` cùng lệnh `rg` — nếu seed tạo yêu cầu xóa của staff thì cũng phải thêm `confirm: true` (nếu không seed UAT lại vỡ, đúng kiểu BUG-05).
- [ ] **Step 5: UI** — trong `DataRequests/index.tsx`:
  - đổi mặc định: `useState<'erase' | 'export'>('export')` (dòng 84);
  - thêm `const [confirmingErase, setConfirmingErase] = useState(false);`;
  - `create()` gửi `...(newKind === 'erase' ? { confirm: true } : {})`; sau khi xong/đóng dialog đặt lại `setConfirmingErase(false)` và `setNewKind('export')`;
  - nút chính trong `Dialog.Footer`. **Lưu ý:** nút nằm trong `Dialog.Action` (Radix AlertDialog, `@strapi/design-system` 2.2.3) và `Dialog.Action` tự đóng dialog khi bấm. Lần bấm đầu (chỉ để sang bước cảnh báo) **phải** `event.preventDefault()` — Radix bỏ qua việc đóng khi sự kiện đã `defaultPrevented`; nếu không, dialog đóng ngay và bước cảnh báo không bao giờ hiện. Lần bấm thứ hai (thực thi) giữ hành vi cũ:

```tsx
<Button
  variant={newKind === 'erase' && confirmingErase ? 'danger' : 'default'}
  disabled={newPhone.trim() === ''}
  loading={busy}
  onClick={(event: React.MouseEvent) => {
    if (newKind === 'erase' && !confirmingErase) {
      event.preventDefault();
      setConfirmingErase(true);
    } else {
      void create();
    }
  }}
>
  {newKind === 'erase' && confirmingErase
    ? t('dataRequests.create.eraseConfirm')
    : t('dataRequests.create.confirm')}
</Button>
```

  - khi `confirmingErase`: thay thân dialog bằng `<Alert variant="danger" …>{t('dataRequests.create.eraseWarning')}</Alert>` + nút "Quay lại" (`t('dataRequests.create.back')`, `setConfirmingErase(false)`); đổi `onChange` của select kind để `setConfirmingErase(false)`.
  - thêm 3 khóa (định dạng `[vi, en]` như file bản dịch hiện có):

```ts
'dataRequests.create.eraseWarning': ['Xóa dữ liệu cá nhân của khách này ngay lập tức, không thể hoàn tác. Các đơn cũ được ẩn danh.', 'This erases the customer’s personal data immediately and cannot be undone. Past orders are anonymized.'],
'dataRequests.create.eraseConfirm': ['Xóa vĩnh viễn', 'Erase permanently'],
'dataRequests.create.back': ['Quay lại', 'Back'],
```
- [ ] **Step 6: Chạy xanh:** `pnpm typecheck; pnpm typecheck:admin; pnpm build:ordering; node scripts/ordering/data-rights.mjs; node scripts/ordering/admin-customers.mjs` → pass.
- [ ] **Step 7: User UAT (không AI):** Yêu cầu dữ liệu → "Tạo yêu cầu": mặc định "Xuất", chọn "Xóa" → bấm nút ra màn cảnh báo đỏ → "Quay lại" hoạt động; chỉ "Xóa vĩnh viễn" mới thực thi.
- [ ] **Step 8: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): staff data-request erase requires explicit confirmation`.

---

### Task 2: BUG-01 — Bếp không hiện đơn (Cao)

**Files:**
- Create: `src/plugins/ordering/admin/src/pages/Kitchen/board.ts`
- Create (test): `src/plugins/ordering/admin/src/pages/Kitchen/board.test.ts` (vitest đã gom `src/**/*.test.ts`)
- Modify: `src/plugins/ordering/admin/src/pages/Kitchen/index.tsx:130-141`

**Interfaces:**
- Produces: `boardFrom<T extends { orders: unknown[] }>(body: unknown): T | null` — đọc đúng envelope `{ item: board }`.

- [ ] **Step 1: Test đỏ** (`board.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { boardFrom } from './board';

describe('boardFrom', () => {
  it('unwraps the { item } envelope the kitchen route answers with', () => {
    expect(boardFrom({ item: { orders: [{ id: 1 }] } })).toEqual({ orders: [{ id: 1 }] });
  });
  it('rejects the flat shape so contract drift fails loudly instead of showing an empty board', () => {
    expect(boardFrom({ orders: [{ id: 1 }] })).toBeNull();
  });
  it('rejects null and non-array orders', () => {
    expect(boardFrom(null)).toBeNull();
    expect(boardFrom({ item: { orders: 'x' } })).toBeNull();
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/plugins/ordering/admin/src/pages/Kitchen/board.test.ts` → FAIL (không có module `./board`).
- [ ] **Step 3: Implement** `board.ts`:

```ts
/** `GET /ordering/kitchen` answers `{ item: board }` (controllers/kitchen.ts). */
export const boardFrom = <T extends { orders: unknown[] }>(body: unknown): T | null => {
  const item = (body as { item?: { orders?: unknown } } | null)?.item;
  return item && Array.isArray(item.orders) ? (item as T) : null;
};
```

- [ ] **Step 4: Dùng trong `load`** (`Kitchen/index.tsx:135-137`):

```tsx
      const { data } = await get(`/ordering/kitchen?${qs}`);
      const next = boardFrom<KitchenBoard>(data);
      if (!next) throw new Error('unexpected kitchen board payload');
      setBoard(next);
      setFailed(false);
```

  (thêm `import { boardFrom } from './board';`; lỗi rơi vào `catch` → `setFailed(true)` như cũ, không còn bảng trống im lặng).
- [ ] **Step 5: Sweep anh em** — với từng trang đọc **một đối tượng** từ `get(...)` (`Branches/DeliveryTab.tsx:266`, `GiftCards/CardDetail.tsx:95`, `Loyalty/CustomerLoyalty.tsx:72,93`, `NotificationLog/index.tsx:156,166`, `AuditLog/index.tsx:175`, `Customers/CustomerDetailPage.tsx:160`, `Alerts/index.tsx:78`), mở controller tương ứng và so `ctx.body = …`. Ghi bảng "trang → envelope server → đọc đúng/sai" vào Completion record; chỉ sửa chỗ sai. (E2E báo các trang này chạy được, nên kỳ vọng không có.)
- [ ] **Step 6: Chạy xanh:** `pnpm vitest run src/plugins/ordering/admin/src/pages/Kitchen/board.test.ts; pnpm typecheck:admin; pnpm lint`.
- [ ] **Step 7: User UAT:** mở Bếp, nhập Q1 → thấy đơn ở các cột (trước đó `GET /ordering/kitchen?branch=Q1` trả 10 đơn).
- [ ] **Step 8: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): kitchen board reads the { item } envelope`.

---

### Task 3: BUG-02 — Tổng chi bị cộng chuỗi (Cao) + tính lại dữ liệu

**Files:**
- Create: `src/plugins/ordering/server/src/domain/customers/stats.ts`, `stats.test.ts`
- Modify: `src/plugins/ordering/server/src/services/customer.ts:359,374-388`
- Modify: `src/plugins/ordering/server/src/services/customer-group.ts:338-349` (đồng bộ công thức cho rule `sinceDays`)
- Create: `src/plugins/ordering/server/src/migrations/0014-o11-customer-stats-recompute.ts`
- Modify: `src/plugins/ordering/server/src/migrations/index.ts` (đăng ký sau `o16LoyaltyMigration`)
- Modify: `scripts/ordering/schema.mjs:226-241` (danh sách tên migration phải có trong sổ — thêm `'0014-o11-customer-stats-recompute'`)
- Test: `scripts/ordering/customers.mjs` (mở rộng cuối file)

**Interfaces:**
- Produces: `spentOf(orders: readonly { totalAmount: string | number | null; canceledAmount?: string | number | null }[]): number` — tổng phải thu, ép `Number` từng cột, dùng `payableTotal`.

- [ ] **Step 1: Test đỏ** (`stats.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { spentOf } from './stats';

describe('spentOf', () => {
  it('adds bigint strings as numbers, not as text', () => {
    expect(spentOf([{ totalAmount: '45000' }, { totalAmount: '30000' }])).toBe(75000);
  });
  it('nets line cancels and tolerates null / missing canceledAmount', () => {
    expect(
      spentOf([
        { totalAmount: '100000', canceledAmount: '25000' },
        { totalAmount: 30000, canceledAmount: null },
      ]),
    ).toBe(105000);
  });
  it('never goes negative for an over-cancelled order', () => {
    expect(spentOf([{ totalAmount: 10000, canceledAmount: 20000 }])).toBe(0);
  });
  it('is zero for no orders', () => {
    expect(spentOf([])).toBe(0);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/plugins/ordering/server/src/domain/customers/stats.test.ts` → FAIL (thiếu module).
- [ ] **Step 3: Implement** `stats.ts`:

```ts
import { payableTotal } from '../payable';

export type OrderAmounts = {
  totalAmount: string | number | null;
  canceledAmount?: string | number | null;
};

/**
 * Σ amount owed over the given orders. `biginteger` columns reach JS as strings, so each is coerced
 * before adding — `0 + "45000" + "30000"` is the string "04500030000", which BUG-02 stored.
 */
export const spentOf = (orders: readonly OrderAmounts[]): number =>
  orders.reduce(
    (sum, order) =>
      sum +
      payableTotal({
        totalAmount: Number(order.totalAmount ?? 0),
        canceledAmount: Number(order.canceledAmount ?? 0),
      }),
    0,
  );
```

- [ ] **Step 4: Chạy xanh** vitest bước 2.
- [ ] **Step 5: Dùng trong `refreshStats`** (`customer.ts`): thêm `import { spentOf } from '../domain/customers/stats';`, đổi truy vấn và tổng:

```ts
      const linked = (await orders().findMany({
        where: { customer: customerId, status: 'completed' },
        select: ['totalAmount', 'canceledAmount', 'placedAt'],
        orderBy: { placedAt: 'desc' },
      })) as { totalAmount: string | number; canceledAmount: string | number | null; placedAt: string }[];
      await customers().update({
        where: { id: customerId },
        data: {
          orderCount: linked.length,
          totalSpent: spentOf(linked),
          lastOrderAt: linked[0]?.placedAt ?? null,
        },
      });
```

  và sửa comment dòng 359: "same math as migration 0007's backfill, net of line cancels since 0014".
- [ ] **Step 6: Đồng bộ rule `sinceDays`** (`customer-group.ts:341`): đổi `COALESCE(SUM(o.total_amount), 0)::bigint AS spent` thành `COALESCE(SUM(GREATEST(0, o.total_amount - COALESCE(o.canceled_amount, 0))), 0)::bigint AS spent`. (Nhánh này đã `Number(row.spent)` nên không dính lỗi chuỗi; chỉ thống nhất công thức. Nếu user bác D2 thì bỏ bước này và phần trừ `canceledAmount` ở bước 3/5.)
- [ ] **Step 7: Migration tính lại** — `0014-o11-customer-stats-recompute.ts`:

```ts
import type { OrderingMigration } from './runner';

const CUSTOMER = 'plugins_ordering_customer';
const ORDER = 'plugins_ordering_order';
const LINK = 'plugins_ordering_order_customer_lnk';

/**
 * BUG-02: `refreshStats` once added bigint strings, so `total_spent` holds concatenated digits.
 * Recomputes the stats of every customer that has completed orders, net of line cancels
 * (`payableTotal`). Idempotent — the values are recomputed, not incremented. 0007 stays untouched.
 */
export const o11CustomerStatsRecomputeMigration: OrderingMigration = {
  name: '0014-o11-customer-stats-recompute',
  async up(trx) {
    await trx.raw(
      `UPDATE ${CUSTOMER} c SET
         order_count = s.n,
         total_spent = s.total,
         last_order_at = s.last_at
       FROM (
         SELECT l.customer_id,
                COUNT(*) AS n,
                COALESCE(SUM(GREATEST(0, o.total_amount - COALESCE(o.canceled_amount, 0))), 0)::bigint AS total,
                MAX(o.placed_at) AS last_at
         FROM ${LINK} l
         JOIN ${ORDER} o ON o.id = l.order_id
         WHERE o.status = 'completed'
         GROUP BY l.customer_id
       ) s
       WHERE c.id = s.customer_id AND c.status <> 'erased'`,
    );
  },
};
```

  Đăng ký trong `migrations/index.ts`: import `o11CustomerStatsRecomputeMigration` và thêm vào cuối mảng sau `o16LoyaltyMigration`.
- [ ] **Step 8: Test tích hợp đỏ→xanh** — cuối `scripts/ordering/customers.mjs`, ngay trước `console.log('[ordering-test] order.transitioned → completed refreshes customer stats')`: tạo đơn thứ hai cho khách A **đúng cách `bySession` được tạo** (`rg -n "const bySession" scripts/ordering/customers.mjs`, copy lời gọi, đặt tên `bySession2`), đánh dấu `completed` + enqueue `order.transitioned` + `runOutboxDispatcher` y như đoạn hiện có. **Bắt buộc đơn mới có `idempotencyKey` riêng** (`randomUUID()`); nếu lời gọi `bySession` mang key/header cố định thì copy nguyên văn sẽ trả về chính đơn cũ, `orderCount` vẫn là 1 và test chẳng chứng minh gì. Kèm `assert.notEqual(bySession2.order.order.id, statOrder.id)`. Rồi:

```js
  const totalOf = async (id) =>
    Number((await app.db.query('plugin::ordering.order').findOne({ where: { id } })).totalAmount);
  const afterTwo = await app.db.query('plugin::ordering.customer').findOne({ where: { id: aInternal } });
  assert.equal(afterTwo.orderCount, 2);
  assert.equal(
    Number(afterTwo.totalSpent),
    (await totalOf(statOrder.id)) + (await totalOf(bySession2.order.order.id)),
    'two completed orders must add as numbers, not concatenate as strings (BUG-02)',
  );
```

  Viết đoạn test này **trước Step 5** và chạy `pnpm build:ordering; node scripts/ordering/customers.mjs` → đỏ (`totalSpent` là số nối chuỗi, không bằng tổng hai đơn). Sau Step 5 chạy lại cùng lệnh → xanh.
- [ ] **Step 9: Sweep `reduce`** — kiểm từng dòng ở "Current evidence" (`carrier-assignment.ts:438`, `payment-matching.ts:327,520,695,789,796,834,884`, `order-edit.ts:554,574`, `order.ts:1072`): nguồn của số hạng là cột `biginteger` qua `db.query` **không** qua `amountFromDb`/`int`/`Number`? Ghi kết quả; sửa chỗ sai bằng cùng cách (ép `Number` ở nguồn) kèm test.
- [ ] **Step 10 (do user chạy, tùy chọn — DB UAT nằm trên máy tester/user, `registry-boot.mjs` và `schema.mjs` chỉ boot DB riêng của chúng nên không chứng minh được dữ liệu cũ đã lành; hai script đó chỉ xác nhận migration `0014` được ghi vào sổ):** trước khi chạy: `SELECT id, total_spent FROM plugins_ordering_customer WHERE total_spent > 100000000 ORDER BY total_spent DESC LIMIT 5;` (khách thử nghiệm đang hiện 4.500.030.000đ). Chạy `pnpm build:ordering; node scripts/ordering/registry-boot.mjs; node scripts/ordering/schema.mjs` rồi khởi động server UAT; chạy lại câu SQL → rỗng, và trang Khách hàng hiện số đúng.
- [ ] **Step 11: Gate:** `pnpm lint; pnpm typecheck`.
- [ ] **Step 12: Dừng — chờ user cho commit.** Hai commit: (1) `fix(ordering): customer totalSpent adds bigint amounts as numbers and nets cancels`; (2) `fix(ordering): recompute customer stats (migration 0014)` — migration một commit riêng.

---

### Task 4: BUG-06 — Chênh lệch chốt tiền không cập nhật

**Files:**
- Modify: `src/plugins/ordering/server/src/services/cash-closing.ts:49-59,290-316`
- Modify: `src/plugins/ordering/server/src/openapi/operations.ts` (schema `ClosingSnapshot` nếu có; định vị `rg -n "differenceAmount" src/plugins/ordering/server/src/openapi`)
- Modify: `src/plugins/ordering/admin/src/pages/CashClosing/index.tsx:43,333-335`
- Modify: bản dịch `cashClosing.*` (định vị `rg -n "cashClosing\.col" src/plugins/ordering/admin/src/translations`)
- Test: `scripts/ordering/cash-closing.mjs`

**Interfaces:**
- Produces: `ClosingSnapshot.liveDifferenceAmount: number` = `countedAmount − expectedAmount hiện tại`; `differenceAmount` giữ nguyên là số đã đóng băng lúc chốt.

- [ ] **Step 1: Test đỏ** — trong `scripts/ordering/cash-closing.mjs`, thêm **cuối thân `try`** (sau section cuối, trước `finally`), dùng helper sẵn có `orderInput`, `move`, `handover`, `summary`, `rowOf`:

```js
    // ── late cash after a close: the snapshot stays frozen, the live difference moves ──
    const lateId = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }]),
      systemCtx,
    )).order.order.id;
    await move(ops.as.quanly, lateId, 'preparing');
    await move(ops.as.quanly, lateId, 'ready');
    const beforeLate = rowOf((await summary(ops.as.quanly, 'Q1', today)).body, quanlyRef);
    assert.ok(beforeLate.closing, 'quanly must still hold a current closing here');
    await handover(ops.as.quanly, lateId);
    const afterLate = rowOf((await summary(ops.as.quanly, 'Q1', today)).body, quanlyRef);
    const added = afterLate.expectedAmount - beforeLate.expectedAmount;
    assert.ok(added > 0, 'late cash raises the expected amount');
    assert.equal(afterLate.closing.differenceAmount, beforeLate.closing.differenceAmount, 'frozen snapshot unchanged');
    assert.equal(
      afterLate.closing.liveDifferenceAmount,
      beforeLate.closing.liveDifferenceAmount - added,
      'live difference follows the ledger (BUG-06)',
    );
    console.log('[ordering-test] late cash after close moves liveDifferenceAmount, not the frozen difference');
```

  Nếu `quanly` không còn closing `current` ở cuối script (do section `adjust`), dùng cặp (collector, closing) vẫn `current` — assert ở dòng `assert.ok(beforeLate.closing…)` sẽ báo rõ.
- [ ] **Step 2:** `pnpm build:ordering; node scripts/ordering/cash-closing.mjs` → FAIL (`liveDifferenceAmount` undefined).
- [ ] **Step 3: Server** — thêm trường và truyền số kỳ vọng hiện tại:

```ts
export type ClosingSnapshot = {
  id: number;
  countedAmount: number;
  /** Frozen when the closing was written (audit); never changes. */
  differenceAmount: number;
  /** `countedAmount − expected now`; moves when cash is posted after the close. */
  liveDifferenceAmount: number;
  // …phần còn lại giữ nguyên
};

const snapshot = (
  row: CashClosingRow,
  names: Map<string, string | null>,
  expectedNow: number,
): ClosingSnapshot => ({
  id: row.id,
  countedAmount: int(row.countedAmount),
  differenceAmount: int(row.differenceAmount),
  liveDifferenceAmount: int(row.countedAmount) - expectedNow,
  note: row.note,
  // …giữ nguyên
});
```

  và trong `collectorRow` (`:303-316`): `closing: closing ? snapshot(closing, names, bucket.systemAmount - bucket.refundAmount) : null`.
- [ ] **Step 4: UI** — thêm `liveDifferenceAmount: number` vào kiểu ở `CashClosing/index.tsx:43`; cột "Chênh lệch" hiện `row.closing.liveDifferenceAmount` (màu `danger600` khi khác 0); nếu `liveDifferenceAmount !== differenceAmount` thêm dòng phụ nhỏ `t('cashClosing.postedAfterClose', { at: formatMoney(row.closing.differenceAmount) })`. Khóa dịch: `['Lúc chốt: {at}. Có tiền mặt phát sinh sau khi chốt.', 'At close: {at}. Cash was posted after closing.']`.
- [ ] **Step 5: OpenAPI** — cập nhật schema nếu có; sau đó `pnpm ordering:openapi` (ghi lại `docs/ordering-admin-openapi.json`) và `node scripts/ordering/openapi.mjs` phải pass.
- [ ] **Step 6: Chạy xanh:** `pnpm build:ordering; node scripts/ordering/cash-closing.mjs; pnpm typecheck; pnpm typecheck:admin; pnpm lint`.
- [ ] **Step 7: User UAT:** chốt một người thu → người đó thu thêm tiền mặt → bảng Chốt tiền mặt hiện chênh lệch âm đúng (ví dụ lan-q1: phải có 863.000đ, đếm 789.000đ → hiện −74.000đ) và dòng "Lúc chốt: 0đ".
- [ ] **Step 8: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): cash closing shows live difference after late cash`.
- [ ] **Ghi chú D4:** không sửa `adjust` ở task này; xem mục Risks.

---

### Task 5: BUG-03 — Proxy gửi thông báo đệ quy vô hạn

**Files:**
- Modify: `src/plugins/ordering/server/src/services/registry.ts:127-157`
- Test: `src/plugins/ordering/server/src/services/registry.test.ts` (thêm case)
- Chạy lại: `scripts/ordering/review-otp-race.mjs`, `scripts/ordering/review-round3.mjs`, `scripts/ordering/notify-guard.mjs`

**Interfaces:**
- Consumes: `createRegistry({ strapi })` (đã có), `NotificationProvider.send({ recipient, template, data })`.
- Produces: hành vi `notificationProvider(channel).send` — hàm `send` thật được đọc **lúc trap `get` chạy**, không phải lúc closure được gọi; gán `capture.send = wrapper` vẫn tác động lên provider để service thấy.

**Vì sao:** closure cũ gọi `target.send(input)` lúc gọi. Test gán `capture.send = patched` (ghi xuống `target`) với `patched` gọi `originalSend` (chính là closure) → closure gọi `target.send` = `patched` → vô hạn. Không đóng băng `send` lúc đăng ký (như vậy bản vá của test không bao giờ tới service và `sent.promise` treo).

- [ ] **Step 0: Làm Task 6 trước** (để 6 test cũ xanh, case mới đỏ không bị chìm giữa 6 lỗi cũ).
- [ ] **Step 1: Test đỏ** — thêm vào `registry.test.ts` (dùng helper `newRegistry` của Task 6 cho các test cũ; hai case dưới dựng registry với `strapiWith(...)`):

```ts
const strapiWith = (mode: 'live' | 'allowlist', allowlist: string[] = []) =>
  ({ config: { get: () => ({ notifications: { mode, allowlist } }) } }) as unknown as Core.Strapi;

describe('notification provider guard proxy', () => {
  it('lets a caller wrap send through the proxy without recursing', async () => {
    const calls: string[] = [];
    const provider = {
      sent: [] as unknown[],
      async send() {
        calls.push('real');
      },
    };
    const registry = createRegistry({ strapi: strapiWith('live') });
    registry.registerNotificationProvider('email', provider as never);

    const capture = registry.notificationProvider('email');
    const originalSend = capture.send;
    capture.send = async function (this: unknown, ...args: Parameters<typeof originalSend>) {
      calls.push('wrapped');
      return originalSend.apply(this, args);
    };
    await registry.notificationProvider('email').send({ recipient: { email: 'a@b.co' }, template: 't', data: {} });
    expect(calls).toEqual(['wrapped', 'real']);

    capture.send = originalSend;
    await registry.notificationProvider('email').send({ recipient: { email: 'a@b.co' }, template: 't', data: {} });
    expect(calls).toEqual(['wrapped', 'real', 'real']);
  });

  it('still blocks a recipient outside the allowlist', async () => {
    const registry = createRegistry({ strapi: strapiWith('allowlist', ['ok@b.co']) });
    registry.registerNotificationProvider('email', { async send() {} } as never);
    await expect(
      registry.notificationProvider('email').send({ recipient: { email: 'no@b.co' }, template: 't', data: {} }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_BLOCKED' });
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/plugins/ordering/server/src/services/registry.test.ts -t "guard proxy"` → case 1 FAIL (`RangeError: Maximum call stack size exceeded`); case 2 xanh.
- [ ] **Step 3: Sửa** (`registry.ts`, trap `get`):

```ts
      return new Proxy(provider, {
        get(target, property, receiver) {
          if (property === 'send') {
            // Resolve the real `send` now, not when the closure runs: a caller that wraps
            // `proxy.send = patched` (the OTP race test) lands on `target`, and a closure that
            // re-read `target.send` per call would re-enter itself through `patched`.
            const inner = Reflect.get(target, 'send', target) as NotificationProvider['send'];
            return async (input: Parameters<NotificationProvider['send']>[0]) => {
              const value = String(input?.recipient?.email ?? input?.recipient?.phone ?? '');
              if (!guard().allows(channel, value)) {
                throw new OrderingError('NOTIFICATION_BLOCKED', 'recipient is not on the allowlist', {
                  details: { channel },
                });
              }
              return inner.call(target, input);
            };
          }
          return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver) {
          return Reflect.set(target, property, value, receiver);
        },
      });
```

- [ ] **Step 4: Chạy xanh:** vitest bước 2 → 2 case pass.
- [ ] **Step 5: Kịch bản thật (phải build lại vì script chạy `dist`):** `pnpm build:ordering; node scripts/ordering/review-otp-race.mjs; node scripts/ordering/review-round3.mjs; node scripts/ordering/notify-guard.mjs` → cả ba pass, `review-round3` không còn timeout 300 giây.
- [ ] **Step 6: Gate:** `pnpm lint; pnpm typecheck`.
- [ ] **Step 7: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): notification guard proxy no longer recurses when send is wrapped`.

---

### Task 6: BUG-04 — `registry.test.ts` lỗi thời

**Files:**
- Modify: `src/plugins/ordering/server/src/services/registry.test.ts:19,31,45,55,78,94`

- [ ] **Step 1: Thấy đỏ:** `pnpm vitest run src/plugins/ordering/server/src/services/registry.test.ts` → 6 fail `Cannot destructure property 'strapi' of 'undefined'`.
- [ ] **Step 2: Sửa** — thêm sau `validConfig` (cùng kiểu với dòng 80 đang dùng `undefined as unknown as Core.Strapi`; registry chỉ đụng `strapi` lười, bên trong `send`):

```ts
const newRegistry = () => createRegistry({ strapi: undefined as unknown as Core.Strapi });
```

  rồi thay 6 lần `createRegistry()` bằng `newRegistry()`.
- [ ] **Step 3: Xanh:** cùng lệnh bước 1 → toàn file pass (gồm 2 case của Task 5 nếu đã làm). Làm Task 5 và 6 chung một lần commit nếu muốn, nhưng giữ hai message.
- [ ] **Step 4: Gate đầy đủ vitest:** `pnpm vitest run` → mục tiêu 1536/1536 (báo cáo: 1530/1536, 6 fail đều ở file này).
- [ ] **Step 5: Dừng — chờ user cho commit.** Gợi ý: `test(ordering): registry tests pass the strapi argument`.

---

### Task 7: BUG-05 — Seed UAT crash `ITEM_SOLD_OUT`

**Files:**
- Modify: `scripts/ordering/uat-server.mjs:483-494` (giới hạn + comment) hoặc `:593` (đơn dine-in) theo D3

- [ ] **Step 1: Đọc header** `uat-server.mjs` (30 dòng đầu) để biết biến môi trường/DB cần có, và `rg -n "dailyLimit|bunBo" scripts/ordering/uat-server.mjs` để chắc chỉ có hai chỗ trên dùng suất bún bò có giới hạn.
- [ ] **Step 1b: Kiểm ngưỡng "gần hết" thật** — `rg -n "80|nearLimit|remaining|percent" src/plugins/ordering/admin/src/pages/Availability/index.tsx src/plugins/ordering/server/src/services/catalog-availability.ts`; xác nhận ngưỡng mà thanh Tạm hết dùng. Nếu ngưỡng khác 80%, chọn giới hạn sao cho 4/N và 6/N đều nằm đúng trạng thái mong muốn (hoặc chuyển sang phương án giảm đơn dine-in còn 1 suất).
- [ ] **Step 2: Sửa theo D3 (phương án khuyến nghị):** đổi `dailyLimit: 5` → `dailyLimit: 7` và sửa comment dòng 483-485 thành: "…hai đơn bên dưới mỗi đơn lấy 2 suất bún bò (4/7); đơn dine-in O12 lấy thêm 2 (6/7, vẫn ≥ 80% nên thanh Tạm hết còn cảnh báo). Đặt giới hạn trước các đơn O6 sẽ làm chúng bị từ chối."
- [ ] **Step 3: Kiểm chứng:** chạy seed trên DB trống theo header → không còn `ITEM_SOLD_OUT`; mở trang Tạm hết món Q1 xem bún bò hiện 6/7 (user xác nhận bằng mắt; AI chỉ cần seed chạy hết và `[ordering-uat] O12: tables B1/B2 seeded…` được in ra).
- [ ] **Step 4:** `pnpm lint`.
- [ ] **Step 5: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): UAT seed daily cap leaves room for the dine-in order`.

---

### Task 8: BUG-07 (menu/trang thiếu quyền) và BUG-13 (route không tồn tại)

**Đã xác nhận bằng đọc code (không cần đoán):**

1. **Menu Bếp lệch quyền server.** `admin/src/lib/permissions.ts:84-85` `RBAC_KITCHEN = [kitchen.read, order.process]` và `App.tsx`/`Kitchen/index.tsx:103` mở màn khi có **một** trong hai. Nhưng mọi route bếp (`server/src/routes/index.ts:245-249`: board, stream, prepared, start, complete) chỉ cần `kitchen.read`. Người giao hàng (giao-q1: có `order.process`, không có `kitchen.read`) thấy mục "Bếp", mở được trang và trang báo lỗi tải (`failed`). Comment cũ "prepared/done buttons share order.process" đã lỗi thời.
2. **`Categories` và `Availability` không có chặn quyền nào** (không `Page.Protect`, không `useRBAC`; kiểm bằng `rg`). Gõ thẳng URL với vai trò thiếu quyền: API trả 403, `Categories` chỉ bật toast và hiện cây rỗng (đúng "trang gần trắng" lan-q1 mở Danh mục).
3. Các mục còn lại khớp quyền route: Bàn & QR/Tại bàn (`table.manage`), Danh mục/Nhập catalog (`catalog.manage`), Tạm hết món (`catalog.manage` hoặc `toggle-availability`), Thanh toán/Chốt tiền (`report.read`), v.v. `Kitchen`, `Tables`, `TableSessions` đã có Alert "Không có quyền" riêng. **Báo cáo nói giao-q1 mở Bàn & QR trắng: không giải thích được bằng code** — giao-q1 không có `table.manage` nên phải ra Alert; nếu user vẫn thấy trắng thì cần console + tab Network (xem Step 7).
4. `App.tsx:370-401`: không có `<Route path="*">`; route `index` trả `null` khi `first` rỗng.

**Files:**
- Modify: `src/plugins/ordering/admin/src/lib/permissions.ts:84-85`
- Create (test): `src/plugins/ordering/admin/src/lib/permissions.test.ts`
- Modify: `src/plugins/ordering/admin/src/pages/Categories/index.tsx` (đổi tên component + bọc `Page.Protect`)
- Modify: `src/plugins/ordering/admin/src/pages/Availability/index.tsx` (cùng cách)
- Modify: `src/plugins/ordering/admin/src/pages/App.tsx:2,370-401`
- Modify: `src/plugins/ordering/admin/src/translations/o3.ts:14-15` (thêm khóa `common.notFound.*`)

- [ ] **Step 1: Test đỏ** (`permissions.test.ts`; `permissions.ts` không import gì nên chạy được trong vitest node):

```ts
import { describe, expect, it } from 'vitest';

import { RBAC_KITCHEN } from './permissions';

describe('menu gates follow the server route permission', () => {
  it('kitchen: every /kitchen route needs kitchen.read, so order.process alone must not open the screen', () => {
    expect(RBAC_KITCHEN).toEqual([{ action: 'plugin::ordering.kitchen.read', subject: null }]);
  });
});
```

  Chạy `pnpm vitest run src/plugins/ordering/admin/src/lib/permissions.test.ts` → FAIL (mảng hiện có thêm `order.process`).
- [ ] **Step 2: Sửa gate bếp** (`permissions.ts`):

```ts
/** O12: the kitchen display and all its routes (board, stream, prepared, start, complete) sit behind `kitchen.read`. */
export const RBAC_KITCHEN = [...PERMISSIONS.kitchenRead];
```

  Chạy lại vitest → xanh. (Mảng `RBAC_ALL` ở dòng ~116 đang spread `...RBAC_KITCHEN`, không cần sửa.)
- [ ] **Step 3: `Categories` — chặn quyền và không gọi API khi thiếu quyền.** `Page.Protect` đặt **bên trong cùng component** sẽ vẫn để `useEffect(load)` chạy và bắn request 403, nên tách component:
  - thêm `Page` vào import: `import { Page, useFetchClient, useNotification } from '@strapi/strapi/admin';` và `import { RBAC_CATALOG_MANAGE } from '../../lib/permissions';`;
  - đổi `const CategoriesPage = () => {` thành `const CategoriesContent = () => {`;
  - thay dòng cuối `export default CategoriesPage;` bằng:

```tsx
const CategoriesPage = () => (
  <Page.Protect permissions={RBAC_CATALOG_MANAGE}>
    <CategoriesContent />
  </Page.Protect>
);

export default CategoriesPage;
```

- [ ] **Step 4: `Availability`** — làm y hệt Step 3 với quyền `RBAC_CATALOG_ACCESS` (đã export ở `permissions.ts:65`, đúng với gate menu `visible.availability`). Đọc dòng `export default` cuối file để lấy tên component thật.
- [ ] **Step 5: BUG-13 trong `App.tsx`** — thêm `Alert` vào import `@strapi/design-system` (dòng 2) và hai component trước `OrderingApp`:

```tsx
const NoAccess = () => {
  const t = useT();
  return (
    <Layouts.Content>
      <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
        {t('common.forbidden.body')}
      </Alert>
    </Layouts.Content>
  );
};

const NotFound = () => {
  const t = useT();
  return (
    <Layouts.Content>
      <Alert variant="warning" closeLabel={t('common.close')} title={t('common.notFound.title')}>
        {t('common.notFound.body')}
      </Alert>
    </Layouts.Content>
  );
};
```

  Route `index` (dòng 371): `<Route index element={first ? <Navigate to={first} replace /> : <NoAccess />} />`. Thêm **cuối** `<Routes>` (sau `ratings/*`, dòng ~400): `<Route path="*" element={<NotFound />} />`.
  Khóa dịch thêm vào `translations/o3.ts` ngay sau dòng 15 (`common.forbidden.title`):

```ts
  'common.notFound.body': ['Địa chỉ này không thuộc mục Bán hàng. Chọn một mục ở thanh bên.', 'This address is not part of Ordering. Pick an item in the side menu.'],
  'common.notFound.title': ['Không tìm thấy trang', 'Page not found'],
```

- [ ] **Step 6: Gate:** `pnpm typecheck:admin; pnpm lint; pnpm vitest run src/plugins/ordering/admin/src/lib/permissions.test.ts src/plugins/ordering/admin/src/translations/o3.test.ts`.
- [ ] **Step 7: User UAT:** (a) đăng nhập giao-q1: menu **không còn** "Bếp"; (b) lan-q1 mở `/admin/plugins/ordering/categories`: ra "Không có quyền", không có toast lỗi; (c) mở `/admin/plugins/ordering/settings`: ra "Không tìm thấy trang"; (d) nếu giao-q1 vẫn thấy trắng ở Bàn & QR: chụp console + tab Network (request nào, mã nào) rồi gửi lại — đừng sửa tiếp khi chưa có.
- [ ] **Step 8: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): kitchen menu follows kitchen.read; guard Categories/Availability; add not-found route`.

---
### Task 9: UX — lộ thông tin nội bộ, key/ID thô, trùng lặp (nhóm B, chỉ làm khi user nói)

Làm sau toàn bộ nhóm A (Task 1–8, 10–13). Sửa chủ yếu là chuỗi dịch ở `src/plugins/ordering/admin/src/translations/*.ts` (định dạng `[vi, en]`) và vài chỗ render. Mỗi dòng: tìm bằng khóa/`rg` đã ghi, sửa, giữ vi **và** en.

**Files:** theo bảng; test chung `src/plugins/ordering/admin/src/translations/o3.test.ts`.

| # | Màn | Vấn đề (báo cáo §3) | Định vị | Sửa |
|---|---|---|---|---|
| U01 | Chi tiết đơn | Lộ "Chuyển khoản tại quầy có ở O4" | `translations/o3.ts:166` `dialog.cash.transferLater`; `rg -n "transferLater" src/plugins/ordering/admin/src` | Bỏ dòng khỏi dialog (tính năng đã có) hoặc đổi: "Chuyển khoản: dùng nút Ghi nhận chuyển khoản." |
| U02 | Chi tiết đơn | Khối "Tiền" và "Thanh toán" lặp Đã thu/Đã hoàn/Còn thiếu | `rg -n "orders.detail.(money|payment)" …/pages/Orders` | Giữ một khối, khối kia chỉ hiện phần riêng (danh sách giao dịch) |
| U03 | Chi tiết đơn | SĐT đầy đủ +84… cạnh số che, trái trang Khách hàng ("SĐT luôn che") | `rg -n "contact.phone|\\+84" …/pages/Orders` | Chỉ hiện số che; "xem số" đi qua hành động có log như `CustomerDetailPage.tsx:149` |
| U04 | Chi tiết đơn | Chuyển khoản ghi tay mang nhãn "Chuyển khoản SePay" | `translations/o4.ts:88` `method.sepay` | Tách nhãn cho phương thức ghi tay ("Chuyển khoản (ghi tay)") — xác định mã phương thức thật bằng `rg -n "manual" src/plugins/ordering/server/src/providers` |
| U05 | Chi tiết đơn | Popup xem nhanh hiện mã đơn hai lần | `rg -n "quickView|QuickView" …/pages/Orders` | Bỏ một lần |
| U06 | Danh sách đơn | Bảng cắt bên phải ở laptop (cột Nguồn/Thao tác) | `…/pages/Orders` bảng | Bọc `Table` trong container `overflow-x: auto` hoặc ẩn cột Nguồn dưới 1280px |
| U07 | Bếp | Gõ tay mã chi nhánh | `Kitchen/index.tsx:117` `branchDraft` | Thay bằng `SingleSelect` lấy từ `/ordering/branches` (xem cách `Orders` lọc chi nhánh) |
| U08 | Webhook | Lộ key `WEBHOOK.GROUP.CUSTOMER`, tên sự kiện thô | `rg -n "WEBHOOK|group\\." …/pages/Webhooks`, `translations/o10.ts` | Thêm khóa dịch nhóm/sự kiện |
| U09 | Nhà cung cấp | Placeholder `<ORDERING_PUBLIC_API_URL>` | `Providers/index.tsx:167` | Khi `publicApiUrl` rỗng hiện cảnh báo `t('providers.publicUrlMissing')` thay vì ghép URL giả |
| U10 | Nhà cung cấp | Lộ đường dẫn `docs/providers/*.md`; tên biến môi trường dính nhau; URL tràn thẻ | `rg -n "docs/providers|env" …/pages/Providers`, `server/src/services/provider-status.ts` | Bỏ đường dẫn repo; render từng biến một dòng; `wordBreak: 'anywhere'` cho URL |
| U11 | Nhà cung cấp | Thẻ quà tặng ghi "CHƯA TRIỂN KHAI" dù chạy | `provider-status.ts` (đang sửa dở trong working tree) | Trạng thái theo thực tế đăng ký provider |
| U12 | Điểm & hạng | Lộ "(O14)", "Mã nhóm khách O14"; tiêu đề lặp hai lần | `translations/o16.ts:64,75`; `rg -n "loyalty.title" …/pages/Loyalty` | "Nhóm giá", "Mã nhóm khách (tùy chọn)"; bỏ một tiêu đề |
| U13 | Lịch sử thay đổi (AuditLog) | `customer #vo97mm95…`, `rows: 5`, `change: 10 · points: 10 → 20` | `…/pages/AuditLog/index.tsx`, `server/src/domain/audit` | Render câu tiếng Việt theo loại sự kiện; ID chỉ hiện trong chi tiết kỹ thuật |
| U14 | Cảnh báo | `cash-closing:1`, `order:14`, `provider:sepay`, `outbox` | `…/pages/Alerts/index.tsx`, `server/src/domain/alert-codes.ts` | Chuyển aggregateRef thành nhãn ("Chốt tiền #1", "Đơn SLC-000014") |
| U15 | Tình trạng vận hành | Chuỗi cron thô `*/10 * * * * *` | `…/pages/Ops` | Ẩn hoặc đổi thành "mỗi 10 giây" |
| U16 | Bảng giá | Điều kiện tiếng Anh thô ("pickup · staff", "mon · tue") | `…/pages/PriceLists/index.tsx` | Ánh xạ sang nhãn dịch (kênh, ngày) |
| U17 | Khuyến mãi | Nhóm khách gõ mã cách nhau dấu phẩy | `Promotions/PromotionEditor.tsx:105` | `MultiSelect` từ `/ordering/customer-groups` |
| U18 | Thẻ quà tặng | Popup phát thẻ lặp câu "Mã chỉ hiện một lần…" + hai nút Đóng; "NguồnTất cả" dính chữ | `translations/o9.ts:147`; `rg -n "oneTime|Nguồn" …/pages/GiftCards` | Bỏ lặp, một nút Đóng, thêm khoảng cách |
| U19 | Bàn & QR | "Sơ đồ bàn của Tất cả"; công tắc chữ "On"; bấm dòng không mở form sửa | `translations/o12.ts:140`; `Tables/index.tsx` | Khi không chọn chi nhánh dùng khóa riêng ("Sơ đồ bàn — tất cả chi nhánh"); nhãn công tắc dịch; gắn `onRowClick` mở form sửa |
| U20 | Tại bàn | Trạng thái "SERVED" tiếng Anh | `…/pages/TableSessions` | Dùng nhãn trạng thái đơn đã dịch |
| U21 | Chi nhánh | Thông báo "Đổi cài đặt chỉ áp dụng cho đơn mới" hiện hai lần | `translations/o3.ts:288` `branch.newOrdersOnly`; `rg -n "newOrdersOnly" …/pages/Branches` | Giữ một chỗ |
| U22 | Yêu cầu dữ liệu | Cột "Người xử lý" hiện `admin:13`; "Từ chối" vừa tab vừa nút | `DataRequests/index.tsx:240`, server `viewOfRequest` | Server trả `handledByName` (mẫu `adminNameMap` ở `cash-closing.ts:167`); đổi nhãn nút thành "Từ chối yêu cầu" |
| U23 | Nhân viên | Không có chỉ báo hoạt động/đã khóa | `…/pages/Staff` | Thêm cột trạng thái (Badge) từ `isActive` của user |
| U24 | Cài đặt bán hàng | Nhập sai chỉ có toast chung | `…/pages/Settings/index.tsx` | Dùng `fieldErrors(error)` (`lib/api.ts`) hiện lỗi dưới từng trường — cùng cơ chế với Task 10 |
| U25 | Toàn admin | Thiếu bản dịch menu lead-shortcuts | `rg -n "lead-shortcuts" src config` | Thêm bản dịch vi/en |

- [ ] **Step 1:** làm lần lượt U01→U25, mỗi nhóm cùng một file làm một lượt; sau mỗi lượt `pnpm typecheck:admin`.
- [ ] **Step 2:** cuối task: `pnpm lint; pnpm typecheck:admin; pnpm vitest run src/plugins/ordering/admin/src/translations/o3.test.ts`.
- [ ] **Step 3: User UAT** theo từng màn trong §3 báo cáo.
- [ ] **Step 4: Dừng — chờ user cho commit.** Gợi ý: một commit cho mỗi nhóm màn hình (đơn / nhà cung cấp / điểm & hạng / còn lại).

---

### Task 10: BUG-08 — Form không hiện lỗi cụ thể bằng tiếng Việt

**Đã xác nhận bằng đọc code:**
- Server dựng `details.issues[]` bằng `message` **tiếng Anh thô của zod** ở: `domain/loyalty/settings.ts:45-46` (cài đặt) và `:77-79` (hạng), `domain/catalog/price-list-input.ts:82-84` và `:163-165` (+ các `fail(path, 'choose at least one variant')` ở `:75,93-123`, `failGroup` `:173,178`), `domain/promotions/schema.ts:65-67`, `services/ordering-settings.ts:101`.
- Client: màn Hạng/Cài đặt điểm dùng `fieldErrors(error)` (`Loyalty/index.tsx:117,281`) nên in nguyên `message` tiếng Anh dưới trường ("Too small: expected number to be >=10", "lowercase letters, digits and dashes (2–40)"); màn Bảng giá chỉ dùng `useErrorToast` (`PriceLists/index.tsx:94-109,241`) và toast luôn lấy bản dịch cố định `error.PRICE_LIST_INVALID` ("Bảng giá chưa hợp lệ") đè lên chi tiết.
- Ghi chú liên quan: "hệ số điểm bằng 2" bị từ chối vì `multiplier` là số nguyên ×100 (`tierInputSchema`, `min(10).max(1000)`, 100 = ×1.0). Kiểm nhãn/gợi ý của ô này trong UI (`rg -n "multiplier" src/plugins/ordering/admin/src/pages/Loyalty/index.tsx`) có nói rõ đơn vị ×100 hay không; nếu không thì thêm vào nhãn.

**Thiết kế:** server giữ `message` (tương thích) và **thêm** `code` + cận (`min`/`max`); client tự dịch theo `path` + `code`, **không bao giờ in `message` tiếng Anh**.

**Files:**
- Create: `src/plugins/ordering/server/src/domain/validation-issue.ts`, `validation-issue.test.ts`
- Modify: `domain/loyalty/settings.ts:36-51,74-83`, `domain/catalog/price-list-input.ts:68-76,82-84,93-123,163-182`, `domain/promotions/schema.ts:65-67`, `services/ordering-settings.ts:101` (cùng thư mục gốc `src/plugins/ordering/server/src/`)
- Create: `src/plugins/ordering/admin/src/lib/validation.ts`, `validation.test.ts`
- Modify: `src/plugins/ordering/admin/src/lib/api.ts:20-31,34-46` (`fieldErrors`, `useErrorToast`)
- Modify: `src/plugins/ordering/admin/src/pages/Loyalty/index.tsx:117,281`, `pages/Loyalty/CustomerLoyalty.tsx:100`, `pages/Settings/index.tsx` (mọi `fieldErrors(error)`), `src/plugins/ordering/admin/src/translations/o3.ts`

- [ ] **Step 1: Test đỏ phía server** (`validation-issue.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { issueView } from './validation-issue';

describe('issueView', () => {
  it('keeps the zod code and numeric bounds next to the message', () => {
    expect(
      issueView({ code: 'too_small', path: ['multiplier'], message: 'Too small', minimum: 10 }, 'tier'),
    ).toEqual({ path: 'multiplier', message: 'Too small', code: 'too_small', min: 10 });
  });
  it('falls back to the given path and a generic code', () => {
    expect(issueView(undefined, 'tier')).toEqual({ path: 'tier', message: 'invalid', code: 'invalid' });
  });
  it('turns bigint bounds into numbers', () => {
    expect(issueView({ code: 'too_big', path: ['x'], message: 'm', maximum: 5n }, 'x')).toMatchObject({ max: 5 });
  });
});
```

  `pnpm vitest run src/plugins/ordering/server/src/domain/validation-issue.test.ts` → FAIL (thiếu module).
- [ ] **Step 2: Implement** `validation-issue.ts`:

```ts
/** Structural subset of a zod issue, so this helper does not depend on the zod version. */
export type RawIssue = {
  code?: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};

export type IssueView = { path: string; message: string; code: string; min?: number; max?: number };

/** One API issue: `code` and the bounds let the admin UI render its own translated text. */
export const issueView = (issue: RawIssue | undefined, fallbackPath: string): IssueView => ({
  path: issue?.path.map(String).join('.') || fallbackPath,
  message: issue?.message ?? 'invalid',
  code: issue?.code ?? 'invalid',
  ...(issue?.minimum !== undefined ? { min: Number(issue.minimum) } : {}),
  ...(issue?.maximum !== undefined ? { max: Number(issue.maximum) } : {}),
});
```

  Chạy lại → xanh.
- [ ] **Step 3: Dùng ở các điểm dựng issue.** Thay mỗi `{ path: issue?.path.join('.') || 'X', message: issue?.message ?? 'invalid' }` bằng `issueView(issue, 'X')` (import `issueView` từ `domain/validation-issue`):
  - `loyalty/settings.ts`: đổi `fail` nhận `IssueView`:

```ts
const fail = (issue: IssueView): never => {
  throw new OrderingError('VALIDATION_ERROR', 'loyalty settings are invalid', {
    details: { issues: [issue] },
  });
};
// parseLoyaltySettingsInput:
if (!parsed.success) return fail(issueView(parsed.error.issues[0], 'settings'));
if (new Set(data.channels).size !== data.channels.length) {
  fail({ path: 'channels', message: 'channels must be unique', code: 'not_unique' });
}
```

    và ở `parseTierInput`: `details: { issues: [issueView(parsed.error.issues[0], 'tier')] }`.
  - `price-list-input.ts`: `fail(path, message, code)` thêm tham số `code` đặt vào issue; gán mã cho từng lời gọi: `unique` → `not_unique`; `'a time range must not be empty'` → `empty_range`; `'invalid date'` → `invalid_date`; `'validTo must be after validFrom'` → `range_order`; `'choose at least one variant'` (path `lines`) → `no_variant`; `'too many price rows…'` → `too_many_rows`; `'an override list has no adjust'`/`'an adjust list needs a discount'` → `adjust_mismatch`; `'percent must be from 1 to 100'` (path `adjust.value`) → `too_big` kèm `max: 100`; `'choose at least one category or product'` (path `adjust.target.refs`) → `no_target`; `'an all-items discount has no refs'` → `refs_not_allowed`; `'an adjust list has no variant prices'` → `lines_not_allowed`. Hai chỗ `safeParse` (`:82-84`, `:163-165`) dùng `issueView`. `failGroup('auto', 'an automatic group needs a condition')` → `no_condition`.
  - `promotions/schema.ts:65-67` và `ordering-settings.ts:101` dùng `issueView` tương tự (ở `ordering-settings.ts` là `.map((issue) => issueView(issue, 'settings'))`).
  - Nếu `tsc` kêu kiểu zod không khớp `RawIssue` thì ép `issue as RawIssue` tại chỗ gọi, không đổi `RawIssue`.
- [ ] **Step 4: Test đỏ phía client** (`lib/validation.ts` là module thuần, không import React/Strapi để vitest chạy được). `validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { fieldErrorsOf, issueText } from './validation';

const dict: Record<string, string> = {
  'validation.invalid': 'Chưa hợp lệ',
  'validation.too_small': 'Tối thiểu {min}',
  'validation.multiplier.too_small': 'Hệ số từ {min} (100 = ×1.0)',
};
const t = (key: string, values?: Record<string, string | number>, fallback?: string) => {
  const raw = dict[key];
  return raw ? raw.replace('{min}', String(values?.min ?? '')) : (fallback ?? key);
};

describe('issueText', () => {
  it('prefers the path-specific text', () => {
    expect(issueText(t, { path: 'multiplier', code: 'too_small', min: 10, message: 'Too small: expected number to be >=10' })).toBe('Hệ số từ 10 (100 = ×1.0)');
  });
  it('falls back to the code-only text, then to the generic line, never to the English message', () => {
    expect(issueText(t, { path: 'other', code: 'too_small', min: 3 })).toBe('Tối thiểu 3');
    expect(issueText(t, { path: 'other', code: 'weird', message: 'English text' })).toBe('Chưa hợp lệ');
  });
});

describe('fieldErrorsOf', () => {
  it('maps issues by path with translated text', () => {
    expect(fieldErrorsOf([{ path: 'multiplier', code: 'too_small', min: 10 }], t)).toEqual({ multiplier: 'Hệ số từ 10 (100 = ×1.0)' });
  });
});
```

  → FAIL (thiếu module).
- [ ] **Step 5: Implement** `lib/validation.ts`:

```ts
export type ValidationIssue = { path?: string; message?: string; code?: string; min?: number; max?: number };
export type Translate = (key: string, values?: Record<string, string | number>, fallback?: string) => string;

/**
 * Text for one server validation issue: `validation.<path>.<code>`, then `validation.<code>`, then a
 * generic line. The server `message` is English and is never shown.
 */
export const issueText = (t: Translate, issue: ValidationIssue): string => {
  const values = { min: issue.min ?? '', max: issue.max ?? '' };
  const code = issue.code ?? '';
  for (const key of [`validation.${issue.path ?? ''}.${code}`, `validation.${code}`]) {
    const text = t(key, values, '');
    if (text) return text;
  }
  return t('validation.invalid');
};

export const fieldErrorsOf = (issues: ValidationIssue[], t: Translate): Record<string, string> =>
  Object.fromEntries(issues.map((issue) => [issue.path ?? '', issueText(t, issue)]));
```

  Chạy lại → xanh.
- [ ] **Step 6: Nối vào `api.ts`.** `fieldErrors(error, t?)`: khi có `t` dùng `fieldErrorsOf` (nhánh `issues` là mảng); không có `t` giữ hành vi cũ để không vỡ caller khác. `useErrorToast`: lấy `issue = apiErrorOf(error).details?.issues?.[0]`; nếu có thì `message: \`${head}: ${issueText(t, issue)}\`` với `head = known || message || t('error.generic')`. Đổi các caller: `fieldErrors(error, t)` ở `Loyalty/index.tsx:117,281`, `Loyalty/CustomerLoyalty.tsx:100`, mọi chỗ trong `Settings/index.tsx` (`rg -n "fieldErrors\(" src/plugins/ordering/admin/src`) — đã có `t = useT()` ở các component đó.
- [ ] **Step 7: Khóa dịch** thêm vào `translations/o3.ts` (sau nhóm `error.*`):

```ts
  'validation.invalid': ['Giá trị chưa hợp lệ', 'This value is not valid'],
  'validation.too_small': ['Giá trị tối thiểu là {min}', 'The minimum is {min}'],
  'validation.too_big': ['Giá trị tối đa là {max}', 'The maximum is {max}'],
  'validation.invalid_format': ['Định dạng chưa đúng', 'The format is not valid'],
  'validation.invalid_date': ['Ngày không hợp lệ', 'The date is not valid'],
  'validation.not_unique': ['Các giá trị không được trùng nhau', 'Values must be unique'],
  'validation.code.invalid_format': ['Mã chỉ gồm chữ thường, số và dấu gạch ngang (2–40 ký tự)', 'Use lowercase letters, digits and dashes (2–40 characters)'],
  'validation.multiplier.too_small': ['Hệ số điểm tối thiểu là {min} (100 = ×1.0)', 'The minimum multiplier is {min} (100 = ×1.0)'],
  'validation.multiplier.too_big': ['Hệ số điểm tối đa là {max} (100 = ×1.0)', 'The maximum multiplier is {max} (100 = ×1.0)'],
  'validation.lines.no_variant': ['Chọn ít nhất một món cho bảng giá', 'Choose at least one item for the price list'],
  'validation.lines.too_many_rows': ['Quá nhiều dòng giá, hãy thu hẹp điều kiện', 'Too many price rows, narrow the conditions'],
  'validation.validTo.range_order': ['Ngày kết thúc phải sau ngày bắt đầu', 'The end must be after the start'],
  'validation.rules.timeRanges.empty_range': ['Khung giờ không được để trống', 'A time range must not be empty'],
  'validation.adjust.value.too_big': ['Phần trăm giảm tối đa là {max}', 'The percentage can be at most {max}'],
  'validation.adjust.target.refs.no_target': ['Chọn ít nhất một danh mục hoặc món', 'Choose at least one category or product'],
```

  (thêm khóa riêng cho mã khác nếu Step 3 sinh ra mã chưa có; mã thiếu khóa sẽ rơi về `validation.invalid`, không lộ tiếng Anh.)
- [ ] **Step 8: Gate:** `pnpm lint; pnpm typecheck; pnpm typecheck:admin; pnpm vitest run` (đủ cho server + admin); `pnpm build:ordering; node scripts/ordering/price-lists.mjs; node scripts/ordering/loyalty-tiers.mjs` (script cũ có thể so khớp `message`; nếu vỡ chỉ vì `code` thêm vào thì cập nhật assertion).
- [ ] **Step 9: User UAT:** Bảng giá → tạo không chọn món: thấy "Bảng giá chưa hợp lệ: Chọn ít nhất một món…"; Hạng thành viên → hệ số 2: thấy câu tiếng Việt dưới ô.
- [ ] **Step 10: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): validation issues carry a code so admin forms show translated field errors`.

---

### Task 11: BUG-09, BUG-11, BUG-12

#### BUG-12 — Đánh giá hiện mã tag (`late`) thay vì nhãn đã cấu hình (sửa thật)

**Đã xác nhận:** `rating.ts:116,168` `staffView` trả `tags: tagsOf(row.tags)` (mã); UI `Ratings/index.tsx:119-123` (modal) và `:368-370` (bảng) in thẳng mã. Nhãn nằm ở settings `ratingTags[].label` (`{ vi, en? }`, `ordering-settings.ts:17-21`); `tagsFor` (`rating.ts:134`) chỉ dùng cho màn khách.

**Files:** `src/plugins/ordering/server/src/services/rating.ts:134-143,400-405,417-418`, `src/plugins/ordering/admin/src/pages/Ratings/index.tsx:34-50,119-123,176-222,368-370`, `scripts/ordering/rating.mjs`.

- [ ] **Step 1: Test đỏ** — trong `scripts/ordering/rating.mjs`, ở chỗ đã gọi staff `GET /ratings` và `GET /ratings/:id` (tìm `rg -n "'/ratings" scripts/ordering/rating.mjs`), thêm:

```js
assert.ok(list.body.tagLabels && typeof list.body.tagLabels === 'object', 'list carries tagLabels');
for (const item of list.body.items) {
  for (const code of item.tags) assert.ok(list.body.tagLabels[code], `label for tag ${code}`);
}
assert.ok(detail.body.tagLabels, 'detail carries tagLabels');
```

  (đổi `list`/`detail` thành tên biến thật của response trong script). `pnpm build:ordering; node scripts/ordering/rating.mjs` → FAIL.
- [ ] **Step 2: Server** — trong `rating.ts` (cạnh `tagsFor`):

```ts
  /** code → { vi, en } of the configured rating tags, so staff screens show labels instead of codes. */
  const tagLabels = async (): Promise<Record<string, Record<string, string>>> =>
    Object.fromEntries((await settings().get()).ratingTags.map((tag) => [tag.code, tag.label]));
```

  Thêm `tagLabels: await tagLabels(),` vào object trả về của `listForStaff` (cạnh `summary/items/pagination`, dòng ~400) và của `detail` (cạnh `rating`, dòng ~417). Các action `hide/show/note` trả `{ rating }` — giữ nguyên.
- [ ] **Step 3: UI** (`Ratings/index.tsx`): thêm kiểu `type TagLabels = Record<string, Record<string, string>>`; `Detail` thêm `tagLabels: TagLabels`; trong `DetailModal` thêm `const locale = useLocale();`; trong `RatingsList` thêm state `const [tagLabels, setTagLabels] = useState<TagLabels>({})`, đặt từ `body.tagLabels ?? {}` khi load (dòng ~216, thêm vào kiểu `body`). Hàm dùng chung:

```tsx
const tagText = (code: string, labels: TagLabels | undefined, locale: string) =>
  localized(labels?.[code], locale) || code;
```

  Thay `{tag}` ở hai chỗ bằng `{tagText(tag, detail?.tagLabels, locale)}` (modal) và `{tagText(tag, tagLabels, locale)}` (bảng). Mã bị xóa khỏi cấu hình vẫn hiện mã thô.
- [ ] **Step 4: Chạy xanh:** `pnpm build:ordering; node scripts/ordering/rating.mjs; pnpm typecheck; pnpm typecheck:admin; pnpm lint`.

#### BUG-09 — Giờ xem trước khuyến mãi hiện UTC (đóng, không sửa code)

**Đã đọc code:** `Promotions/PromotionEditor.tsx:97-103` biến đổi thời điểm sang `datetime-local` bằng giờ **trình duyệt** (`getHours()`…) và dòng `:700` ghép chuỗi đó vào "KHÁCH THẤY". Nghĩa là hiển thị đúng với trình duyệt đặt múi giờ VN; chỉ lệch khi trình duyệt chạy UTC (máy test/CI của tester). Không phải lỗi của plugin.
- [ ] **Step 1:** user mở "Tạo khuyến mãi" trên trình duyệt đặt múi giờ Việt Nam: giờ khởi đầu phải bằng giờ hiện tại (11:11, không phải 04:11) → ghi "không phải bug (môi trường tester)" vào Completion record và đóng.
- [ ] **Step 2 (chỉ khi user muốn khóa giờ theo chi nhánh bất kể trình duyệt):** việc riêng cần quyết múi giờ (cấu hình chi nhánh có `timezone`); không làm trong plan này.

#### BUG-11 — React cảnh báo thiếu `key` ở `ProvidersPage` (chưa tái hiện được bằng đọc code)

**Đã đọc code:** mọi danh sách trong `Providers/index.tsx` đều có `key`: `:133` (`group.key`), `:139` (`card.code`), `:189` (`name`). Không có `.map` nào khác trong file. Vì vậy chưa biết nguồn cảnh báo.
- [ ] **Step 1: Thu bằng chứng** (user hoặc AI chạy admin dev, mở Nhà cung cấp, mở console): chép **nguyên văn** cảnh báo, gồm dòng `Check the render method of ...` và `It was passed a child from ...` cùng component stack. Ghi vào Completion record. Chưa sửa gì khi chưa có nội dung này.
- [ ] **Step 2: Sửa theo stack.** Ứng viên đầu tiên: mảng `Typography` truyền thẳng làm `children` của `Alert` (`:187-193`) — bọc vào một phần tử:

```tsx
<Alert closeLabel={t('common.close')} variant="default" title={t('p1.envNeeded')}>
  <Flex direction="column" alignItems="flex-start" gap={1}>
    {card.envNeeded.map((name) => (
      <Typography key={name} variant="pi" style={{ fontFamily: 'monospace' }}>
        {name}
      </Typography>
    ))}
  </Flex>
</Alert>
```

  (cũng giải quyết lỗi UX "tên biến môi trường dính liền nhau"). Nếu stack chỉ vào chỗ khác thì sửa đúng chỗ đó.
- [ ] **Step 3:** `pnpm typecheck:admin; pnpm lint`; user mở lại trang: console sạch cảnh báo.

- [ ] **Gate cả task:** `pnpm lint; pnpm typecheck; pnpm typecheck:admin`. Dừng — chờ user cho commit. Gợi ý: `fix(ordering): staff rating screens show configured tag labels` (BUG-12) và `fix(ordering): providers env list renders inside one element` (BUG-11 nếu có sửa).

---

### Task 12: BUG-10 — OpenAPI thiếu/sai

**Đã xác nhận:**
- `docs/ordering-admin-openapi.json` được **sinh** từ `server/src/openapi/operations.ts` (`pnpm ordering:openapi`); `node scripts/ordering/openapi.mjs` so khớp với file route. Sửa ở `operations.ts`, không sửa tay file JSON.
- Query bắt buộc đang không khai báo: `adm('get', '/cash-closing' …)` và `'/cash-closing/summary'` (`operations.ts:835-836`) không có `parameters`, trong khi `controllers/cash-closing.ts:24-25` đọc `branch` + `businessDate` và service ném 400 khi thiếu (`dateOf`). `'/reports/sales'` (`:841`) không khai `from`/`to`/`branch` (đọc ở `controllers/reports.ts:26-28`; xác nhận `from` có bắt buộc không bằng `rg -n "from" src/plugins/ordering/server/src/services/reports.ts`).
- `PUT /loyalty/settings` khai `requestBody: generic` (`:1179-1182`). Nguyên nhân "GET trả `startsAt`, PUT từ chối": `domain/loyalty/settings.ts:34` `loyaltySettingsInputSchema = ….omit({ startsAt: true }).strict()` nên body có `startsAt` bị coi là khóa lạ. UI tự bỏ `startsAt` trước khi gửi (`Loyalty/index.tsx:110`) nên UI không dính; client khác gửi lại nguyên body GET sẽ dính.

**Files:** `src/plugins/ordering/server/src/openapi/operations.ts:835-841,1176-1182`, `src/plugins/ordering/server/src/domain/loyalty/settings.ts:42-51`, test `src/plugins/ordering/server/src/domain/loyalty/settings.test.ts` (thêm vào nếu có; nếu chưa có thì tạo), `docs/ordering-admin-openapi.json` (sinh), `scripts/ordering/loyalty-admin.mjs`.

- [ ] **Step 1: Test đỏ — `startsAt` chỉ-đọc** (`settings.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_LOYALTY_SETTINGS, parseLoyaltySettingsInput } from './settings';

describe('parseLoyaltySettingsInput', () => {
  it('ignores the read-only startsAt so a GET body can be sent straight back to PUT', () => {
    const body = { ...DEFAULT_LOYALTY_SETTINGS, startsAt: '2026-10-10T00:00:00.000Z' };
    expect(parseLoyaltySettingsInput(body)).not.toHaveProperty('startsAt');
  });
  it('still rejects unknown keys', () => {
    const { startsAt: _readOnly, ...writable } = DEFAULT_LOYALTY_SETTINGS;
    expect(() => parseLoyaltySettingsInput({ ...writable, nope: 1 })).toThrow();
  });
});
```

  → ca đầu FAIL (hiện ném `VALIDATION_ERROR`).
- [ ] **Step 2: Sửa** `parseLoyaltySettingsInput` (`settings.ts`): bỏ `startsAt` trước khi parse strict.

```ts
/** `startsAt` is service-owned and read-only: GET returns it, so a client echoing the body must not be rejected. */
const withoutReadOnly = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw ?? {};
  const { startsAt: _readOnly, ...rest } = raw as Record<string, unknown>;
  return rest;
};

export const parseLoyaltySettingsInput = (raw: unknown): Omit<LoyaltySettings, 'startsAt'> => {
  const parsed = loyaltySettingsInputSchema.safeParse(withoutReadOnly(raw));
  // …phần còn lại giữ nguyên
```

  Xanh vitest. Giá trị `startsAt` vẫn do `loyalty-settings.ts:40` quyết (không đọc từ body).
- [ ] **Step 3: Test tích hợp** — trong `scripts/ordering/loyalty-admin.mjs`, tại chỗ đã gọi staff `GET /loyalty/settings`, thêm: lấy `settings` từ GET rồi `PUT` **nguyên văn** body đó → `status 200` và `startsAt` không đổi so với trước.
- [ ] **Step 4: Khai báo OpenAPI** (`operations.ts`):

```ts
  adm('get', '/cash-closing', 'Reports', 'Cash-closing summary', ['report.read'], {
    parameters: [
      { name: 'branch', in: 'query', required: true, schema: str },
      { name: 'businessDate', in: 'query', required: true, schema: { ...str, format: 'date' } },
    ],
  }),
  adm('get', '/cash-closing/summary', 'Reports', 'Cash-closing summary (alias)', ['report.read'], {
    parameters: [
      { name: 'branch', in: 'query', required: true, schema: str },
      { name: 'businessDate', in: 'query', required: true, schema: { ...str, format: 'date' } },
    ],
  }),
```

  `reports/sales`: thêm `parameters` cho `from`/`to` (`{ ...str, format: 'date' }`) và `branch`, đặt `required: true` đúng với điều kiện đã xác nhận ở đầu task. `PUT /loyalty/settings`: thay `requestBody: generic` bằng `obj({ enabled: bool, earnPerAmount: int, pointValue: int, minRedeemPoints: int, maxRedeemShare: num, expiryMonths: int, expiryReminderDays: int, downgradeGraceDays: int, dailyEarnCap: int, channels: arr(str), countHistoryForTiers: bool })` và ghi chú trong summary: "`startsAt` is read-only and ignored". Schema `GET` giữ `settings: generic`.
- [ ] **Step 5: Sinh lại tài liệu và kiểm:** `pnpm ordering:openapi` rồi `node scripts/ordering/openapi.mjs` (không `--write`) → pass. Ghi chú vào STATUS: các thao tác ghi còn lại vẫn `requestBody: generic` (nợ tài liệu, không làm hết trong task này).
- [ ] **Step 6: Gate:** `pnpm vitest run src/plugins/ordering/server/src/domain/loyalty/settings.test.ts; pnpm build:ordering; node scripts/ordering/loyalty-admin.mjs; pnpm typecheck; pnpm lint`.
- [ ] **Step 7: Dừng — chờ user cho commit.** Gợi ý: `fix(ordering): loyalty settings PUT ignores read-only startsAt; document required query params`.

---
### Task 13: Tài liệu và gate cuối

**Files:** `docs/ordering-api-contract.md` (`:448` totalSpent; thêm `liveDifferenceAmount`; `confirm` của data-requests), `docs/ordering-staff-guide.md` (Chốt tiền mặt: chênh lệch trực tiếp; Yêu cầu dữ liệu: bước xác nhận), `docs/STATUS.md`, `docs/admin-roles.md` nếu quyền đổi (không dự kiến), `docs/plans/ordering-e2e-fixes-2026-10-16.md` (mục Completion record).

- [ ] **Step 1:** cập nhật các tài liệu trên cùng thay đổi (AGENTS.md: "Update stale documentation in the same change").
- [ ] **Step 2: Gate cuối:** `pnpm lint; pnpm typecheck; pnpm typecheck:admin; pnpm vitest run; pnpm build:ordering` rồi các script đã đụng: `data-rights.mjs`, `admin-customers.mjs`, `customers.mjs`, `cash-closing.mjs`, `review-otp-race.mjs`, `review-round3.mjs`, `notify-guard.mjs`, `rating.mjs`, `loyalty-admin.mjs`, `loyalty-tiers.mjs`, `price-lists.mjs`, `openapi.mjs`. Không chạy `run-all.mjs`.
- [ ] **Step 3:** `git status --short` và `git diff --check`; xác nhận không có file ngoài phạm vi (`.commandcode/`, `artifacts/`, `docs/BAO-CAO-E2E-ORDERING.md` chỉ commit khi user nói).
- [ ] **Step 4:** Đặt Status = `Automated verification passed` (chưa `Complete`: còn UAT UI của user và quyết định D0–D4).

---

## Data and rollback

- Migration/backfill: chỉ `0014` (Task 3), `UPDATE` idempotent trên bảng `customer`, không đổi schema, không xóa dữ liệu.
- Compatibility: `liveDifferenceAmount` là trường **thêm**; client cũ bỏ qua. `POST /data-requests` erase **thiếu `confirm`** từ nay trả 400 — client nào gọi trực tiếp API (script, tích hợp) phải thêm `confirm:true`; UI admin được sửa cùng lúc.
- Rollback: các thay đổi code revert bằng commit. Migration `0014` forward-only về ý nghĩa (số cũ là số sai); nếu cần lùi, giá trị đúng vẫn đúng với bản code cũ cho tới lần `refreshStats` kế (bản cũ sẽ lại cộng chuỗi — vì vậy không revert Task 3 mà không revert 0014).

## Verification

- Automated: danh sách ở Task 13 bước 2; mỗi task có lệnh đỏ → xanh riêng.
- Manual UAT (user): Task 1 (xóa 2 bước), 2 (Bếp có đơn), 4 (chênh lệch sau chốt), 8 (403/404), 9 (các màn UX), 11 (giờ VN, console sạch). Không dùng AI để UAT UI.
- Evidence to record: bảng sweep Task 2/3/8, SHA từng commit, kết quả `pnpm vitest run` (đích 1536/1536), kết quả SQL trước/sau của Task 3 bước 10.

## Documentation impact

`docs/ordering-api-contract.md`, `docs/ordering-staff-guide.md`, `docs/STATUS.md`, `docs/ordering-admin-openapi.json` (sinh), bản dịch admin. Ghi trong STATUS: R1a đã/chưa commit, BUG-01…13 đã đóng task nào, còn UAT.

## Risks and blockers

- D0: R1a chưa commit, đã chốt sửa chung working tree. Rủi ro còn lại: khi user commit sau này, file Task 5/6 (`registry.ts`, `registry.test.ts`) lẫn thay đổi R1a — user/AI commit phải stage theo file và xem `git diff` từng file.
- Báo cáo nhắc ảnh `screenshots/...` không có trong repo (chỉ có bản HTML ở Downloads): không blocker, nhưng link ảnh trong `docs/BAO-CAO-E2E-ORDERING.md` sẽ hỏng nếu commit file đó như hiện tại.
- Task 3 đổi nghĩa "Tổng chi" (trừ hủy món). Nếu user muốn tổng **thực thu** (trừ cả hoàn tiền) thì là thay đổi lớn hơn, cần quyết định riêng.
- D4: `adjust` không khóa advisory và đọc ngoài transaction — có thể chốt/điều chỉnh lệch khi có posting đồng thời. Chưa sửa; đề nghị làm riêng nếu user đồng ý.
- BUG-07: phần "giao-q1 mở Bàn & QR trắng" chưa tái hiện được bằng code; nếu sau Task 8 user vẫn thấy trắng, cần console + tab Network của user trước khi sửa tiếp (không đoán). BUG-11 tương tự: cần nguyên văn cảnh báo console.
- Script tích hợp chạy mã đã build: quên `pnpm build:ordering` sẽ cho kết quả cũ (báo "xanh" giả).

## Completion record

**Thực hiện 2026-10-16 (Nhóm A; viết code không commit theo D0, commit sau xem mục "Commit" bên dưới).** Worktree `D:\outsource\salanca\salanca-notify`,
nhánh `feat/ordering-notify-release`, DB test `salanca_ordering_test`. Đường nền Task 0: `git status --short`
= 54 file (R1a chưa commit, `registry.ts` ở trạng thái `M`); `registry.test.ts` đỏ đúng 6 lỗi
`Cannot destructure property 'strapi' of 'undefined'`.

### Task → kết quả

| Task | Bug | Kết quả | Lệnh chính |
|---|---|---|---|
| 1 | Yêu cầu dữ liệu | Xong | `data-rights.mjs`, `admin-customers.mjs`, typecheck ×2 |
| 2 | BUG-01 | Xong | `board.test.ts` 3/3, typecheck:admin |
| 3 | BUG-02 | Xong (kèm migration 0014) | `stats.test.ts` 4/4, `customers.mjs` |
| 4 | BUG-06 | Xong | `cash-closing.mjs` (case 10 mới) |
| 6 | BUG-04 | Xong (làm trước Task 5) | `registry.test.ts` 6/6 |
| 5 | BUG-03 | Xong | `registry.test.ts` 8/8, `review-otp-race`, `review-round3`, `notify-guard` |
| 7 | BUG-05 | Xong | seed UAT chạy hết (DB `salanca_ordering_o8_uat`, limit 7, reserved 6) |
| 8 | BUG-07/13 | Xong | `permissions.test.ts`, `o3.test.ts`, typecheck:admin |
| 10 | BUG-08 | Xong | `validation-issue.test.ts` 3/3, `validation.test.ts` 3/3, `price-lists`, `loyalty-tiers` |
| 11 | BUG-12 (BUG-09 đóng, BUG-11 mở) | Xong | `rating.mjs`, typecheck ×2 |
| 12 | BUG-10 | Xong | `settings.test.ts` 7/7, `loyalty-admin.mjs`, `openapi.mjs` (150 path) |
| 13 | Docs + gate | Xong | `vitest run` 204 file / 1545 test; 12 script tích hợp pass |

### Bảng sweep (Task 2/3/8)

- **Task 2 (envelope)**: `Branches/BranchEditor`, `Webhooks/WebhookEditor`, `PriceLists`, `CustomerGroups`,
  `Print`, `OrderingInboxProvider` đọc `.item` khớp `{ item }`; `CardDetail`, `CustomerLoyalty`,
  `NotificationLog`, `AuditLog`, `CustomerDetailPage`, `Alerts`, `DeliveryTab` đọc phẳng khớp controller
  phẳng. **Chỉ Bếp sai** → đã sửa.
- **Task 3 (reduce cột bigint)**: `carrier-assignment.ts:438`, `payment-matching.ts:327/520/695/789/796/834/884`,
  `order-edit.ts:554/574`, `order.ts:1072` — mọi số hạng đến từ aggregate repository (`amountFromDb`) hoặc
  pipeline giá; **không** cộng cột thô. Chỉ `customer.ts` cộng cột thô → đã sửa.
- **Task 8 (quyền menu ↔ route)**: menu Bếp lệch `order.process` (đã sửa); `Categories`/`Availability` thiếu
  chặn quyền (đã bọc); `Tables`/`TableSessions`/`Kitchen` đã có Alert riêng, khớp route.

### Chỗ lệch plan (đã ghi lại, không đoán)

1. **Task 1 — vị trí kiểm `confirm`**: hợp đồng "thiếu `confirm` → 400" bắt buộc kiểm **trước** tra khách, nên
   `:272` (scope 404) và `:302` phải thêm `confirm: true` để vẫn kiểm đúng scope (`admin-customers.mjs:273,303`).
   `data-rights.mjs:209` (thiếu quyền) giữ nguyên vì middleware quyền chạy trước — vẫn 403.
2. **Task 7 — ngưỡng "gần hết" thật là `remaining/limit ≤ 0.2`**, không phải "≥ 80% đã dùng" như plan ghi.
   Không có `N` nào để 4/N **và** 6/N cùng "cảnh báo" (4/N cần N ≤ 5, 6/N cần N ≤ 7). Giữ phương án khuyến nghị
   `dailyLimit: 7` (seed chạy, thanh bật ở 6/7, còn 1 suất cho UAT) và viết lại comment cho đúng. **Cần user
   xác nhận** nếu muốn thanh bật ngay ở 4/N (khi đó N=5 + giảm đơn dine-in còn 1 suất).
3. **Task 12 — test cũ mâu thuẫn**: `settings.test.ts:45` và `loyalty-admin.mjs:73` khẳng định `startsAt` bị
   **từ chối** (400). Đã đổi thành "bỏ qua, không từ chối" (đúng mục tiêu task) và giữ phép "vẫn từ chối khóa lạ".
4. **Task 10 — phạm vi caller**: chỉ `Loyalty`, `CustomerLoyalty`, `Settings` truyền `t`; `PromotionEditor`,
   `BranchEditor`, `CashClosing`, `WebhookEditor` giữ `fieldErrors(error)` (in message thô) theo đúng Step 6.
   Muốn hết tiếng Anh ở các màn đó thì thêm `t` ở lần sửa sau.
5. **Task 4 — OpenAPI**: không có schema `ClosingSnapshot` trong `operations.ts` (response `generic`), nên
   `liveDifferenceAmount` chỉ tài liệu ở `docs/ordering-api-contract.md`; Task 12 mới đổi `operations.ts`.
6. **Task 11 — BUG-11 không sửa** (chưa có nguyên văn cảnh báo console); **BUG-09** đóng là môi trường tester
   (giờ hiển thị theo múi giờ trình duyệt), không sửa code. **Task 9 (Nhóm B) chưa làm** theo đúng phân nhóm.

### Commit (2026-10-16, cục bộ, chưa push)

Mười commit `fix(ordering): …` trên `feat/ordering-notify-release`, mỗi commit một task (migration tách riêng):
`72da645` Task 1 · `1b1cdee` Task 2 · `6343fca` Task 3 · `097ba30` migration 0014 · `dd3bdde` Task 4 ·
`fa566b5` Task 7 · `dc2b6f8` Task 8 · `64f3e4c` Task 10 · `8af3c72` Task 11 (BUG-12) · `7971800` Task 12.
Các file lẫn thay đổi R1a/R1b (`permissions.ts`, `App.tsx`, `o3.ts`, `operations.ts`, `ordering-admin-openapi.json`,
`STATUS.md`, `staff-guide`) chỉ stage phần hunk của fix. **Task 5/6 (BUG-03/04)** nằm trong commit R1 `80dcecd`
(`feat(ordering): notification release R1 …`): chúng sửa lớp proxy `registry.ts` và `registry.test.ts` của R1a mà HEAD trước đó không có, nên đi cùng.
Hai chỗ bổ sung khi commit (user cho phép): cảnh báo xóa dữ liệu nay in số điện thoại sắp bị xóa
(`dataRequests.create.erasePhone`); số test trong STATUS cập nhật. Đã kiểm lại trên worktree tạm tại HEAD (không có
R1a/R1b): `lint`, `typecheck`, `typecheck:admin`, `vitest` 204 file / 1528 test, build server bằng `tsc`, `schema.mjs`,
`openapi.mjs`. Các script `customers`, `cash-closing`, `data-rights`, `admin-customers`, `loyalty-admin`, `rating` chưa
chạy trên cây chỉ-fix (đã pass trên working tree đầy đủ) — chạy lại trước khi push.

### Chưa chạy

- `schema.mjs` / `registry-boot.mjs` (Task 3 Step 10 — user tự chạy trên DB UAT thật; migration 0014 đã xác nhận
  có trong sổ trên DB `salanca_ordering_o8_uat` của seed).
- UAT UI (user), `run-all.mjs`, Playwright.

### Bổ sung 2026-10-16 (sau review bộ Playwright `e2e/`)

Ngoài 13 task trên, báo cáo E2E bản sau thêm BUG-14, BUG-15 và bộ Playwright được chép vào `e2e/`. Đã làm:

- **BUG-14** (webhook provider chưa đăng ký trả 500): `webhook.ts` kiểm `hasPaymentProvider` trước khi resolve; mã mới
  `WEBHOOK_PROVIDER_UNKNOWN` = 404; test `sepay-webhook.mjs` (đỏ 500 → xanh 404) và `errors.test.ts`.
- **BUG-15** (tìm đơn không gửi khi Enter): `Searchbar` của design-system 2.2.3 chỉ render `<input>` và chuyển
  `onSubmit` xuống input (không bao giờ nhận sự kiện submit); `<SearchForm>` mới là `<form role="search">`. Bọc
  `SearchForm` ở `Orders/OrdersList.tsx` và `PaymentReview/index.tsx` (màn thứ hai cùng lỗi, báo cáo không nhắc).
- **Bộ `e2e/`**: `eslint.config.mjs` thêm override cho `e2e/**` (`no-explicit-any` tắt; trước đó `pnpm lint` fail 70 lỗi);
  test `@bug-06` đọc số đầu tiên của ô (không dán chữ số của dòng "Lúc chốt") và tự tìm collector thay vì gán cứng
  `Local Admin`; BUG-03 `@slow` ghim DB `salanca_ordering_e2e_race` (trước đây thừa hưởng `ORDERING_TEST_DATABASE`, harness
  TRUNCATE DB đó); `@slow` mặc định bị loại (`E2E_SLOW=1` để chạy) vì README cũ nói vậy nhưng config không làm;
  `@bug-09` thành `fixme` (plan đã đóng, quyết định sản phẩm còn mở); `@bug-11` chỉ chạy với `E2E_ADMIN_DEV=1`;
  `@ux-erase-confirm` dùng khách riêng thay vì `0900000001`; bỏ mật khẩu admin mặc định trong `env.ts`; xóa
  `helpers/uat-seed-workaround.mjs` (BUG-05 đã sửa trong repo); viết lại `e2e/README.md` (cổng UAT mặc định 1355, super
  admin phải tự tạo, không trỏ vào DB dev).
- **Chưa chạy**: Playwright không chạy lại trên server thật; mọi thay đổi `e2e/` chỉ qua `tsc -p e2e` và `--list`.
  Chạy `pnpm test:e2e` trên server UAT mới sau khi merge `feat/ordering` (có `b78fc9b` = D4 trong `cash-closing.ts`).

### Retest v2 (HEAD `0a1483f`, báo cáo `BAO-CAO-RETEST-V2.md`) và xử lý

Kết quả retest: lint/typecheck/vitest xanh (207 file / 1554 test), `@slow` BUG-03/04/05 đạt, 106/108 script `run-all`
đạt. Xử lý từng điểm:

| Điểm retest | Kết luận | Xử lý |
|---|---|---|
| `audit-log.mjs:67` lọc ngày hôm nay ra rỗng | **Bug thật** ở `audit-log.ts`: cận dưới là chuỗi (Postgres bỏ offset), cận trên là `?::timestamptz` (giữ offset) nên hai đầu của ngày VN nằm trên hai đồng hồ khác nhau. Chỉ lộ khi Node và Postgres khác múi giờ và đã quá 17:00 | Cả hai cận là `Date` (cùng đường chuyển đổi mà Strapi dùng khi ghi). Ca hồi quy cố định trong `audit-log.mjs` (hàng 00:30 và 23:30 giờ VN, và 00:30 hôm sau). Pass ở cả 4 tổ hợp: Node/PG = +7/+7, +7/UTC, UTC/+7, UTC/UTC |
| `outbox-two-process.mjs:205` backoff lệch 7 giờ | **Chỉ lỗi ở script** (`now()` của Postgres). `outbox.ts` ghi và đọc `available_at` bằng `Date` đối xứng nên giờ retry thật không lệch | Script dùng tham số `Date` thay `now()`. Pass ở +7/+7, +7/UTC, UTC/+7 |
| BUG-10 chỉ sửa một phần | Đúng: báo cáo gốc nói "gần như không có schema request body", Task 12 chỉ làm `PUT /loyalty/settings` | Thêm body cho 14 thao tác ghi: `transition`, `notes`, `cash-handover`, `cancel`, `lines/:id/cancel`, `refunds`, `refunds/:id/settle`, `manual-payments`, bốn thao tác `payment-reviews`, `cash-closing`, `cash-closing/:id/adjust`. **Còn 34 thao tác ghi chưa khai body** (một phần không có body: `rotate-qr`, `start`, `complete`…; phần cần body: danh mục, chi nhánh, cài đặt, webhook, staff-scopes, availability) |
| Hạng loyalty chỉ hiện "Giá trị chưa hợp lệ" | **Thiếu sót của fix BUG-08**: chỉ lỗi từ zod có `code`; lỗi tự viết như `invalid(...)` trong `loyalty-tier.ts` thì không | `loyalty-tier.ts`, `branch.ts`, `customer-group.ts`, `promotion-admin.ts` thêm `code` (`lowest_not_zero`, `duplicate_threshold`, `last_active`, `group_*`, `taken`, `immutable`) + bản dịch `validation.*`. `loyalty-admin.mjs` kiểm `code`. Còn khoảng 20 chỗ tự viết khác chưa có `code` (hiện vẫn ra câu chung, không lộ tiếng Anh) |
| BUG-11 vẫn báo thiếu `key` ở Nhà cung cấp | **Chưa xác định được nguồn.** Mọi `.map` trong `Providers/index.tsx` đều có `key` và dữ liệu server có đủ `group.key`/`card.code` | Cần nguyên văn dòng `Check the render method of …` cùng component stack từ console |
| `MISSING_TRANSLATION lead-shortcuts.*` | Không thuộc plugin ordering (plugin `lead-shortcuts` của Salanca CMS) | Không sửa trong đợt này |
| Test e2e cũ | BUG-02 dùng tổng báo giá (chưa trừ khuyến mãi đơn đầu); BUG-06 so tiêu đề phân biệt hoa thường; spec hạng loyalty không tạo hạng nền 0đ; API xóa kỳ vọng 404 sai | Đã sửa trong `e2e/specs/99-bugs.spec.ts` và `04-marketing.spec.ts`; thêm ca "tier rules trả `code`". Chưa chạy lại Playwright |
| Migration 0014 chưa kiểm được trên dữ liệu cũ | Đúng | `customers.mjs`: ghi sai `total_spent`/`order_count`, hủy một phần một đơn, chạy migration, kiểm lại và chạy lần hai (idempotent). Pass |

Đề xuất, **chờ user xác nhận**: (1) vận hành `TZ=UTC` cho Node và Postgres (đã ghi vào runbook mục "Hạ tầng và go-live"
dưới dạng yêu cầu "hai bên trùng nhau"); (2) API xóa với số điện thoại chưa có hồ sơ giữ nguyên hành vi hiện tại (201 cho
admin mọi chi nhánh, 404 cho nhân viên bị giới hạn chi nhánh) — test e2e chỉ đòi "không phải 400 của `confirm`".
BUG-09, D2 (có trừ hoàn tiền hay không) và D4 (khóa `adjust`) vẫn là quyết định của chủ dự án.
