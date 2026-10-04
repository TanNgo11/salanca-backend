# Structured JSON logs (log contract v1)

Status: Automated verification passed
Owner: Tan Ngo
Last updated: 2026-10-04
Related phase: platform/operations (no product phase; follows the backend-bds phase 253 integration)

## Goal

Every backend log line becomes one JSON object on stdout that follows log contract v1
(`@tanngo11/log`, see its `CONTRACT.md`). The central log stack (Vector -> OpenObserve -> MCP)
can then filter by `request_id`, `http_route`, `level` and `event`, and AI agents can read
failures with their request context. Each HTTP request produces one `http.request` line, and
Node process warnings are logged with their call-site stack.

## Non-goals

- No change to API responses, schemas, permissions, Admin UI or the frontend.
- No rewrite of the existing `strapi.log` messages into contract events. They become JSON
  automatically; adding `event` names is a follow-up.
- No alerting, and no change to the Strapi startup banner (printed through `console`).

## Current evidence

- Strapi `5.51.1` builds its logger as
  `winston.createLogger({ level: 'http', ...config.get('logger'), ...config.get('server.logger.config') })`.
  The defaults are `prettyPrint()` and a Console transport.
- `strapi::logger`, first in `config/middlewares.ts`, prints one text line per request.
  `strapi::errors` logs unknown errors through `strapi.log.error(error)` and answers 500.
- There is no request-correlation middleware: nothing sets `ctx.state.requestId` or
  `X-Request-ID` today.
- App code logs through `strapi.log.*` (health, content-manager labels, CMS webhook, form lead
  notify, media processing). There are no `console.*` calls in `src/` or `config/`.
- The same library and setup run in production on backend-bds (Strapi 5.51.1). There, the
  request line, single-line unhandled errors, request-id propagation and process warnings were
  verified from production logs on 2026-10-03 and 2026-10-04.

## Decisions and assumptions

- **Decision:** use `@tanngo11/log@0.4.6`, pinned exactly like other dependencies, through its
  Strapi adapter. This keeps one contract across Salanca and backend-bds.
- **Decision:** the request id is server-issued (UUID v4) and returned as `X-Request-ID`. An
  inbound `X-Request-ID` is only recorded as `upstream_request_id` (`trustIncomingRequestId`
  stays `false`). The Next.js frontend forwards its id, so logs of both services link through
  that field.
- **Decision:** Vietnamese phone numbers are masked in every logged string. Reservation and
  contact leads carry phones. Emails, tokens and credentials are masked by default.
- **Assumption:** the deployment platform (Dokploy on the central VPS) already runs the Vector
  agent, which ships container stdout. This is confirmed: Salanca backend lines are already in
  OpenObserve.

## Invariants

- The response status, body and headers are unchanged, except for the added `X-Request-ID`.
- An error that reaches `strapi::errors` is still turned into the same response.
- Logging never throws into request handling.

## Implementation steps

1. **Dependency and shared logger**
   - Files: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `src/shared/log/index.ts`.
   - Verification: `pnpm install --frozen-lockfile`.
2. **Strapi logger bridge**
   - Files: `config/logger.ts`, `config/logger.test.ts`.
   - Verification: `pnpm exec vitest run config/logger.test.ts`.
3. **Request line and error capture**
   - Files: `src/middlewares/http-log`, `src/middlewares/error-capture`,
     `config/middlewares.ts`, `config/middlewares.test.ts`.
   - Verification: `pnpm exec vitest run config/middlewares.test.ts src/middlewares`.
4. **Process warnings**
   - Files: `src/index.ts` (`register()` calls `logProcessWarnings(log)`).
5. **Documentation**
   - Files: `docs/cms-technical-decisions.md` (logging row), `docs/STATUS.md`.

## Data and rollback

- No data or schema change.
- Rollback: revert the commit. `strapi::logger` and the default winston configuration return.

## Verification

- `pnpm run check`: lint, schema verification, typecheck, unit tests and build.
- After deploy, check through MCP:
  - backend lines carry `event`, `request_id` and `http_route`;
  - `request_trace` with a frontend request id returns both the frontend and the backend lines.

## Progress

- 2026-10-04: plan written.
- 2026-10-04: implemented with `@tanngo11/log@0.4.6`. Version 0.4.6 fixed type resolution under
  this repo's `"moduleResolution": "Node"`.
- 2026-10-04 gates:
  - passed: `pnpm run lint`;
  - passed: `verify:schema`;
  - passed: `tsc --noEmit` (0 errors);
  - passed: `pnpm run build` (TS and admin panel);
  - passed: the logging tests (15);
  - failed: `vitest run` was 235/236. The failure is
    `content-manager-labels.vi.test.ts` ("covers every field in Salanca API schemas"), and it
    fails on clean `main` too, so it predates this change;
  - not run: the deployment check through MCP.
