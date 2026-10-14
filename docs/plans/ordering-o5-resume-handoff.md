# Handoff tiếp tục O5 sau khi Grok hết hạn mức

Ngày chốt trạng thái: 2026-10-12, múi giờ Asia/Saigon.

Nguồn bàn giao: session Grok mới nhất `Phase O5 in-house delivery plugin coding - grok`, session ID
`01a12d7a-ae5b-74d2-afb2-4e045949ee15`. Grok dừng vì `You hit your weekly limit` ngay sau khi bước 4 chạy integration
thành công. Đây là handoff tiến độ; không thay thế prompt gốc
[`ordering-o5-handoff.md`](ordering-o5-handoff.md).

> Dán nguyên file này vào session mới. Làm tiếp từ trạng thái hiện tại; không làm lại bước 1–3.

## 1. Phạm vi và hàng rào an toàn

- Repo thật: `D:\outsource\salanca\salanca-backend`.
- Nhánh bắt buộc: `feat/ordering-o5`.
- Không merge `main`, không push, không chạy `pnpm export:cms-seed`.
- Không đụng `salanca_cms`, production, content type/seed/data của Salanca.
- Mọi kiểm tra DB chỉ dùng `salanca_ordering_test`.
- Không thêm dependency, không thêm content type hoặc cột DB cho O5.
- Không log hoặc đưa vào lỗi: tên, số điện thoại, địa chỉ khách, token hay credential.
- Không dùng `git stash`; giữ nguyên hai stash hiện có, đặc biệt `stash@{0}: autostash`.
- Không commit file handoff này nếu chủ dự án chưa yêu cầu.
- Trước khi báo xong, kiểm tra `feat/ordering-o4` có commit mới hay không. Chỉ merge O4 vào O5 khi O4 đi tiếp; dừng và
  báo nếu conflict.
- Repo hiện không có `.codegraph/`; không cần gọi CodeGraph.

Đọc theo thứ tự:

1. `AGENTS.md`, `PLANS.md`.
2. `docs/plans/ordering-o5-handoff.md` — prompt gốc và toàn bộ giới hạn.
3. `docs/phases/phase-ordering-5-delivery.md`.
4. `docs/plans/ordering-o5-delivery.md` và `docs/plans/ordering-o5-screens.md`.
5. File handoff này.

## 2. Trạng thái Git đã xác minh

HEAD hiện tại:

```text
f313ef2 (feat/ordering-o5) feat(ordering): price delivery orders with self-delivery
```

Ba bước đã commit:

| Bước | Commit | Nội dung |
|---|---|---|
| 1 | `407aa65` | Danh mục hành chính, loader, fixture test, API, cảnh báo bootstrap |
| 2 | `b10bfa2` | Vùng giao, rule phí, tab cấu hình chi nhánh, API báo phí |
| 3 | `f313ef2` | Provider `self-delivery`, quote/create đơn giao, phí và snapshot |

Quan hệ nhánh lúc lập handoff:

```text
git rev-list --left-right --count feat/ordering-o4...feat/ordering-o5
0    3
```

Tức là O4 chưa có commit mới ngoài nền mà O5 đang chứa. Không cần merge O4 ngay lúc này.

Working tree đang chứa đúng bước 4, chưa stage và chưa commit:

```text
 M docs/plans/ordering-o5-screens.md
 M scripts/ordering/delivery-quote.mjs
 M src/plugins/ordering/server/src/services/order.ts
?? src/plugins/ordering/server/src/domain/contact/address.ts
?? src/plugins/ordering/server/src/domain/contact/address.test.ts
```

`git diff --cached --name-status` đang rỗng. Giữ nguyên mọi thay đổi trên; đây là code Grok vừa làm, không phải rác.

## 3. Bước 4 đang dở: địa chỉ giao hàng

### Code đã viết

`domain/contact/address.ts` tạo `snapshotDeliveryAddress()`:

