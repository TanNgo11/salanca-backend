# Reservation inbox: near-realtime admin notification

Status: Automated verification passed — ready for manual UAT
Owner: Salanca technical owner
Last updated: 2026-10-04
Related phase: none (owner-requested follow-up to `phases/phase-forms-reservation-request.md`)

## Goal

When a visitor submits the public reservation form, staff who have the Strapi
Admin open see it within ~1s: an in-admin toast with an "open record" action,
an unread badge, and (opt-in per browser) an OS notification + sound. When the
live connection is unavailable the admin falls back to polling every 20s. The
existing Resend email notify is unchanged and keeps running in parallel.

## Non-goals

- No Telegram / Zalo / Slack / Web Push channel.
- No change to the `reservation-request` schema, the public Content API, or the
  email notify path.
- No Redis / multi-instance fan-out (single process, matches current hosting).
- No booking engine, availability, or table inventory logic.
- `contact-message` is out of scope (reservation only).
- Leads created manually in Content Manager do not emit a live event
  (owner decision 2026-10-04: web intake only).

## Current evidence

- `src/api/reservation-request/controllers/reservation-request.ts` is the only
  create path; it already schedules `scheduleFormLeadNotify` off the response
  path after the 201.
- `reservation-request.status` enum `new | read | archived`, default `new`.
- `src/api/audit-log/index.ts` shows the house pattern for admin-only routes:
  `strapi.server.api('admin').routes([...])`, policy
  `admin::isAuthenticatedAdmin`, `auth.scope` on a custom action registered via
  `actionProvider.registerMany`, Super Admin reset in bootstrap.
- `src/admin/audit-log/*` shows the admin screen pattern (`useFetchClient`,
  `useNotification`, `useRBAC`, Design System, plain CSS, `vi.ts` strings,
  menu link in `src/admin/app.tsx`).
- `config/middlewares.ts` does not enable compression; `http-log` sets
  `ctx.state.requestId`.

## Decisions and assumptions

- Decision (owner): transport = SSE primary + polling fallback; UI = badge +
  toast + OS notification/sound; scope = reservation-request only; keep email.
- Decision: the admin consumes SSE with `fetch()` + `Authorization` header and
  a `ReadableStream` reader (not `EventSource`, which cannot send headers), so
  no extra stream-ticket mechanism is needed.
- Decision: in-process `EventEmitter` is the event source; emitted by the
  controller right after `scheduleFormLeadNotify`. Emit failures are logged
  and never affect the public 201.
- Assumption (spike 0): a React component can be mounted once for the whole
  admin app so the hook survives route changes. Candidates, in order:
  1. a root-level wrapper via the admin `app` API (e.g. `app.addMiddlewares` /
     a provider-like injection) if Strapi 5.51 exposes one;
  2. a React root created in `bootstrap()` attached to a `div` appended to
     `document.body`, with the fetch client obtained from the admin context.
  Fallback if neither works: `injectContentManagerComponent` (notifications
  only while inside Content Manager) — must be reported as a degradation.
- Assumption (spike 0): `addMenuLink` in Strapi 5.51 may not support a dynamic
  badge. Fallback: floating unread indicator rendered by the global widget.
- Spike 0 result (verified 2026-10-04, Strapi 5.51.1): mount the global widget
  by wrapping `router._routes` in a pathless layout route via
  `app.router.addRoute((routes) => [{ element, children: routes }])`. It must
  run in the custom `bootstrap` (capture `app` in `register`), NOT in
  `register`: plugin bootstraps (e.g. `@strapi/plugin-documentation`) call
  `addSettingsLink`, whose `createSettingsLink` does a top-level
  `findIndex(route.path === 'settings/*')` on `_routes` and crashes once
  routes are nested. The layout route renders inside `PrivateAdminLayout`
  (auth-gated, absent on `/auth/*`) and inside every admin provider, so
  `useFetchClient` / `useNotification` / Design System all work. Verified in
  the browser on Home, Content Manager, Media Library, and Settings.
  `MenuItem.notificationsCount` exists but is a static snapshot at
  registration — no dynamic badge; use a floating indicator instead.
  Note: `strapi.server.api('admin')` routes are prefix-less — admin endpoints
  are served at `/reservation-inbox/*` (not `/admin/reservation-inbox/*`); the
  admin fetch client prepends `window.strapi.backendURL` only.
- Implementation note (2026-10-04, steps 4-6): the SSE controller listens for
  client disconnect on `ctx.res.on('close')` (not `ctx.req`) — Node 16+
  `IncomingMessage` `close` semantics do not fire reliably after the request
  completes; cleanup is guarded so it runs once.
- Implementation note: the hook's stream token comes from
  `useAuth('useReservationInbox', (s) => s.token)` — the same token the admin
  fetch client sends.
- Implementation note: reservation-inbox `formatMessage` calls pass
  `defaultMessage` (the Vietnamese string) in addition to the `id`.
  `config.translations.vi` only applies when the admin UI locale is `vi`;
  admins on the `en` UI would otherwise see raw `reservation-inbox.*` ids
  (pre-existing behavior: the audit-log screen shows `audit-log.*` ids under
  the English UI).

