# O3 — Đặt hàng tự lấy, trả tiền mặt: kế hoạch thực hiện

Status: Draft
Owner: tan_ngo (duyệt), Claude (thực hiện)
Last updated: 2026-10-10
Related phase: [`phases/phase-ordering-3-pickup-cash.md`](../phases/phase-ordering-3-pickup-cash.md)

## Goal

Luồng chạy trọn đầu tiên: khách đặt qua API, nhân viên xử lý trong Admin theo chi nhánh, thu tiền mặt
khi giao, khách nhận email.

## Non-goals

- Chuyển khoản (O4), giao tận nơi (O5), chốt tiền mặt và báo cáo (O6), web (OW).

## Current evidence

- O1, O2 xong.
- App đã có: hộp thư đặt bàn realtime bằng SSE (`src/admin/reservation-inbox`, `src/api/reservation-inbox`),
  rate limit theo IP trong process và Turnstile tùy chọn cho form, gửi email qua plugin email của Strapi
  (SMTP Resend). Plugin không import code app nên **viết lại** các phần tương tự bên trong plugin.
- `config/middlewares.ts` cho 4 header CORS.

## Decisions and assumptions

- Decision: setting chi nhánh nằm trong content type `branch` (tạo ở O1, contracts 21.1), ẩn khỏi Content
  Manager, sửa qua màn hình "Chi nhánh", không dùng `strapi.store`, để lọc theo chi nhánh và có nhật ký.
- Decision: `CaptchaProvider` `turnstile` nằm trong plugin; secret qua config app (`TURNSTILE_SECRET_KEY`
  đã có trong `.env`).
- Decision: rate limit trong process như form hiện có; ghi giới hạn khi nhiều instance.
- Assumption: plugin gửi email qua `strapi.plugin('email').service('email').send` (API của Strapi, không
  phải code app).

## Invariants

- Server luôn tính lại giá; client không gửi số tiền.
- Token xem đơn không bao giờ nằm trong path/query; chỉ lưu hash.
- "Thu tiền và giao" là một transaction.
- Mọi route Admin đi qua scope chi nhánh.
- Email lỗi không làm hỏng đơn; gửi lại từ outbox, mỗi bước một lần.

## Implementation steps

1. **Màn hình "Chi nhánh" và setting**
   - Files: `services/branch.ts`, `admin/src/pages/Branches/`, `routes/admin.ts`, `GET /branches` công khai.
   - Làm: `LocationOrderingSettings` (mục 19.6) gồm `SchedulePolicy` theo cách nhận hàng; validate zod;
     audit actor/time; đổi chỉ áp cho đơn mới; Salanca nhập 1 chi nhánh.
   - Verification: Vitest cho validate (giờ qua nửa đêm, lead time âm, provider không có); UAT sửa setting.
2. **Scheduling tự lấy**
   - Files: `providers/pickup-scheduling.ts`, `domain/scheduling/slots.ts`.
   - Làm: sinh slot theo giờ chi nhánh, lead time = max(chi nhánh, line), sức chứa slot, hold có hạn.
   - Verification: Vitest: slot quanh nửa đêm, ngày nghỉ, lead time 180; tích hợp: hai đơn tranh slot
     cuối → một bị từ chối.
3. **Product type `food` và 3 workflow**
   - Files: `domain/product-types/food.ts`, `domain/workflow/definitions/{pickup-prepay,
     pickup-accept-then-pay, pickup-pay-on-pickup}.ts`, `providers/pickup-fulfillment.ts`, `providers/cash.ts`.
   - Làm: bước có `isPublic`, `slaMinutes`; `selectWorkflow` theo `paymentTiming` của chi nhánh.
   - Verification: kiểm graph lúc bootstrap; Vitest cho chọn workflow.
4. **Captcha và rate limit**
   - Files: `providers/turnstile-captcha.ts`, `domain/rate-limit.ts`, `policies/rate-limit.ts`.
   - Verification: Vitest cho cửa sổ rate limit; tích hợp: token captcha sai → lỗi; vượt ngưỡng → 429.
5. **API storefront**
   - Files: `routes/content-api.ts`, `controllers/storefront.ts`, `domain/storefront/serialize.ts`.
   - Làm: `GET /ordering/config`, `POST /ordering/quote`, `POST /ordering/orders`, `GET /ordering/orders`,
     `GET /ordering/orders/payment`, `POST /ordering/orders/cancel`; header `X-Order-Token`,
     `Idempotency-Key`; lỗi chuẩn; trả token một lần khi tạo; link `#t=`.
   - Verification: script `scripts/smoke-ordering-pickup.mjs` (DB test) chạy đủ luồng; token trong query bị
     từ chối.
6. **CORS của app**
   - Files: `config/middlewares.ts` (+ `middlewares.test.ts`).
   - Verification: test middleware; preflight `OPTIONS` có hai header mới; `pnpm run smoke:reservation-form`
     vẫn đạt.
7. **Route Admin xử lý đơn**
   - Files: `routes/admin.ts`, `controllers/admin-orders.ts`, `services/cash-handover.ts`.
   - Làm: danh sách (lọc chi nhánh, trạng thái, `businessDate`, tìm theo mã), chi tiết + timeline, transition,
     từ chối có lý do, "Thu tiền và giao", hủy, hoàn tiền mặt; policy kiểm action + scope.
   - Verification: script scope 2 chi nhánh cho mọi route; "Thu tiền và giao" lỗi giữa chừng → không đổi gì.