- bắt buộc `recipientName`, `line1`, số điện thoại Việt Nam hợp lệ và mã xã/phường;
- chấp nhận `communeCode` hoặc alias `wardCode`;
- mã rỗng trả `missing-commune`;
- mã không có trong catalog trả `unknown-commune`;
- lấy `wardCode`, `wardName`, `provinceCode`, `provinceName` từ catalog;
- bỏ qua tên tỉnh/xã do client gửi;
- chuẩn hóa điện thoại sang E.164 bằng `shared/contact/phone.ts`.

`domain/contact/address.test.ts` có 3 ca:

1. thiếu mã xã/phường;
2. `XT99999` không có trong catalog, không rò tên/địa chỉ client;
3. `xt01002` được chuẩn hóa và snapshot dùng đúng tên từ fixture, không dùng tên giả client gửi.

`services/order.ts` đã:

- bỏ helper `deliverySnapshot()` cũ;
- dùng `requireDeliveryAddress()` chung cho quote và create;
- kiểm tra địa chỉ trước khi claim idempotency key;
- lưu `PreparedOrder.deliveryAddress` rồi dùng chính snapshot đó khi tạo đơn và fulfillment;
- không còn chấp nhận mã lạ bằng cách lưu code nhưng thiếu tên.

`scripts/ordering/delivery-quote.mjs` thêm ca `XT99999`:

- HTTP 400;
- `VALIDATION_ERROR`;
- `details.reason === "unknown-commune"`;
- response không rò dữ liệu khách.

`ordering-o5-screens.md` đã ghi rõ mã không có trong catalog là `VALIDATION_ERROR/unknown-commune`, khác xã có trong
catalog nhưng nằm ngoài vùng giao là `DELIVERY_UNAVAILABLE/outside`.

### Kiểm tra đã có bằng chứng

- Unit address: `3/3` pass trong session Grok.
- Lệnh integration sau hoàn tất `Exit Code: 0`, thời gian 35.09 giây:

```powershell
pnpm run build:ordering
node scripts/ordering/delivery-quote.mjs
```

- Log xác nhận DB là `salanca_ordering_test` và kết thúc bằng:

```text
[ordering-test] delivery quote: fee, total, snapshot and refusal verified
[ordering-test] done
```

- Bằng chứng cục bộ của session Grok:
  `C:\Users\tan_ngo\.grok\sessions\D%3A%5Coutsource%5Csalanca\01a12d7a-ae5b-74d2-afb2-4e045949ee15\terminal\call-78a21197-611c-42d1-9d80-80c289160bda-259.log`.

### Việc phải làm ngay

Grok nói “Mình lint rồi commit” theo nghĩa việc tiếp theo, nhưng chưa chạy xong hai việc đó. Đừng báo bước 4 hoàn tất
cho tới khi có bằng chứng lint và commit.

```powershell
Set-Location D:\outsource\salanca\salanca-backend
git status --short --branch
git diff --check
pnpm exec eslint src/plugins/ordering/server/src/domain/contact/address.ts src/plugins/ordering/server/src/domain/contact/address.test.ts src/plugins/ordering/server/src/services/order.ts scripts/ordering/delivery-quote.mjs
pnpm exec vitest run src/plugins/ordering/server/src/domain/contact/address.test.ts
pnpm run build:ordering
node scripts/ordering/delivery-quote.mjs
```

Sau khi tất cả exit 0, stage đúng 5 file bước 4 ở trên. Không stage file handoff này. Kiểm tra bằng
`git diff --cached --name-status`, rồi commit một commit có trailer:

```text
feat(ordering): validate delivery address snapshots

Co-Authored-By: Grok 4.7 <noreply@x.ai>
```

## 4. Hành vi O5 đã có và phải giữ

- Catalog thật `server/src/data/admin-units/<version>.json` vẫn chưa có. Chỉ fixture test prefix `XT` được nạp khi
  `testing.builtins`. Completion record phải ghi **chờ dữ liệu**.
- File catalog thật mới nhất theo thứ tự từ điển thắng; file `test-*` hoặc `*.test.*` bị bỏ qua. Catalog hỏng không
  được âm thầm thay bằng fixture.