## Invariants

- Public reservation create response, validation, rate limit, overlap and
  email behavior are byte-for-byte unchanged (`smoke:reservation-form` passes).
- All new routes are admin-only (`admin::isAuthenticatedAdmin` + scope
  `admin::reservation-inbox.read`); nothing is added to the public Content API.
- SSE payloads and summary items carry only the fields needed to render the
  toast/list (`documentId, fullName, phone, guestCount, preferredDate,
  preferredTime, overlapCount, createdAt`); never `note`, `email`, or menu
  relations.
- OS notification / sound are opt-in per browser, requested only from a user
  gesture, default off.
- The widget never blocks the admin UI: stream errors degrade to polling
  silently (one `console.warn` max per state change).

## Implementation steps

0. Spike: global admin widget mount + menu badge
   - Files/modules: throwaway in `src/admin/reservation-inbox/`; result
     recorded in this plan under "Decisions".
   - Verification: `pnpm run dev`, navigate Content Manager → Media Library →
     Settings; a test toast fired from the widget appears on every route.
1. Domain event bus
   - Files/modules: `src/domain/reservation-request/reservation-inbox-events.ts`
     (+ `.test.ts`): singleton `EventEmitter`, `ReservationInboxItem` type,
     `emitReservationCreated`, `subscribeReservationCreated` returning an
     unsubscribe fn.
   - Verification: unit test subscribe/emit/unsubscribe; `pnpm run typecheck`.
2. Controller emit
   - Files/modules: `src/api/reservation-request/controllers/reservation-request.ts`
     after `scheduleFormLeadNotify`; `try/catch` → `strapi.log.error`.
   - Verification: `pnpm run smoke:reservation-form` unchanged; test asserts
     emit is called with the mapped item.
3. Admin API `src/api/reservation-inbox/`
   - `index.ts`: action `admin::reservation-inbox.read` ("Xem hộp thư đặt bàn",
     section settings), `registerReservationInboxPermissions`,
     `bootstrapReservationInboxPermissions` (Super Admin reset),
     `registerReservationInboxAdminRoutes`.
   - `reservation-inbox.service.ts`: `summary({ since?, limit=20 })` → status
     `new`, `createdAt desc`, `unreadCount` = count status `new`;
     `markRead(documentId)` → `status: 'read'` via `strapi.documents`.
   - `reservation-inbox.sse.ts` (+ test): frame encoder
     `formatSseEvent(name, data)`, heartbeat `: ping\n\n` every 25s, headers
     `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
     `Connection: keep-alive`, `X-Accel-Buffering: no`; `ctx.respond = false`;
     unsubscribe + clear timer on `req.close`.
   - `reservation-inbox.controller.ts`: `summary`, `stream`, `markRead`
     (validate `since` ISO and `documentId` shape; errors in the audit-log
     style).
   - Routes: `GET /reservation-inbox/summary`, `GET /reservation-inbox/stream`,
     `POST /reservation-inbox/:documentId/read` (admin API prefix).
   - Wire into `src/index.ts` `register`/`bootstrap`.
   - Verification: unit tests (service query shape via mocked
     `strapi.documents`, SSE encoder/heartbeat with fake timers); manual
     `curl -N -H "Authorization: Bearer <admin jwt>" /admin/reservation-inbox/stream`
     then submit a form → one `reservation.created` frame.
4. Admin hook `src/admin/reservation-inbox/useReservationInbox.ts` (+ test)
   - State: `{ mode: 'stream' | 'polling', unreadCount, items, lastSeenAt }`.
   - Stream via `fetch` + reader; parse `event:`/`data:` lines; on close/error
     → backoff 1s,2s,4s…30s and start 20s polling of `summary?since=` until
     the stream reconnects; after reconnect call `summary?since=lastSeenAt`
     once to backfill; dedupe by `documentId`; pause while
     `document.hidden`.
   - Pure helpers extracted for tests: `parseSseChunk`, `nextBackoffMs`,
     `mergeItems`.
5. Global widget + notifications
   - `ReservationInboxWidget.tsx` mounted per spike result; on each new item:
     `useNotification` toast type `info`, message
     "Đặt bàn mới: {fullName} · {guestCount} khách · {preferredTime} {dd/MM}",
     link → `/content-manager/collection-types/api::reservation-request.reservation-request/{documentId}`.
   - `notification-preferences.ts`: `localStorage` key
     `salanca.reservationInbox.prefs` `{ osNotify: boolean, sound: boolean }`;
     `Notification.requestPermission()` only from the toggle click; `Audio`
     with a small bundled `chime.mp3` in `src/admin/reservation-inbox/`.
   - Badge: menu link badge if supported, else floating indicator.
6. Inbox screen `ReservationInboxScreen.tsx`
   - Menu link "Hộp thư đặt bàn" (icon `Bell`), permission-gated; list of
     `new` items with "Mở" and "Đã đọc" actions, toggles for OS
     notification/sound, status line "Kết nối trực tiếp" / "Đang kiểm tra
     mỗi 20 giây".
   - Strings in `src/admin/reservation-inbox/vi.ts`, merged in `app.tsx`
     like audit-log.
7. Docs (see matrix below).

## Data and rollback

- Migration/backfill: none (no schema change).
- Compatibility: existing leads unaffected; `markRead` only writes `status`.
- Rollback: revert code; no data cleanup needed.

## Verification

- Automated: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`;
  `pnpm run smoke:reservation-form` against local PostgreSQL.
