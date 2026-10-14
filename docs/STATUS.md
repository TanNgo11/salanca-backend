# Salanca Backend Current Status

Last reviewed against repository documentation: 2026-09-29

2026-10-14: **Ordering O12 (vận hành nhà hàng: tạm dừng, phí, dị ứng, KDS, in, tại bàn) — implemented +
automated verification passed, chờ manual UAT** trên `TanNgo11/ordering-o12` (tách từ `feat/ordering`
`d292229`). 9 commit `a776b76`…`dfa62b3`, merge `fdd55ce`, review fixes `55a0996` `b070335` `45de2d7` theo
[`plans/ordering-o12-restaurant.md`](plans/ordering-o12-restaurant.md) +
[`plans/ordering-o12-handoff.md`](plans/ordering-o12-handoff.md):

- **Tạm dừng / quán đông**: per-branch per-kênh (pickup/delivery/dine-in), hết hạn tự mở, busy cộng
  phút vào giờ lấy; chặn quote+create trên kênh đang dừng; thanh điều khiển trên Đơn hàng + Bếp.
- **Tự từ chối đơn kẹt**: job `order-autoreject` (mặc định 60', chỉnh per-branch); hoàn hold đã thu
  + email khách lý do "no-response"; khoá job chống 2 process từ chối hai lần.
- **Phí dịch vụ/đóng gói**: `fees[]` trên branch settings (cố định/%, lọc kênh, ngưỡng tạm tính),
  chạy qua pricing-adjustment pipeline, hiện dòng phí trên đơn/tạm tính; `%` tính lại khi sửa đơn.
- **Dị ứng + ăn kiêng + trạm bếp**: 14 mã EU FIC + `custom:*`, 6 nhãn dietary; public catalog trả
  `{code,label}` theo locale, lọc `excludeAllergens`/`dietary`; `kitchenStation` trên danh mục.
- **In trình duyệt**: `GET /admin/orders/:id/print` (kitchen|receipt), trang `/print/:orderId`
  80/58mm, cờ `autoKitchenTicket` + ô "Máy in quầy" tự in qua iframe.
- **KDS**: `GET /kitchen/board` (mới/đang làm/xong 15'), start/prepared/complete theo trạm, màn
  `/kitchen` tối + SSE; cột `order-line.preparedAt`, `fulfillment-group.kitchenStartedAt`.
- **Tại bàn**: `dining-table` (QR token chỉ lưu SHA-256, đổi mã vô hiệu tức thì) + `table-session`
  (một phiên mở/bàn qua cột `openTableId` + unique index); `GET /tables/:token` public tối thiểu;
  đơn `receiveMethod.kind: 'dine-in'` + `tableToken`; nhiều đơn cùng phiên; 3 workflow dine-in;
  `ready→served→completed`; `POST /table-sessions/:id/close` thu tiền mặt/chuyển khoản quầy,
  chặn khi còn món chưa xong, idempotent, ghi người thu; job `table-session-autoclose` chỉ cảnh báo;
  in hóa đơn gộp phiên `/print/session/:id`. **Không có tiền tip** (chờ kế toán xác nhận).

Gate: lint, typecheck, typecheck:admin, vitest `src/plugins/ordering`, `build:ordering`,
`strapi build` bật plugin, `ordering:openapi` regen (127 path), vitest 761/761, 7 script O12
(`pause` `auto-reject` `fees` `allergens` `print` `kds` `dine-in`) + các script bị ảnh hưởng —
số liệu trong Completion record. **Open:** manual UAT browser (in nhiệt thật, KDS trên TV/tablet,
quét QR bằng điện thoại); merge về `feat/ordering` theo quyết định chủ dự án.
2026-10-14: **Ordering O13 (provider adapters: MoMo, VNPay, Ahamove, Zalo ZNS, eSMS) — implemented + automated verification passed, chờ manual UAT** trên `TanNgo11/ordering-o13` (tách từ `feat/ordering`; chưa merge/push). 8 commit bắt đầu từ `4c223f9` theo [`phases/phase-ordering-13-providers.md`](phases/phase-ordering-13-providers.md) + [`plans/ordering-o13-providers.md`](plans/ordering-o13-providers.md) (Completion record có bảng bước→commit đầy đủ):

- **Review fixes (2026-10-14)**: 12 lỗi review (P0 chữ ký VNPay, P1 capture ví/job/hoàn tiền/Zalo token, P2 hạn mức, mã 9000/07, open redirect, che API key, HTTP cap, Ahamove COD/khóa/tọa độ) — bảng lỗi→commit→test trong Completion record của plan O13. Mã đối tác vẫn che 4 ký tự cuối; API key không còn hiện.
- **Ví MoMo/VNPay**: `POST /payments/session` (redirect/QR, `payment.session`), IPN `POST|GET
  /webhooks/:providerCode` ký HMAC/`vnp_SecureHash` trên raw body, ACK theo spec (204 /
  `{RspCode,Message}`), `queryTransaction` + refund qua `payment.session`; job
  `wallet-status-check` đối soát session pending (không có list API). Bắt buộc
  `ORDERING_PUBLIC_API_URL` khi bật.
- **Ahamove**: quote/book/cancel idempotent (`carrier-assignment`, cột carrier trên
  fulfillment), webhook trạng thái qua route chung, COD gate trước khi `COMPLETED`, nút
  **Gọi xe** trên chi tiết đơn/giao.
- **Thông báo**: Zalo ZNS (OAuth refresh, retry `-124`) + eSMS; `notification-channel-rule`
  giữ chuỗi kênh `zalo→sms→email`, fallback khi provider chưa cấu hình/lỗi, hạn mức
  Zalo+SMS/ngày với alert `notification-daily-limit`; OTP kênh `sms`/`zalo` opt-in qua
  `ORDERING_OTP_CHANNELS`. Delivery row lưu hash recipient; `failureText` lọc lỗi provider.
- **Trang Admin**: **Nhà cung cấp** (P1, `settings.manage`, chỉ đọc — badge cấu hình/lỗi, môi
  trường, mã đối tác che 4 ký tự cuối, URL webhook/IPN, env còn thiếu); tab **Kênh thông báo**
  (P3); Ops (P4) thêm thẻ webhook 24h (`webhook-events-24h:*`) + card `wallet-status-check`.
  Webhook fulfillment (ahamove) nằm trong hàng sức khỏe webhook.
- **Migration `0012-o13-providers`** (O9=0010, O12=0011 trên nhánh khác): bảng
  `notification-channel-rule` + index `provider_reference` cho carrier webhook.
- **Docs**: `docs/providers/{momo,vnpay,ahamove,zalo-zns,sms-esms}.md` (version, chữ ký,
  result code, sandbox, rate limit), `docs/ordering-writing-providers.md`, cập nhật
  integrations/runbook/security-baseline/staff-guide.

Gate (DB `salanca_ordering_o13`): `lint`, `typecheck`, `typecheck:admin`, `vitest` plugin
713 test / 73 file, `build:ordering`, 15 script tích hợp PASS (`momo`, `vnpay`,
`wallet-status`, `ahamove`, `zalo-zns`, `sms`, `sepay-webhook`, `sepay-refund`,
`payment-refund`, `delivery-assignment`, `notifications`, `customer-auth`, `email-templates`,
`audit-coverage`, `schema` — cập nhật 52 bảng/index/ledger cho 0012), `openapi.mjs --write`
(110 path), `ORDERING_ENABLED=true strapi build`. **Open:** chưa UAT giao diện Admin
(P1/P3/P4, Gọi xe); chưa UAT sandbox provider thật — mọi provider tắt mặc định; chờ duyệt
merge `feat/ordering`.
2026-10-14: **Ordering fourth review fixes** (`feat/ordering-finish`) — price-list writes
commit metadata, derived prices and audit together; OTP verification serializes by target;
session count/revoke/insert serializes by customer. Line refunds lock lines in ascending id
order before payment, matching cancellation and order editing. All four defects reproduced
on PostgreSQL before fixes; seven regression cases pass afterwards. Build:ordering, lint,
typecheck, 62 Vitest files / 660 tests and eight targeted integration scripts passed.
Changes remain uncommitted; full check:ordering and browser UAT were not run.
[Fourth review record](plans/ordering-review-fixes-4.md).

2026-10-14: **Ordering third review round** (`feat/ordering-finish`) ? customer/order linking and erasure
share identity + row locks; finalization recounts open orders and scrubs newly closed orders. Checkout uses
customer-before-cart locks; erasure records waiting for busy carts. Webhook fanout commits payload + activation
atomically and repairs old incomplete deliveries on retry. Guest-cart merges consume their source once under
both cart locks; OTP issuance serializes per email target and sends only after outermost commit. PostgreSQL
regressions were red before fixes and green afterwards. Compact gates passed (including 62 Vitest files / 660
tests); full check:ordering and manual UAT were not run. [Third review record](plans/ordering-review-fixes.md).

2026-10-13: **Ordering review fixes** (`feat/ordering-finish`) ? cart checkout now locks/reloads the cart
and atomically creates the order + converted link; same-key replay remains supported. Customer cancellation
checks locked fulfillment states. Promotion guessing guards cover cart creation, deferred quotes, reads,
line mutations and customer reorder. Automated verification: build:ordering, lint, typecheck, typecheck:admin,
171 Vitest files / 1298 tests, and 9 targeted integration scripts passed on isolated
`salanca_ordering_review_fixes`. Full check:ordering and browser UAT were not run; existing pg query
deprecation warning remains. Evidence: [review fix record](plans/ordering-review-fixes.md).

2026-10-13: **Ordering O14 (bảng giá theo kênh, nhóm khách, khung giờ)** trên `feat/ordering-o14`.
Bảng giá riêng và bảng điều chỉnh, nhóm khách tay/tự động, job `customer-group-refresh` 03:15.
Giá nhóm chỉ khi phiên khách đã xác thực hoặc đơn hộ khớp hồ sơ; khách vãng lai giữ giá thường.
Catalog có phiên trả `private, no-store`. Khuyến mãi tính trên giá sau bảng giá. Chi tiết và số gate
nằm trong Completion record của [`plans/ordering-o14-price-lists.md`](plans/ordering-o14-price-lists.md).

2026-10-13: **Ordering hoàn thiện sau O8/O11** (`feat/ordering-finish`): pnpm audit 6 critical / 38 high → 2 / 3
(overrides trong major; còn vite 6, webpack-dev-middleware 7, tinypool 2 chỉ dùng lúc build/dev/test và braces chưa có
bản vá), nodemailer 10.1.0; bỏ `minimumReleaseAge: 0` tạm, `.npmrc` trỏ npm công khai. Giỏ hàng nhận `promotionCode`
(cùng bộ chặn đoán mã). Đánh giá ẩn không tính điểm TB. `pnpm run typecheck:admin` mới (0 lỗi; sửa 5 dialog O11 dùng
`Dialog.Title` bị crash). Script test không tự mở tab trình duyệt nữa. Gate gọn: lint, typecheck, typecheck:admin,
vitest, `cart-promotion`/`cart`/`cart-checkout`/`cart-reminder`/`rating`, `strapi build`. Chưa UAT giao diện.

2026-10-13: **O11 tích hợp O8** — `feat/ordering-o11` merge `feat/ordering` (O7, O8, O10, O15), review fix OTP
đồng thời, scope hàng đợi NĐ13, khách vãng lai; xóa dữ liệu khách xóa luôn ghi chú đánh giá, giữ
`customerKey` của lượt khuyến mãi (lý do trong Completion record O11). Gate targeted: lint, typecheck, vitest
632, `build:ordering`, `strapi build`, 35 script PASS. `promotionCode` trong giỏ để đợt sau. Chưa UAT giao diện.

2026-10-14: **Ordering O11 (khách hàng, giỏ server, quyền dữ liệu NĐ13) — implemented + automated verification passed, chờ manual UAT** trên
`feat/ordering-o11` (tách từ `feat/ordering`; chưa merge/push). 7 commit `0a32a0b`…`3e7cc0c` theo
[`phases/phase-ordering-11-customers-cart.md`](phases/phase-ordering-11-customers-cart.md) +
[`plans/ordering-o11-customers-cart.md`](plans/ordering-o11-customers-cart.md):

- **Hồ sơ khách + đăng nhập**: `customer` định danh bằng SĐT VN E.164 (so `phoneHash` HMAC); OTP email
  6 số (TTL 5', ≤5 lần thử, ≤3 gửi/10'/đích, ≤10/giờ/IP), phiên 30 ngày ≤10 phiên qua
  `X-Customer-Token`; `/me` hồ sơ, sổ địa chỉ ≤10, `/me/orders` + tra timeline.
- **Giỏ server**: `/carts` cho guest (`X-Cart-Token`) và khách; quote lại server-side lúc checkout,
  idempotent qua `order.create`; `cart-expiry` (idle 7 ngày, dọn 30 ngày); `cart-reminder` (idle 2h,
  cron 15', cờ `cartReminderEnabled` per-branch, chỉ opt-in tiếp thị); `POST /me/orders/:id/reorder`.
- **NĐ13**: `/me/data-export`, `/me/erase`; hàng đợi `data-request` (hạn 72h, staff tạo chỉ lưu hash,
  waiting đến khi đơn mở đóng); xóa = ẩn danh đơn/địa chỉ/giỏ/phiên/OTP, số tiền kế toán giữ nguyên;
  outbox `customer.erased` chỉ `customerHash`.
- **Admin**: C1 danh bạ (tìm/lọc, mask, scope chi nhánh, phân trang), C2 chi tiết (stats, sửa tên/ghi
  chú → `customer.update`, reveal một lần → `customer.reveal-phone`, export, tạo yêu cầu xóa), C3 hàng
  đợi 4 tab (hạn từ `deadlineHours`, quá hạn tô đỏ); quyền `customer.read|manage|erase`; link S4→C2.

Gate: lint, typecheck, test 166 file / 1222, `strapi build` (server + admin), **`check:ordering`
61/61 hai lượt liên tiếp**, `ordering:openapi` regen (78 paths) — chi tiết Completion record trong
plan. **Open:** manual UAT browser (checklist trong plan); merge về `feat/ordering` theo quyết định
chủ dự án.

2026-10-13: **Ordering O8 (khuyến mãi, đánh giá đơn) — targeted gates** trên `feat/ordering-o8`. Mã giảm giá
(một mã / sinh hàng loạt), khuyến mãi tự động, miễn phí/giảm phí giao, giảm theo món/danh mục, giới hạn tổng /
mỗi mã / mỗi khách, đơn đầu, chọn phương án giảm nhiều nhất; giữ lượt dưới khóa (`promotion-race.mjs` 2 process),
trả lượt khi hủy, sửa đơn giữ khuyến mãi. Quote **không nhận số điện thoại** (khuyến mãi theo số ở
`pendingPromotions`, quyết ở create). Đánh giá 1–5 sao theo token đơn, email mời 60 phút sau hoàn tất, alert
`low-rating` (≤ 2★), xóa ghi chú sau 365 ngày. Màn K1–K4, R1–R2, thêm vào chi tiết đơn, báo cáo, cài đặt, tạo đơn
hộ. Sửa luôn `Dialog.Title` không tồn tại ở 3 dialog cũ và 4 route O7 thiếu trong OpenAPI. Gate: lint, typecheck,
vitest 620, `build:ordering`, `strapi build`, 5 script mới + 29 script bị ảnh hưởng PASS (danh sách trong Completion record). Chưa UAT giao diện. Plan + Completion record:
[`plans/ordering-o8-promotions-rating.md`](plans/ordering-o8-promotions-rating.md).

2026-10-13: **Ordering O7 (giờ đặc biệt, giới hạn phần mỗi ngày, sửa đơn, trang người giao) — automated gate** trên
`feat/ordering-o7`, đã merge vào `feat/ordering` (`f7e8da4`). Review fix `faefa33`: trang người giao lọc ngày/trạng thái
bằng SQL (tối đa 200), bỏ nút "Bắt đầu giao" (giao do quản lý trên bảng giao). Merge thêm mã audit `order.edit`,
`catalog.daily-limit` và mẫu email `customer.order-updated` vào danh mục mẫu O10. Gate sau merge: lint, typecheck,
vitest 569 test plugin, `build:ordering`, `strapi build` bật plugin, 11 script O7/O15/O10 PASS. Commit tính năng `30caf1d`, `04699b3`, `2393d42`, `28faa8e`, `2a96316`,
`57090f2`, `d0541bf`; tài liệu và seed UAT ở commit chứa dòng này. Giờ đặc biệt theo từng cách nhận, thay giờ
thường và ngày nghỉ của đúng ngày đó, có trên `GET /config` (cả khối `branch.delivery` khi bật giao). Giới hạn
phần theo chi nhánh và ngày kinh doanh; catalog trả `dailyLimit` và `sold-out-today`; quote/create trả
`ITEM_SOLD_OUT`. Sửa đơn khi đang chờ nhận hoặc đang chuẩn bị (đơn giao thêm lúc sẵn sàng): tính lại tổng, hoàn
phần dư hoặc gửi link phần chênh, không đổi trạng thái group. Trang **Giao của tôi** chỉ đơn được gán trong
ngày; không có `order.read` thì thu tiền hoặc chuyển bước đơn người khác là 404. UAT server worktree này: cổng
1352, DB `salanca_ordering_o7_uat` (không đụng `salanca_ordering_uat`). Gate trên `salanca_ordering_o7`: lint, typecheck, vitest 162 file / 1131 test, `check:ordering` lượt 1 **51/51**. Lượt 2 bị dừng. Chưa chạy `check:phase3`, các smoke CMS/đặt bàn/SePay/giao, và `strapi build` bật/tắt plugin. **Open:** chưa bấm Admin trên trình duyệt, kể cả điện thoại 360px
(chrome-devtools không bắt tay). Nếu khung Admin không dùng được trên điện thoại, hướng sau O7 là trang nhẹ
ngoài chrome, không magic link. Plan:
[`plans/ordering-o7-ops-extras.md`](plans/ordering-o7-ops-extras.md); API:
[`ordering-api-contract.md`](ordering-api-contract.md); nhân viên:
[`ordering-staff-guide.md`](ordering-staff-guide.md).

2026-10-13: **Ordering O10 (nền mở rộng: webhook ra ngoài, OpenAPI, CSV catalog, mẫu email) — implemented + automated verification passed, chờ manual UAT** trên
`feat/ordering-o10` (tách từ `feat/ordering`; chưa merge/push). Bốn khối theo
[`phases/phase-ordering-10-extensibility.md`](phases/phase-ordering-10-extensibility.md):

- **Webhook ra ngoài** (X1 `Cấu hình → Webhook`, quyền `webhook.manage`): đăng ký endpoint https với bí mật
  `whsec_…` hiện một lần (lưu mã hóa, xoay có 24 giờ ký kép); danh mục sự kiện công khai `GET /ordering/webhooks/events`;
  fanout từ outbox ghi `webhook-delivery` rồi dispatcher gửi — payload `{id,type,apiVersion:"2026-10",occurredAt,data}`
  **không PII** trừ khi bật `includeCustomer` (xác nhận trong UI, ghi change-log); ký
  `X-Ordering-Signature: t=…,v1=…` (HMAC-SHA256 của `t.rawBody`); thử lại 1/5/15/30 phút + 1/2/4/8/12/24 giờ,
  tự tắt sau 50 lỗi liên tiếp + alert `webhook-endpoint-disabled`; ping/resend từ màn hình. Chống SSRF: resolve DNS,
  từ chối IP nội bộ, ghim IP đã kiểm, không theo redirect.
- **OpenAPI 3.1**: `GET /api/v1/ordering/openapi.json` (public) + `docs/ordering-admin-openapi.json` (71 path,
  `pnpm run ordering:openapi`); gate `openapi.mjs` bắt route thiếu tài liệu. Màn tĩnh X2 **Cấu hình → Tài liệu API**
  (link OpenAPI, hướng dẫn Swagger/Postman, mã kiểm chữ ký Node/PHP).
- **CSV catalog** (X3 `Món → Nhập/xuất`): xuất `products.csv`/`modifiers.csv` (BOM, formula-guard), nhập
  chạy thử → áp trong một transaction khớp slug/SKU/code, khóa phiên bản `CATALOG_IMPORT_STALE`, ≤ 2 MB / 5000 dòng,
  change-log `catalog.import`.
- **Mẫu email** (X4 `Cài đặt bán hàng → Mẫu email`, quyền `settings.manage`): 14 mẫu × VI/EN, biến allowlist
  (`TEMPLATE_VARIABLE_UNKNOWN`), markdown giới hạn link-https, xem trước/gửi thử/khôi phục mặc định, change-log
  `notification-template.*`; mẫu hỏng → dùng mặc định + alert `notification-template-broken`, mail vẫn đi.

Gate đầy đủ: lint, typecheck, test (165 file / 1210), `check:ordering` hai lượt, `check:phase3` tắt/bật,
`strapi build` (server + admin) — chi tiết Completion record trong
[`plans/ordering-o10-extensibility.md`](plans/ordering-o10-extensibility.md). **Open:** manual UAT (đăng ký endpoint
thật + kiểm chữ ký, xuất→sửa→nhập CSV trong Excel, sửa/gửi thử mẫu email — checklist trong phase spec) và quyết
định merge của chủ dự án. Tài liệu mới: [`ordering-integrations.md`](ordering-integrations.md).

2026-10-12: **Ordering O15 (lịch sử thay đổi) — implemented, targeted gates passed, chưa UAT giao diện** trên
`feat/ordering-o15`, merge vào `feat/ordering`. Màn **Cấu hình → Lịch sử thay đổi** (quyền `audit.read`; xuất CSV thêm
`export`): lọc ngày/người/nhóm/chi nhánh/mã đơn-tên món, trước → sau, các dòng cùng request, link từ chi tiết đơn. Bù log luồng
đơn qua timeline (chuyển bước, từ chối, hủy, hủy bớt món, thu tiền mặt, xác nhận đơn hộ, giao/thất bại/giao lại) và
`payment-link.issue`; sửa ghi trùng log danh mục; chuỗi băm sau commit (job `audit-chain`) + cảnh báo `audit-tampered`.
Gate có chọn lọc (quy ước từ O7): lint, typecheck, unit test plugin, `audit-coverage`/`audit-log` mới + 12 script bị ảnh
hưởng (`schema`, `review-additions`, `admin-orders`, `sepay-review`, `sepay-manual`, `payment-refund`, `cash-closing`,
`catalog-availability`, `catalog-categories`, `delivery-assignment`, `alerts-engine`, `ops-status`), `strapi build` bật
plugin — exit 0. Plan: [`plans/ordering-o15-audit-log.md`](plans/ordering-o15-audit-log.md).

2026-10-12: **Ordering O6 (vận hành và go-live) — đóng theo quyết định chủ dự án (2026-10-12): automated verification passed, bỏ UAT tay** trên
`feat/ordering-o6`, gộp vào nhánh tích hợp `feat/ordering` (đã push; chưa merge `main`). 8 commit `97b72ae`…`5d5b9eb` + sửa sau review
`61897da`, `b0e45a2`, `a79eb6f`, `78e4ae1`: cảnh báo đủ 8 rule (gộp, critical, "đã biết", người nhận theo vai trò + scope,
ngưỡng sửa trong Admin), trang Tình trạng vận hành, chốt tiền mặt theo người thu (bảng `cash-closing` mới, bản sửa có lý do),
báo cáo theo ngày kinh doanh từ sổ + snapshot, xuất CSV đơn (quyền `export`, ≤ 92 ngày / 10.000 dòng), job thời hạn lưu,
runbook vận hành + checklist go-live. Gate: lint, typecheck, test 160 file / 1106, `check:ordering` 47/47 hai lượt,
`check:phase3` tắt/bật, smoke đặt bàn/tự lấy/SePay/giao, `strapi build` bật/tắt — exit 0 (`check:phase3` bật plugin
đạt sau khi sửa test media của app chập chờn khi máy tải nặng — xem Completion record O6). **Open:** UAT tay các màn O6; bước 7
(Cloudflare, backup, bật production) và cổng go-live (SePay thật, kế toán, pháp lý, email) — việc của chủ dự án.
Plan: [`plans/ordering-o6-ops-golive.md`](plans/ordering-o6-ops-golive.md). Đã lên plan nháp O7–O16 + OP
([`plans/ordering-roadmap.md`](plans/ordering-roadmap.md)); O7 đang code ở worktree `salanca-backend-o7`.

2026-10-12: **Ordering O5 (giao tận nơi, quán tự giao) — automated + manual UAT passed** trên
`feat/ordering-o5` (chưa push/merge; 8 commit `407aa65`…`c0695bb` + sửa sau review `6f68dbc`, `49d3417`, `8a1a8df`, `f9c98db`).
Spec `phase-ordering-5-delivery.md` vẫn "chờ duyệt": duyệt spec/đóng phase là quyết định chủ dự án.
**Sửa sau review:** `transition { to: canceled }` bị từ chối (hủy chỉ qua `/cancel`, quyền `order.cancel`,
có hoàn tiền); từ chối/hết hạn/hủy khi đã có tiền thì hoàn luôn, cả đơn tự lấy (chuyển khoản: phiếu
`pending`); `outbox-two-process.mjs` hết chập chờn (barrier + lease dài cho worker B). Cảnh báo `pg` concurrent query đến từ
populate của `@strapi/database`, `pg` khóa 8.20.0 — nợ upstream, chưa sửa.
Khách chọn giao tận nơi theo mã xã/phường (`communeCode`, alias `wardCode`), phí giao tính ở server
và nằm trong `fulfillmentAmount`; snapshot địa chỉ lưu mã + tên lúc đặt. Vùng giao cấu hình trong
branch `deliverySettings` (match theo mã xã, rule theo giá trị đơn, ưu tiên, đơn tối thiểu, phí 0/đồng/
unavailable). 3 workflow riêng cho đơn giao (`delivery-prepay`, `delivery-accept-then-pay`,
`delivery-pay-on-pickup`); leg `ready → out-for-delivery → delivered`, `failed → ready` thử lại.
Board Admin "Đơn giao": lọc sẵn sàng/đang giao/thất bại/tất cả + assignee (unassigned/mine/other/nhân
viên), gán nhân viên quán trong scope hoặc xe ngoài (tên hãng, mã vận đơn, URL tracking), bắt đầu giao,
báo thất bại kèm lý do bắt buộc, thử lại, thu tiền và giao (cash tại cửa). Email khách VI/EN dùng
wording giao hàng riêng (đang giao, thất bại + lý do, đã giao). Sửa `paymentByToken` và cửa sổ hủy
chọn settings theo receive kind (trước chỉ đọc `pickupSettings`). Gates (chạy lại sau review, tuần tự): lint, typecheck, test
159 file / 1097, `check:ordering` 41/41 hai lượt liên tiếp, `check:phase3` off/on, `smoke:reservation-form`,
`smoke:ordering-pickup`, `smoke-ordering-sepay.mjs`, `node scripts/smoke-ordering-delivery.mjs` mới,
`strapi build` bật/tắt — tất cả exit 0. **Danh mục hành chính vẫn TEST FIXTURE** (XT01/XT02, 5 xã) —
chưa có nguồn chính thức; vùng/phí/đơn tối thiểu Salanca là fixture test. Không tích hợp hãng giao.
`/slots` chỉ pickup. **Manual UAT browser passed** trên `salanca_ordering_uat` (DB riêng của
uat-server — đã tách sau khi `run-all.mjs` truncate `salanca_ordering_test` giữa session): gán
`lan-q1` → bắt đầu giao → thất bại kèm lý do (bắt buộc) → giao lại → thu tiền và giao; chi tiết
đơn `ĐÃ GIAO`/`ĐÃ TRẢ`, tiền mặt do lan-q1 thu; quote bậc thang 15.000đ/0đ và `DELIVERY_UNAVAILABLE`
ngoài vùng qua public API. **Open:** nguồn danh mục hành chính + bảng phí thật, quyết định push/merge.
Plan: [`plans/ordering-o5-delivery.md`](plans/ordering-o5-delivery.md); API:
[`ordering-api-contract.md`](ordering-api-contract.md); nhân viên:
[`ordering-staff-guide.md`](ordering-staff-guide.md).

2026-10-12: **Ordering O4 — sửa sau review** (7 commit `fix(ordering)`, `1555fe2`…`67c1b15`): đơn đã trả đủ
không còn bị hết hạn; ghi tay mã mà SePay đã gửi trả 409 `PAYMENT_ALREADY_RECEIVED`; màn duyệt lọc trạng thái
trong DB và định vị giao dịch đối soát; gán vào đơn đã đóng trả 409 `ORDER_CLOSED`; mở lại đơn ghi bước như
transition; webhook/đối soát không có mã tham chiếu vẫn chống trùng; ASAP 24/7 không còn lỗi trước nửa đêm (lỗi O3).
Gates chạy lại đủ: lint, typecheck, test 155 file / 1067, `check:ordering` 38/38, `check:phase3` off/on,
`smoke:reservation-form`, `smoke:ordering-pickup`, smoke SePay, `strapi build` bật/tắt. Vẫn chưa UAT SePay thật.

2026-10-11: **Ordering O4 (SePay chuyển khoản) — automated verification passed** trên
`feat/ordering-o4` (chưa push/merge). Webhook SePay ký HMAC và ACK `{success:true}`; luật khớp đủ 7 lý do;
khớp đủ thì chuyển workflow. Màn duyệt theo chi nhánh, một người thắng. Ghi tay và webhook cùng mã ngân hàng
cùng số tiền gắn một event. Đối soát hai process ghi một lần. Hết hạn thì đơn `expired`. Hoàn chuyển khoản ở
`pending` đến khi ghi mã. Cảnh báo khi webhook, khớp hoặc đối soát lỗi. Link thanh toán `#p=` chỉ mở trang QR
và có thể kéo hạn thanh toán. Hủy một phần tạo phiếu hoàn `pending` đến khi settle. Gates: lint, typecheck,
test 155 file / 1066, `check:ordering` 38/38, `check:phase3` plugin off/on, `smoke:reservation-form`,
`smoke:ordering-pickup` và `node scripts/smoke-ordering-sepay.mjs` trên `salanca_ordering_test`; `strapi build`
bật và tắt plugin. **Open:** chưa UAT SePay thật (chưa có tài khoản thử), nút sao chép link trên Admin chưa
kiểm trên Chrome, quyết định push/merge. Plan: [`plans/ordering-o4-sepay.md`](plans/ordering-o4-sepay.md).

2026-10-11: **Ordering O3 (tự lấy + tiền mặt + hộp đơn) — automated verification passed** trên
`feat/ordering-o3` (chưa push/merge). API storefront công khai (chi nhánh, cấu hình, slot, quote, tạo đơn có
Idempotency-Key + Turnstile + đồng ý dữ liệu, đọc/hủy bằng `X-Order-Token`, tra cứu mã + SĐT không lộ dữ liệu);
slot có sức chứa khóa theo slot; 3 workflow tự lấy; "Thu tiền và giao" một transaction; hủy món hoàn đúng số
đã chia; email VI/EN từ outbox không gửi trùng; cảnh báo đơn chờ nhận; SSE realtime theo scope; màn Admin S1–S9
(hộp đơn, hộp thoại đơn mới ở mọi trang, chi tiết, tạo đơn hộ, chi nhánh, nhân viên, cài đặt). Gates: lint,
typecheck, test 147 file / 1021, `check:ordering` 29/29, `check:phase3` plugin off/on, `smoke:reservation-form`
và `smoke:ordering-pickup` trên `salanca_ordering_test`. **Open:** UAT Admin thủ công, chọn biến thể khi đặt,
quyết định push/merge. Plan: [`plans/ordering-o3-pickup-cash.md`](plans/ordering-o3-pickup-cash.md); API:
[`ordering-api-contract.md`](ordering-api-contract.md); nhân viên: [`ordering-staff-guide.md`](ordering-staff-guide.md).

2026-10-10: **Ordering O2 (module catalog) — automated verification passed sau review fix** trên
`feat/ordering-o2` (chưa merge/push). Catalog plugin
hoàn chỉnh: 9 content type `plugins_ordering_catalog_*` (danh mục cây, sản phẩm, biến
thể, giá, nhóm/tùy chọn, khung giờ bán, trạng thái theo chi nhánh, slug theo locale);
`localized-text` + editor `modifierGroups`/`bundleSlots` custom field; adapter
`ordering-catalog` thật → `Sellable` (ghi đè giá tùy chọn, combo, tạm hết, khung giờ);
3 public route read-only có rate limit + cache; màn Admin **Danh mục** (kéo-thả, move
transaction, quy tắc xóa) và **Tạm hết món** (scope chi nhánh, EOD/giờ cụ thể) với
permission `catalog.manage`/`catalog.toggle-availability`; extension app
`src/extensions/ordering/strapi-server.ts` (`isFeatured` sống qua 2 boot); snapshot
đơn (categories, variant, options, combo) kiểm chứng end-to-end; change-log trên mọi
write catalog qua Document Service; hướng dẫn nhân viên
[`ordering-catalog-guide.md`](ordering-catalog-guide.md). Review fix đưa validator
browser-safe vào `src/plugins/ordering/shared/catalog/`, thêm import guard + Admin build;
gates lint, typecheck, test (137 file / 978), build, `check:ordering` 20/20 và cả hai
`check:phase3` trên `salanca_ordering_test` (plugin off/on) đều EXIT=0. **Open:** UAT
Admin thủ công theo spec và quyết định merge/push của chủ dự án. Plan + completion record:
[`plans/ordering-o2-catalog.md`](plans/ordering-o2-catalog.md).

2026-10-10: **Ordering O1 (lõi đơn hàng) — closed** (Admin UAT passed: no internal plugin table in Content Manager or Content-Type Builder; branch pushed for backup, not merged). Earlier note: automated verification passed on `feat/ordering-o1` (18 commits, not pushed, not on `main`). Order core runs by service and tests only: 20 internal content types hidden from Content Manager/CTB, safe-integer Money, 9-step pricing pipeline with largest-remainder allocation (mockup numbers reproduced), workflow engine with graph validation and `order.status` projection, payment/refund ledger with unique provider events, transactional outbox claimed with `FOR UPDATE SKIP LOCKED` + lease (500 events delivered exactly once across two processes), idempotency keys, holds, branch scope enforced in every service and through Strapi's permission engine, business date per branch cutoff, branch/change-log/partial line cancel. Gates: lint, typecheck, `test` (129 files / 857), `build`, `check:phase3` with the plugin off and on, `check:ordering` (11 scripts) — all on `salanca_ordering_test`. Found and fixed: disabling the plugin used to make Strapi drop every `plugins_ordering_*` table; tables are now reserved via core-store `persisted_tables`. **Open:** Admin UAT (internal tables hidden), push/merge decision. Plan and completion record: [`plans/ordering-o1-core.md`](plans/ordering-o1-core.md).

2026-10-10: **Ordering plugin track opened (owner decision).** Online ordering will be a generic, multi-industry local Strapi plugin (`src/plugins/ordering`, `plugin::ordering.*`), Salanca being the first client; Salanca content types (`menu-item`, `menu-category`, `menu-package`) and the seed stay untouched. Research, design contracts, owner answers and roadmap are in [`plans/ordering-roadmap.md`](plans/ordering-roadmap.md). Phases O0–O6 and OW are listed there. **Owner approved the specifications and authorized O0 implementation on 2026-10-10.** O0 automated verification is passed on `spike/ordering-plugin` for every O0 check (two real processes for job claiming, Strapi permission engine with real admin users, plugin migration runner, no generated REST routes, CORS preflight, extension surviving a plugin upgrade); decisions D1–D7 recorded. A desk-reading conclusion was corrected: a Strapi admin condition returning `null` is fail-closed, not fail-open. The step-1 stash was restored with `apply` and retained as a backup. No ordering code on `main`; O1 onward and the web implementation have not started. Admin UAT passed locally on 2026-10-10 (plugin menu, Content Manager/Content-Type Builder visibility, VI/EN custom field, Salanca content forms unchanged). The owner dropped the staging gate for O0, so **O0 is closed**; next is O1. Evidence is recorded in [`plans/ordering-spike-report.md`](plans/ordering-spike-report.md).

2026-10-09: **Revalidation webhook retries.** `deliverCmsWebhook` now times out each attempt at 10 s and retries network errors, timeouts, 429 and 5xx after 2 s / 10 s / 30 s; other 4xx are not retried. A final failure logs at error level. A publish made while the web restarts therefore still refreshes the site. Contract: [`cms-api-contract.md`](cms-api-contract.md).

2026-10-09: **Admin navigation cleanup.** `Email thông báo` moved from the main menu to Settings → Salanca. The `Xuất dữ liệu khách` screen is gone; a "Xuất CSV" button (date-range dialog, contacts list also picks newsletter) sits on the Yêu cầu đặt bàn and Tin nhắn liên hệ lists, injected into Content Manager `listView.actions`. The lead sidebar shortcuts now stay highlighted on their Content Manager list and edit views instead of "Quản lý nội dung". Export API and RBAC unchanged.

2026-10-09: **Staff notification recipients in Admin.** Staff notification recipients are managed per kind in Admin (Email thông báo) — automated verification passed; ready for manual UAT. Plan: [`plans/notification-email-settings.md`](plans/notification-email-settings.md).

2026-10-08: **Reservation workflow, guest receipt, lead CSV export** ([`plans/lead-workflow-confirmation-export.md`](plans/lead-workflow-confirmation-export.md), Parts A–C). `reservation-request.leadStatus` gains `confirmed` / `cancelled` / `no_show`, plus a private `staffNote` (≤ 2000 chars). Statuses live in `src/shared/lead-status`. The inbox has 7 tabs, workflow row actions, and status buttons plus a note editor in the detail modal (`POST /reservation-inbox/:documentId/note`). Dashboard "today/upcoming" skip cancelled and no-show bookings. Soft overlap now also counts `confirmed`. Guest receipt email, always on when SMTP is configured and the guest left an email (owner decision, no flag): VI/EN by `sourceLocale`, says "not yet confirmed". New `Xuất dữ liệu khách` screen with `GET /admin/lead-export/:kind` (`reservations|contacts|newsletter`, Vietnam-day range, 10,000-row cap, new RBAC action `lead-export.export`). CSV writer shared in `src/shared/csv`. No component changed, so the seed `schemaHash` is unchanged. Gates passed: lint, `verify:schema`, typecheck, `test` (613, including the previously failing `content-manager-labels.vi`), `build`, `smoke:reservation-form`. **Manual UAT open**: inbox workflow and note, Mailpit VI/EN receipt, three CSVs in Excel, export permission gating. Part D (opening hours, drinks) waits for owner data; opening hours are already wired end to end and need data only.

2026-10-06: **Media derivatives for direct `srcset`.** Upload breakpoints `w640/w960/w1280/w1920` (non-default names so derivative keys never collide with cached ones); every S3 write sends `Cache-Control: public, max-age=31536000, immutable` via upload `actionOptions` (the aws-s3 provider ignores non-ACL `s3Options.params`). New `media:backfill` (dry-run default, `--apply`, `--limit`) generates missing formats with Strapi's own generator and copy-in-place fixes headers. Plan: [`plans/media-derivative-backfill.md`](plans/media-derivative-backfill.md); runbook: [`media-storage-operations.md`](media-storage-operations.md). **Open:** staging + production backfill run with recorded counts, CDN purge. Admin Replace media now stores a fresh hash on the same row (no temporary row, name kept), keeps old objects, and sends a signed `media.replace` webhook so the web revalidates every page (decision 2026-10-06). `media:reconcile` loads the S3 SDK through the provider and can delete orphans (`--delete-orphans --apply`, 7-day grace, `protected-keys.txt`). Experience heritage artwork resolves from the media library by row name.

2026-10-04: **Admin lead triage.** Reservation inbox screen now filters by status (Mới/Đã đọc/Lưu trữ/Tất cả, with counts), searches name/phone (debounced), paginates (20/page) and lets staff archive/restore/re-mark-new via `GET /reservation-inbox/list` and `POST /reservation-inbox/:documentId/status` (same `admin::reservation-inbox.read` scope; live SSE/summary contract unchanged). Sidebar gains `Tin nhắn liên hệ` and `Yêu cầu đặt bàn` shortcuts to the Content Manager lists. Content Manager list columns, default sort (`createdAt DESC`) and page size for `reservation-request` and `contact-message` are declared in each schema's `config.listView` and applied by the existing label sync at bootstrap. Gates: typecheck, lint, `test` (399). **Manual UAT open**: filter/search/archive in Admin, sidebar permission gating.

2026-10-04: **Reservation inbox (admin near-realtime notify) implemented** ([`plans/reservation-inbox-realtime.md`](plans/reservation-inbox-realtime.md)). When a visitor submits the public reservation form, admins holding `admin::reservation-inbox.read` see a toast + floating unread pill within ~1s via authenticated SSE (`GET /reservation-inbox/stream`), with `summary?since=` polling every 20s as fallback and a dedicated `Hộp thư đặt bàn` screen (mark-read writes `status=read`; opt-in OS notification + sound per browser). In-process `EventEmitter` emits after `scheduleFormLeadNotify`; the public 201 contract and email notify are unchanged (`smoke:reservation-form` passes). Gates passed: typecheck, lint, `test` (372 tests), `build`. **Manual UAT open** (owner): two-tab toast check, offline reconnect dedupe, permission gating; plus hosting proxy SSE buffering check. Multi-instance deployments would need a distributed bus — Redis pub/sub deferred.

2026-10-04: **Form intake rate limiting hardens client-IP identity.** Contact and reservation limits now key on the real visitor IP: `salanca-web` forwards `x-salanca-visitor-ip` authenticated by `x-salanca-intake-secret` against `FORM_INTAKE_SHARED_SECRET` (constant-time compare; mismatch falls back to socket IP); `TRUST_PROXY=true` honors `X-Forwarded-For` behind a reverse proxy. Production boot warns when the secret is missing. Contract: [`cms-api-contract.md`](cms-api-contract.md), [`security-baseline.md`](security-baseline.md).

2026-10-04: **Admin activity audit log implemented** (backend port of the BDS design, [`plans/admin-audit-log.md`](plans/admin-audit-log.md)). Append-only `audit_events` ledger; capture via EventHub (CMS docs/media), `admin-audit-http` middleware (login, role permissions, API/transfer tokens, webhooks) and upload extension wrappers (media delete, folder update — no `@strapi/*` dist patching). Read-only Vietnamese Admin screen `Nhật ký hoạt động` (list + detail drawer + CSV export, 3 RBAC actions, registered in every build mode). Reads the existing `ctx.state.requestId` — no new request-correlation middleware. **New required env var:** `AUDIT_IDENTIFIER_HASH_SECRET` (boot throws if missing; see `.env.example`). Automated verification: see the dated run below; **manual UAT open** (new checklist rows in [`admin-roles.md`](admin-roles.md)).

2026-10-03: Backend-only owner seed now ships all 166 localized published marketing records and 24 approved original images. One command: `node scripts/seed-production-content.mjs`; no SFTP, bind mount, sibling checkout or pg_dump requirement. Existing S3/database config is reused; checksum/schema/draft preflight and automatic marketing JSON recovery snapshot precede upsert/publish. Local preview passed; production apply remains unrun. Runbook: [content seed](content-bundle-deploy.md).

Historical developer transport (superseded operator workflow), 2026-10-03: Added `content:pack` / `content:deploy` for published VI/EN marketing snapshots plus media. Explicit apply requires matching target schema, media checksums, no unpublished target edits, target database name and a successful PostgreSQL backup. Production apply remains unrun; Git push does not deploy CMS data. Runbook: [content bundle deploy](content-bundle-deploy.md).

Owner refresh: [Phase 9](phases/phase-09-owner-data-refresh.md). Local CMS contains the revised DOCX story, 56-item menu in VI/EN and five PDF photos at 3,840 pixels wide. Frontend has nine actual menu tab panels. Editorial cards support optional localized detailBody. Local PostgreSQL was backed up before scoped seed; production has not changed. Older sections below describe prior milestones.

## Executive status

**Coding for Phases 4–6 is in tree (2026-08-03):** `/api/v1`, CORS, public read bootstrap, seed/verify/smoke:api, media helpers, invariants, Vitest, API contract.

**Pattern-lift follow-up (2026-08-03, post-seed real client data):** modular seed (`scripts/seed-salanca-demo/*`), Admin VI labels + field-hint hide, Content Manager label bootstrap (auto-discover schemas with `config.metadatas`; empty placeholder/description stripped), ESLint in `npm run check`, `data:export|import|transfer`, read-only `media:reconcile`. Review fixes: no ghost managedModels allowlist, warn on missing CM fields, dead shim/example/types removed. Automated: lint + unit tests + typecheck + verify:schema (seed/smoke need Postgres).

**Recent BDS lift Waves 0–4 (2026-08-04):** Plan at [`plans/be-recent-bds-lift-plan.md`](plans/be-recent-bds-lift-plan.md). Implemented:

- Wave 1: `env.helper`, normalization, production S3 assert, provider contract tests
- Wave 2: safe map URL normalize, social hostname policy, `shared.image` focal points + document middleware
- Wave 3: slim signed CMS webhooks (publish/unpublish, HMAC, no audit CT)
- Wave 4: opt-in editorial WebP pipeline (`MEDIA_PROCESSING_ENABLED`, sharp, no watermark/private-source)

Still not ported (by design): end-user auth/email, projects, property watermark.  
**Tooling align (2026-08-04):** Strapi **5.51.1**, pnpm **11.7.0**, full `plugins`/`middlewares` config test suite.

**Forms MVP contact intake (2026-08-04):** `contact-message` lead CT + Public create-only + validation/honeypot + `smoke:contact-form`. Spec: [`phases/phase-forms-contact-message.md`](phases/phase-forms-contact-message.md). No email/CAPTCHA.

**Forms-2 reservation intake (2026-08-05):** `reservation-request` lead CT + menu later/now + soft same-slot overlap + in-process IP rate limit + `smoke:reservation-form`. Spec: [`phases/phase-forms-reservation-request.md`](phases/phase-forms-reservation-request.md). Not a booking engine; no email/CAPTCHA/Redis.

**Local self-test re-run (2026-08-03):** green on Windows PostgreSQL 17 (`localhost:5432`, DB `salanca_cms`, same host/user pattern as `batdongsan-cms`). Campaign date invariant already in code. Seed script fixes applied (location EN slug, campaign `shared.cta` shape).

Still open (ops/human): Phase 0 Admin UAT (manual), named host/DB/S3 providers, 4C multi-account UAT, Phase 7 staging. Wave 2+ (map URL, focal points, webhooks, WebP) per recent-lift plan.

**Approved-content seed + full FE image wiring (2026-08-26):** `npm run seed:content`
writes the client-approved copy and photography from `salanca-web` into every marketing
single type and collection, both locales. Payload is generated by the frontend
(`pnpm run export:cms-seed`) so the copy has one source. Pipeline: [`content-seed-pipeline.md`](content-seed-pipeline.md).
Also added `npm run token:preview` for the frontend's `STRAPI_PREVIEW_TOKEN`.

## Implemented baseline

- Standalone Strapi `5.51.1` TypeScript backend (pnpm 11.7.0; aligned with `backend-bds`).
- PostgreSQL-only configuration with PostgreSQL 16 used locally.
- Vietnamese (`vi`) default locale and English (`en`) secondary locale.
- Fixed content types and shared components with generated Strapi Admin CRUD.
- Document Service enforcement for relation and locale invariants (menu + campaign dates).
- Schema, CRUD, i18n, typecheck, unit tests (Vitest), and production Admin build gates.
- Public API: **read allowlist** provisioned at bootstrap; create/update/delete remain denied.
- **Phase 4A:** `API_REST_PREFIX=/api/v1`, CORS allowlist helper, modular locale bootstrap, architecture doc.
- **Phase 4B code:** media-storage helper + optional S3 when `S3_BUCKET` set, media delete reference guard, `@strapi/provider-upload-aws-s3`, `docs/media-storage-operations.md`.
- **Phase 4C docs:** `docs/admin-roles.md` (manual role UAT still open).
- **Phase 5 code:** `npm run seed:demo` + `npm run verify:seed`.
- **Phase 6 code:** public permission provisioner, `docs/cms-api-contract.md`, `npm run smoke:api`, `npm run check:phase6`.

## Planning baseline (drafted, not implemented)

| Document | Purpose |
| --- | --- |
| [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md) | Overview: which Nhà Thật patterns to port; sequence; non-goals |
| [`phases/phase-00-close-uat-and-decisions.md`](phases/phase-00-close-uat-and-decisions.md) | Close Phase 1–3 UAT + platform decisions |
| [`phases/phase-04-hardening-media-roles.md`](phases/phase-04-hardening-media-roles.md) | 4A config/tests, 4B S3 media, 4C Admin roles |
| [`phases/phase-05-seed-content.md`](phases/phase-05-seed-content.md) | Idempotent seed from prototype |
| [`phases/phase-06-api-contract-and-qa.md`](phases/phase-06-api-contract-and-qa.md) | Public read allowlist + API contract + smokes |
| [`phases/phase-07-staging-and-handoff.md`](phases/phase-07-staging-and-handoff.md) | Staging, backup drill, FE handoff pack |
| [`phases/phase-08-vietnamese-admin-editor-ux.md`](phases/phase-08-vietnamese-admin-editor-ux.md) | Optional editor-facing Vietnamese Admin UX; planned only, not authorized implementation |

## Recorded automated verification

The committed Phase 2 and Phase 3 verification reports record successful runs of:

```powershell
npm run verify:schema
npm run smoke:crud
npm run smoke:i18n
npm run typecheck
npm run build
npm run check:phase3
```

**Re-run 2026-08-03 (local Postgres `salanca_cms` on 5432, Node 22.22.3):**

| Gate | Result |
| --- | --- |
| `npm run verify:schema` | Pass |
| `npm run typecheck` | Pass |
| `npm run test` (40 tests) | Pass |
| `npm run smoke:crud` | Pass |
| `npm run smoke:i18n` | Pass |
| `npm run build` | Pass |
| `npm run seed:demo` | Pass (after seed script fixes) |
| `npm run verify:seed` | Pass |
| `npm run smoke:api` | Pass (public read 200; public write 403) |

Local env notes: `.env` aligned with batdongsan local Postgres (port `5432`, user `postgres`); Docker Compose on `5433` remains optional. Do not commit `.env`.

### Structured logging (2026-10-04)

Backend logs are JSON lines per log contract v1 (`@tanngo11/log@0.4.6`).

- Each request has one `http.request` line and a server-issued `X-Request-ID`.
- Unhandled errors are logged once.
- Node process warnings carry their stack.

Gates passed: lint, `verify:schema`, typecheck, build, and the logging tests.

Known failing test, which predates this change and also fails on `main`:
`content-manager-labels.vi.test.ts` ("covers every field in Salanca API schemas").

Plan: [`plans/structured-logging.md`](plans/structured-logging.md).

## Open acceptance gates

### Manual Admin UAT (Phase 0)

- Confirm only VI and EN are available and VI is selected by default.
- Complete the VI → EN localization workflow through Strapi Admin.
- Verify draft, publish, and unpublish independently per locale.
- Reuse one media asset with localized alt text and caption.
- Verify required-field, duplicate-slug, and protected-relation error UX.
- Confirm decimal prices survive browser save and reload.
- Confirm search, filter, sort, and labels are usable for editors.

Use [`cms-editor-guide.md`](cms-editor-guide.md) and the manual sections of the Phase 2 and Phase 3 verification reports.

### Owner and platform decisions (Phase 0 → blocks 4B/7)

Named humans and accepted choices are still required for:

- Strapi hosting provider.
- Managed PostgreSQL provider and backup retention.
- S3/R2-compatible media provider and lifecycle policy.
- Production domains and CORS allowlist.
- Node 24 staging and production validation owner.

Also confirm or reject pattern decisions in the lift plan (S3 every env, `/api/v1`, bootstrap public permissions).

Role labels such as "project owner" are not named accountable humans. Record these decisions in [`cms-technical-decisions.md`](cms-technical-decisions.md) before Phase 4B/7 implementation.

### Security follow-up

- The latest recorded audit is dated 2026-07-19 and includes one high transitive Vite advisory plus lower-severity findings.
- Re-run the audit against the public npm registry before staging.
- Do not run `npm audit fix --force`; the recorded remedy is an unacceptable Strapi major-version downgrade.
- Upgrade Strapi only as a dedicated reviewed change with backup and full verification.

See [`security-baseline.md`](security-baseline.md).

## Known functional follow-up

- Cross-field campaign validation for `endsAt >= startsAt` **is implemented** (`campaign-invariants.helper` + Document Service middleware + unit tests).
- Production media storage (S3 every env like batdongsan), staging, backup, and FE integration remain ops / later phases.
- Manual Admin UAT checklist still open (human click-through).

## Frontend integration note (2026-08-06)

`salanca-web` Phase 20 wires all 8 marketing pages to Strapi single types via
field-level adapters + static fallback. Home seed copy in
`scripts/seed-salanca-demo/pages.mjs` is aligned with FE `homePageCopy` for
mapped fields. Forms POSTs (contact/reservation) were already in tree.

FE follow-up: ~~CMS SEO → `generateMetadata`~~ (done 2026-08-06).
~~Collection media URLs~~ (menu/gallery/campaign overlay by slug/index).
~~Campaign detail indexability + sitemap~~. ~~Restaurant JSON-LD~~ (confirmed
contact fields only; hours/price still open).
~~global-setting → header/footer/contact~~ (done 2026-08-06).

## Next authorized work

1. ~~With Postgres up: seed + smoke:api~~ — done 2026-08-03 local.
2. ~~Recent BDS lift Waves 0–4~~ — 2026-08-04 (see plan; Wave 5 Strapi patch optional/separate).
3. ~~Forms MVP contact-message BE~~ — code in tree 2026-08-04; run `pnpm run smoke:contact-form` with Postgres; manual Admin triage UAT open.
4. ~~Forms-2 reservation-request BE~~ — code in tree 2026-08-05; run `pnpm run smoke:reservation-form` with Postgres; manual Admin triage UAT open.
5. ~~FE Phase 20 CMS page wiring~~ — done 2026-08-06 in `salanca-web` (fallback when CMS off).
6. ~~FE CMS SEO metadata~~ — done 2026-08-06 (`buildRouteMetadata` / `loadPageSeo` on 8 marketing routes).
7. ~~FE collection media + campaign detail SEO + Restaurant JSON-LD~~ — done 2026-08-06.
8. Phase 0 manual Admin UAT (`docs/cms-editor-guide.md`) + create first Admin user via `/admin`.
9. Named platform decisions (host/DB/S3) when client ready; optional local S3 mirror of batdongsan CloudFly vars.
10. Phase 4C multi-account Admin UAT per `docs/admin-roles.md`.
11. Phase 7 staging + ops handoff pack.
12. Automation: ~~CAPTCHA~~ Cloudflare Turnstile (opt-in, 2026-08-06); ~~email notify~~ Resend SMTP + `FORM_NOTIFY_TO` (opt-in BDS pattern, 2026-08-06); Redis/distributed rate limit still open.
13. ~~Optional FE: global-setting → header/footer/contact~~ — done 2026-08-06 in `salanca-web`.
14. ~~Optional FE: full menu collection content~~ — done 2026-08-06 (`menu-packages` + `menu-items` replace buffet/rodizio/cuts/a-la-carte when published).
15. ~~Optional FE: full campaign + draft preview + logo + Restaurant hours JSON-LD~~ — done 2026-08-06 in `salanca-web`.
16. Optional: priceRange on Restaurant schema after client confirm; Phase 0 Admin UAT; Phase 7 staging.

## Evidence

- 2026-10-03 follow-up release: homepage gallery/process/booking/hero restoration, CMS-editable hero decoration and 43 approved originals are ready for release. Local schema/typecheck, release tests and browser VI/EN checks passed. Production content apply is not performed by a Git push; use the shipped restore command after backend deployment. Frontend now handles a missing optional artwork field during rolling deployments. Dependency audit: 37 high, 56 moderate, 5 low, zero critical; no dependency changes in this release. Production Experience HTTP 500 root cause awaits server logs.

- 2026-10-03: Homepage space gallery restored locally in VI/EN with three approved CMS/S3 photos; see `plans/restore-home-space.md` for scope, recovery and verification. Production apply and push not run for this follow-up.

- [`bootstrap-report.md`](bootstrap-report.md)
- [`phase-02-verification.md`](phase-02-verification.md)
- [`phase-03-verification.md`](phase-03-verification.md)
- [`cms-technical-decisions.md`](cms-technical-decisions.md)
- [`security-baseline.md`](security-baseline.md)
- [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md)
- [`plans/be-recent-bds-lift-plan.md`](plans/be-recent-bds-lift-plan.md)

2026-10-03 restoration in progress: Experience/Space native blocks and approved original images are restored against frontend f3b9865 (working assumption: no remote branch named mockup). Additive flavorCards allows CMS-editable Experience photos without menu changes. The shipped release now contains 38 images and six gallery entries; scoped seed command is documented in the content runbook. Production apply remains unrun.

Local restoration verified 2026-10-03: scoped seed created 17 S3 media and updated 16 VI/EN page/gallery documents. FE adapter tests (23), BE seed tests (8), schema/typecheck/lint and desktop/mobile (375px) browser checks passed. Other release pages/menu/global settings were verified unchanged. Build/production E2E and production apply not run. Servers: FE 3001, BE 1338; no Git push for this restoration.

Homepage dish image restoration verified 2026-10-03: restored the approved f3b9865 image mapping for Picanha, Costela, Cupim, Panceta, Cordeiro and Camarão in 12 published VI/EN menu-item documents. Homepage continues to read their CMS media relations. The release now contains 40 approved originals. Run `node scripts/restore-home-dish-images.mjs` on the backend for this image-only restore; it blocks unpublished edits and writes a recovery snapshot before updates. A second local run exited successfully and reused all six S3 files (created=0, skipped=6). FE typecheck/scoped lint, two release tests and VI/EN homepage browser inspection passed; screenshot: `salanca-web/.tmp/restored-pages/home-dishes-vi.png`. Production apply and Git push remain unrun.


## Script cleanup — 2026-10-03

Removed 19 obsolete demo/deploy/one-off scripts and duplicate seed package aliases. Use `node scripts/seed-production-content.mjs` once for the complete approved release; separate page commands are unnecessary. Production internals, validation and backup tools are retained. Earlier commands in historical reports are superseded by content-bundle-deploy.md. No CMS writes or production apply during cleanup.