- Zone ưu tiên cao chạy trước; rule đầu tiên khớp thắng; `unavailable` chặn giao; ngoài mọi zone trả
  `DELIVERY_UNAVAILABLE`.
- Phí giao tính server-side, nằm trong `fulfillmentAmount`; tổng đơn phải khớp.
- API báo phí Admin đã chốt là `POST /ordering/branches/:code/delivery-quote`, không có `/admin` trong path.
- Public quote/create nhận `receiveMethod.kind = "delivery"`; response quote có `delivery` hoặc `null`.
- Snapshot lưu cả code và tên tại thời điểm đặt; thay catalog sau này không sửa đơn cũ.
- Public order response không được lộ địa chỉ; DB fulfillment có `addressSnapshot`.
- `deliverySettingsSchema` và `pickupSettingsSchema` dùng `.prefault({})`. Khi update branch chỉ ghi key thực sự có
  trong raw request; nếu spread toàn bộ Zod output, PUT delivery-only sẽ reset pickup lead time về 180.
- Admin không import `server/**` hoặc `@strapi/utils`; logic dùng chung đặt trong `shared/`.
- Tab cấu hình “Giao tận nơi” đã nằm trong màn Chi nhánh. Bước 6 chỉ còn board Đơn giao và action chi tiết.

## 5. Bước 5 chưa code: workflow giao, gán người giao, thu tiền và hoàn tiền

Làm bước 5 ngay sau commit bước 4. Không có code bước 5 nào trong working tree hiện tại.

Thiết kế đã thống nhất:

- Giữ style repo: thêm ba workflow vào `domain/workflow/definitions.ts`; kế hoạch ghi thư mục
  `definitions/delivery-*.ts` nhưng source hiện gom trong một file. Ghi deviation này vào Completion record.
- Thêm ba workflow tương ứng:
  - `delivery-pay-on-delivery`;
  - `delivery-prepay`;
  - `delivery-accept-then-pay`.
- Cập nhật `food.ts` và `test-food.ts` để chọn workflow delivery. Hiện delivery vẫn tạm trả
  `pickup-pay-on-pickup` từ bước 3.
- Cập nhật test `registry-boot`: số workflow từ 4 thành 7.
- Thêm `services/delivery-assignment.ts`; mọi gán/chuyển trạng thái phải ở cùng transaction và khóa group trước khi
  kiểm transition.
- Dùng trạng thái kebab-case và sửa `ordering-o5-screens.md` cùng commit:
  - `ready -> out-for-delivery | canceled`;
  - `out-for-delivery -> delivered | failed | canceled`;
  - `failed -> ready | canceled`;
  - `delivered` là terminal success.
- Lý do thất bại: `unreachable`, `wrong-address`, `refused`, `other`; `other` bắt buộc note.
- Retry từ `failed` về `ready` phải clear assignee; gán lại rồi mới giao tiếp.
- Hai nhân viên gán cùng lúc: đúng một request thành công, request còn lại `INVALID_TRANSITION`.
- “Thu tiền và giao” chỉ cho `out-for-delivery`. Khi có assignee, cash payment phải ghi `actorRef` là người giao để
  O6 chốt theo người; xe ngoài không assignee thì actor vẫn là nhân viên đang bấm.
- Không thêm cột cho failure reason; lưu trong timeline payload và/hoặc fulfillment metadata.
- Hủy sau giao thất bại:
  - tiền mặt đã capture phải tạo refund settled;
  - SePay đã capture phải tạo refund pending để người vận hành settle sau.
- Đơn delivery prepay qua SePay vẫn phải được `payment-matching.advanceIfPaid` đẩy ra khỏi `awaiting-payment`.
- Test bắt buộc: failed -> retry; failed -> cancel/refund cho cash và SePay; concurrent assignment; SePay prepay
  auto-advance.

Lưu ý: `cashHandover` hiện có xu hướng hoàn tất đơn ngay. Bước 5 phải thiết kế và test rõ đường “thu tiền rồi giao” từ
`out-for-delivery`, sau đó vẫn tái hiện được nhánh failed/cancel/refund theo spec. Không sửa global cancel một cách làm
vỡ pickup; nếu cần, cô lập logic refund ở delivery cancel path.