- Manual UAT:
  1. Two admin tabs on different routes (Media Library, Settings); submit the
     web form → both show the toast within ~1s, badge increments.
  2. DevTools → Offline for 40s → back online: stream reconnects, missed lead
     backfilled once (no duplicate toast).
  3. Block the stream route (or kill server for 5s): widget shows polling
     state and still picks up a new lead within 20s.
  4. Enable OS notification + sound, submit form with the tab in background →
     OS popup + chime; disable → none.
  5. Editor role without `reservation-inbox.read`: no menu link, 403 on the
     three routes.
  6. "Đã đọc" sets `status=read`; badge decrements; Content Manager shows the
     new status.
- Evidence to record: completion record below + `docs/STATUS.md` entry.

## Documentation impact

- `docs/cms-technical-decisions.md`: SSE + polling fallback, in-process bus,
  fetch-based SSE auth.
- `docs/admin-roles.md`: new action `reservation-inbox.read`.
- `docs/cms-editor-guide.md`: "Hộp thư đặt bàn" usage + browser notification
  toggles.
- `docs/STATUS.md`: feature entry + open UAT gates.

## Risks and blockers

- Global mount unsupported in Strapi 5.51 → degrade to Content Manager-only
  notifications; report to owner before continuing (step 0 gate).
- Reverse proxy buffering SSE in hosting → heartbeat + `X-Accel-Buffering`;
  polling fallback covers the worst case.
- Browser autoplay policy blocks sound until a gesture → chime only after the
  toggle was clicked in that session; documented in the editor guide.
- Multi-instance deploy later → events would be per-instance; note in
  technical decisions, Redis pub/sub deferred.

## Completion record

- 2026-10-04 — **implemented** (steps 0–6):
  - Step 0 spike: global mount via `app.router.addRoute` in custom `bootstrap`
    (see Decisions); floating pill replaces dynamic menu badge (unsupported).
  - Step 1: `src/domain/reservation-request/reservation-inbox-events.ts`
    (singleton bus + `ReservationInboxItem`).
  - Step 2: emit in `reservation-request` controller after
    `scheduleFormLeadNotify`, `try/catch` → `strapi.log.error`.
  - Step 3: `src/api/reservation-inbox/` — action
    `admin::reservation-inbox.read`, routes `/reservation-inbox/summary`,
    `/stream` (SSE, `res.on('close')` idempotent cleanup), `/:documentId/read`;
    Super Admin grant at bootstrap; wired in `src/index.ts`.
  - Step 4: `src/admin/reservation-inbox/useReservationInbox.ts` +
    `reservation-inbox.helper.ts` (`parseSseChunk`, `nextBackoffMs`,
    `mergeNewItems`, `inboxReducer`, formatters) — reducer/helpers unit-tested
    (no `@testing-library/react` dependency added).
  - Step 5: `ReservationInboxProvider` (one stream per tab, `useRBAC` gate,
    toast + OS `Notification` + Web Audio chime), `ReservationInboxWidget`
    floating pill, `notification-preferences.ts` (`localStorage`
    `salanca.reservationInbox.prefs`), plain CSS.
  - Step 6: `Hộp thư đặt bàn` menu link (Bell icon, position 11,
    permission-gated) + `ReservationInboxScreen` (status line, pref toggles,
    mark-read/open actions, overlap chip, Asia/Ho_Chi_Minh times) + `vi.ts`.
- **Automated verification passed** (2026-10-04): `pnpm run typecheck` clean;
  `pnpm run lint` clean; `pnpm run test` 372 tests / 61 files pass;
  `pnpm run build` pass; `pnpm run smoke:reservation-form` pass (public 201
  unchanged). Live SSE frame + summary/mark-read/401/403 verified via curl.
- **Browser-checked by agent** (not a substitute for owner UAT): toast + pill
  on Media Library and Settings tabs, polling fallback + reconnect with
  exactly-once backfill, mark-read decrement, "Mở" → Content Manager edit,
  pref toggle persistence, no `reservation-inbox.*` console errors.
- **Open manual gates (owner UAT):** two-tab toast on real form submit;
  DevTools offline 40s → reconnect dedupe; OS notification + sound toggles
  on/off; Editor role without `reservation-inbox.read` sees no menu link and
  gets 403; "Đã đọc" sets `status=read` visible in Content Manager; SSE
  buffering check behind the production proxy; multi-instance note (Redis
  deferred).