8. **Hộp đơn realtime**
   - Files: `services/order-stream.ts` (EventEmitter trong process + SSE), `routes/admin.ts`
     (`GET /ordering/admin/stream`, `summary?since=`), `admin/src/components/OrderInboxWidget/`.
   - Làm: chỉ phát event của chi nhánh trong scope; polling 20 giây dự phòng; âm báo tùy chọn.
   - Verification: UAT hai tab; ghi giới hạn nhiều instance.
9. **Màn hình Admin**
   - Files: `admin/src/pages/{Orders, OrderDetail, StaffScope}/`, `admin/src/api/`.
   - Làm: danh sách, chi tiết, nút theo bước, gán nhân viên vào chi nhánh (`scope.manage`).
   - Verification: UAT theo spec.
10. **Quyền và vai trò**
    - Files: `bootstrap.ts` (16 action: 14 của contracts 19.2 + 21.3 + 21.5, 2 catalog), `docs/admin-roles.md`
      (mục Ordering, 5 vai trò).
    - Verification: Super Admin có đủ; role khác mặc định không có; menu ẩn khi thiếu quyền.
11. **Email**
    - Files: `providers/email-notification.ts`, `notifications/templates/{vi,en}/`, `services/notification.ts`,
      consumer outbox.
    - Làm: email nhân viên khi có đơn mới, email khách ở bước `isPublic`; `notification-delivery` log; không
      log địa chỉ.
    - Verification: Mailpit nhận đúng VI/EN; chạy dispatcher hai lần không gửi trùng.
12. **Cảnh báo đơn chờ nhận**
    - Files: `services/alert.ts` (bản đầu, gộp theo key), `jobs/sla-check.ts`.
    - Verification: tích hợp: đơn quá `slaMinutes` mở đúng một alert.
13. **Tài liệu**
    - Files: `docs/ordering-api-contract.md` (mới: API storefront), `docs/admin-roles.md`,
      `docs/ordering-staff-guide.md` (xử lý đơn), `docs/STATUS.md`.

14. **Bổ sung sau review (2026-10-10)** (contracts mục 21)
    - Files: `domain/contact/phone.ts` (chuyển từ O5), `controllers/storefront.ts` (`POST /orders/lookup`,
      `consent`, `customerNote`), `domain/workflow/definitions/*` (`customerCancellable`),
      `admin/src/pages/CreateOrder/`, `controllers/admin-orders.ts` (tạo đơn hộ, hủy một phần),
      `admin/src/translations/{vi,en}.json`, `docs/security-baseline.md`.
    - Làm:
      - Tra cứu mã + số điện thoại: dạng xem trạng thái, captcha, rate limit theo IP và theo mã (5 / 15 phút),
        lỗi chung `ORDER_LOOKUP_FAILED`.
      - Tạo đơn hộ: chọn chi nhánh trong scope, món từ catalog qua pipeline, không sửa giá; đồng ý kênh
        `phone-staff`; `origin.kind = staff-draft` → "Xác nhận".
      - Hủy một phần: gọi `cancelLineQuantity` của O1, hoàn tiền mặt nếu đã thu.
      - Ghi rõ trong tài liệu: v1 deploy 1 instance.
    - Verification: Vitest cho số điện thoại; tích hợp: tra cứu sai số điện thoại không lộ đơn tồn tại hay
      không, vượt rate limit bị chặn, response không có field cá nhân; thiếu `consent` →
      `CONSENT_REQUIRED`; tạo đơn hộ ngoài scope bị từ chối; hủy một phần đúng tiền.

15. **Bổ sung từ nghiên cứu UI (2026-10-10)** — làm theo `ordering-o3-screens.md` cho mọi màn
    - Files: `admin/src/components/NewOrderDialog/` (S2, gắn ở cấp app admin), `admin/src/components/OrderPreview/`
      (S3), `admin/src/pages/Settings/` (S9, `app.addSettingsLink`), field `estimatedReadyAt` trên
      `fulfillment-group` (migration), `services/transition.ts` (nhận `note`, `notifyCustomer`, `delayMinutes`,
      `reasonCode`), route `POST .../notes`, `GET .../lines/:lineId/cancel-preview`.
    - Làm: hộp thoại đơn mới xếp hàng nhiều đơn; nút chuyển bước sinh từ `nextTransitions`; ghi chú nội bộ; cài
      đặt tự lấy mới (`orderTiming`, `minOrderAmount`, `customerCancelBeforeMinutes`, `maxAdvanceDays`) có kiểm
      trong quote/create; setting chung lưu `strapi.store`.
    - Verification: Vitest cho tính `estimatedReadyAt` (ASAP, đặt trước, lùi) và các quy tắc đặt hàng mới; tích hợp:
      "Nhận và lùi" đổi giờ và gửi email đúng một lần; 2 người cùng nhận → 1 thành công; UAT theo acceptance thêm
      của spec.

## Data and rollback

- Migration/backfill: bảng `notification-delivery` (`branch` đã có từ O1).
- Compatibility: hai header CORS mới không ảnh hưởng client cũ.
- Rollback: tắt cờ; bỏ header CORS nếu cần.

## Verification

- Automated: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`,
  `pnpm run check:phase3`, `pnpm run smoke:reservation-form`, `node scripts/smoke-ordering-pickup.mjs`.
- Manual UAT: theo spec O3 (Mailpit, hai tab, hai chi nhánh).
- Evidence to record: Completion record, `docs/STATUS.md`.

## Documentation impact

- `docs/ordering-api-contract.md`, `docs/ordering-staff-guide.md`, `docs/admin-roles.md`, `docs/STATUS.md`.

## Risks and blockers

- SSE qua proxy/Cloudflare bị buffer: dùng cấu hình đã kiểm ở hộp thư đặt bàn.
- Rate limit và SSE trong process không chia sẻ giữa instance.

## Completion record

- Chưa bắt đầu.