## 6. Bước 6–8 còn nguyên

### Bước 6 — Admin Đơn giao

- `admin/src/pages/Deliveries/`, route `/plugins/ordering/deliveries`.
- Menu “Đơn giao” dưới nhóm Vận hành, ẩn theo `order.read`.
- API thực tế theo convention O3 là `/ordering/orders?...`, không phải `/ordering/admin/orders`.
- Bộ lọc dự kiến: receive delivery, trạng thái ready/out/failed, assignee, chi nhánh.
- Có đủ loading, empty, error + retry, 403 và saving.
- Action gán/giao lại/thất bại/thu tiền-giao nằm cả trên board và detail theo screen spec.
- Không dùng `SimpleMenu`/dropdown bên trong Modal vì O3 đã chứng minh có thể treo UI.
- UI thay đổi phải UAT bằng browser theo luồng thật; screenshot tĩnh không đủ.

### Bước 7 — Email khách VI/EN

- Template cho `out-for-delivery`, `failed`, `delivered`.
- `customer.order-ready` hiện có câu mời khách tới chi nhánh; delivery không được dùng wording pickup-only.
- Translation O5 theo dạng `[vi, en]`, merge như O3/O4 và chạy translation tests.

### Bước 8 — Smoke, docs, completion

- Tạo `scripts/smoke-ordering-delivery.mjs`.
- Mở rộng `scripts/ordering/uat-server.mjs` với data giao hàng.
- Cập nhật `docs/ordering-staff-guide.md`, `docs/ordering-api-contract.md`, `docs/STATUS.md`.
- Thay “Chưa bắt đầu” trong Completion record của `ordering-o5-delivery.md` bằng bằng chứng thật và bảng bước -> commit.
- Ghi rõ catalog chỉ là fixture, **chờ dữ liệu**; vùng giao/phí thật chờ trước UAT.
- Ghi rõ UAT nào đã làm, UAT nào chưa làm. Test xanh không đồng nghĩa UI đã được chấp nhận.

## 7. Final gates — chưa chạy

Chạy tuần tự vì build có thể xóa `dist`. Không gọi pass nếu không có exit code 0 rõ ràng.

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run check:ordering

$env:DATABASE_NAME = 'salanca_ordering_test'
$env:ORDERING_ENABLED = 'false'
pnpm run check:phase3

$env:DATABASE_NAME = 'salanca_ordering_test'
$env:ORDERING_ENABLED = 'true'
pnpm run check:phase3
pnpm run smoke:reservation-form

pnpm run smoke:ordering-pickup
node scripts/smoke-ordering-sepay.mjs
node scripts/smoke-ordering-delivery.mjs

$env:ORDERING_ENABLED = 'true'
pnpm exec strapi build
$env:ORDERING_ENABLED = 'false'
pnpm exec strapi build
```

Root `pnpm run typecheck` không bao phủ toàn bộ plugin Admin. Admin tsc đang có lỗi cũ ở app/audit-log/notification,
Availability và Categories; không lấy lỗi cũ làm cớ sửa ngoài phạm vi O5. Phân biệt rõ lỗi mới O5 với lỗi có sẵn.

## 8. Definition of done và báo cáo cuối

Chỉ báo O5 xong khi:

- bước 4–8 mỗi bước có commit nhỏ đúng scope;
- mandatory tests và toàn bộ final gates có exit 0;
- UAT browser được làm và ghi kết quả, hoặc ghi chính xác phần không thể xác minh;
- Completion record, API contract, staff guide và STATUS khớp code;
- diff cuối sạch ngoài file handoff này nếu nó vẫn được giữ untracked;
- O4 đã được kiểm tra lại và merge vào O5 nếu có commit mới;
- không push khi chủ dự án chưa yêu cầu.

Báo cáo cuối bằng tiếng Việt: liệt kê commit, số test, từng gate, deviation, trạng thái catalog `fixture only / chờ dữ
liệu`, UAT đã/chưa xác minh và việc để lại cho O6.
