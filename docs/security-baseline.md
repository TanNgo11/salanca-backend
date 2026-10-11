# Security Baseline

## Dependency audit at bootstrap

Date: 2026-07-18

Rechecked on 2026-07-19 against `https://registry.npmjs.org`; counts are unchanged.
The machine's configured AWS CodeArtifact registry does not expose npm's audit endpoint,
so audit runs must pass the public registry explicitly until that registry policy changes.

The official Strapi 5.50.2 scaffold reported:

- 0 critical vulnerabilities.
- 1 high vulnerability.
- 12 moderate vulnerabilities.
- 7 low vulnerabilities.

The high advisory is reported against transitive Vite development/build tooling. npm's automatic `fixAvailable` recommendation points to Strapi 4.26.2, which is a major downgrade and is not an acceptable fix for this new Strapi 5 project.

No `npm audit fix --force` was run. Forcing dependency rewrites would trade a visible transitive advisory for an unreviewed framework downgrade or broken dependency graph.

## Required follow-up

- Re-run `npm audit` before the first staging deployment.
- Check whether a newer stable Strapi patch resolves the Vite advisory.
- Upgrade Strapi only through a dedicated reviewed change using the official upgrade tool.
- Keep the Admin/build surface private to trusted operators until the dependency is resolved or explicitly risk-accepted.
- Do not expose the development server publicly.

## Existing controls

- PostgreSQL is required; SQLite fallback is rejected.
- Secrets are stored in ignored environment files.
- Public API permissions remain deny-by-default.
- Production CORS and media storage remain blocked decisions before staging.

## Ordering public catalog API (O2)

The `ordering` plugin exposes three public read-only routes (`auth:false`) for storefront
consumption: `GET /api/v1/ordering/catalog/categories`, `/catalog/products`,
`/catalog/products/:slug`.

- Read-only: only GET routes; serializer returns whitelisted fields (names, slugs,
  prices, availability) — internal ids, ranks, `isInternal` categories and inactive /
  non-`sellOnline` products are filtered out before serialization.
- Rate limit: in-process per client IP; 429 beyond the configured window. The client IP comes
  from `resolveClientIp` (plugin `clientIp` config): the visitor IP forwarded by salanca-web in
  `x-salanca-visitor-ip` is trusted only when `x-salanca-intake-secret` matches
  `FORM_INTAKE_SHARED_SECRET` (constant-time compare, junk IPs ignored); otherwise the socket IP
  (`X-Forwarded-For` only with `TRUST_PROXY=true`). Same model as form intake. **Open for OW:**
  salanca-web must send both headers on its server-side calls to `/api/v1/ordering/*`, or all
  visitors share the web server's bucket.
- Response size: short `Cache-Control` TTL; product list is paginated — no unbounded
  dump endpoint.
- Admin routes (`/ordering/categories*`, `/ordering/availability*`) require
  `admin::isAuthenticatedAdmin` plus `plugin::ordering.catalog.manage` /
  `catalog.toggle-availability`, and staff scope is enforced per `locationRef` —
  unauthenticated requests return 401 before the handler runs.

## Ordering storefront API (O3)

Public routes (`auth:false`, under `/api/v1/ordering`): `GET /branches`, `GET /config`, `GET /slots`,
`POST /quote`, `POST /orders`, `GET /orders`, `GET /orders/payment`, `POST /orders/cancel`,
`POST /orders/lookup`.

- Rate limits: in-process fixed windows per trusted client IP (`storefront.rateLimits`: read 120/min,
  quote 60/min, create and cancel 10 per 10 min). Single instance only (contracts §21.9).
- Body: JSON only, capped at 32 KB (413 above); only allowlisted fields are read — client amounts,
  adjustments, fees, statuses and origins are ignored, the server prices every cart.
- `POST /orders`: `Idempotency-Key` header required; captcha through the configured `CaptchaProvider`
  (Turnstile when `TURNSTILE_SECRET_KEY` is set; fails closed); consent `{ policyVersion, accepted: true }`
  required (`CONSENT_REQUIRED`); phone normalized to E.164 (Vietnamese numbers only).
- Order token: 32 random bytes, sent once in the create response (and again on an idempotent replay);
  stored as SHA-256 on the order and AES-256-GCM sealed on the idempotency row
  (`ORDERING_ENCRYPTION_KEY`, rows expire after `idempotency.ttlHours`). Accepted **only** in the
  `X-Order-Token` header — a token in the query string is refused (`ORDER_TOKEN_INVALID`) so it never reaches
  access logs. Customer links put it in the URL fragment (`#t=`).
- Responses use allowlist serializers: the token view has the customer's name but not phone/email; the
  lookup view has no personal data. `Cache-Control: no-store` on order routes.
- `POST /orders/lookup` (code + phone, contracts §21.2): captcha required; rate limited per IP (20 / 15 min)
  **and** per order code (5 / 15 min, the 6th try is 429); phones compared as E.164 hashes with
  `timingSafeEqual`; an unknown code, a draft and a wrong phone return the same `ORDER_LOOKUP_FAILED` after the
  same work. The status-only view opens no action (no cancel, no payment QR).

## Form intake rate limiting

Contact and reservation intake are rate limited in-process per client IP (default 5 per 10 minutes).
The web app posts server-to-server, so Strapi only sees the web server's IP unless both sides share
`FORM_INTAKE_SHARED_SECRET`: salanca-web then forwards the visitor IP in `x-salanca-visitor-ip`, trusted
only when `x-salanca-intake-secret` matches (constant-time compare; a wrong secret falls back to the socket
IP and never errors). Set `TRUST_PROXY=true` when Strapi sits behind a reverse proxy. Production boot logs a
warning when the secret is missing (limit degrades to one site-wide bucket).

## Audit (2026-10-04)

Run with the public registry: `pnpm audit --prod --registry=https://registry.npmjs.org`.

- salanca-web: Next 16.3.6 clears the three Next RCE advisories; `sharp` 0.35.4, `postcss`,
  `browserslist` and `baseline-browser-mapping` are pinned via `pnpm-workspace.yaml` overrides. Prod audit is clean.
- salanca-backend: direct `sharp` (media-processing pipeline) is 0.35.4.
- Remaining highs (axios, undici, vite, nodemailer, brace-expansion, fast-uri, ...) are transitive through
  `@strapi/*` (including `@strapi/upload`'s own `sharp`). Waiting on a dedicated Strapi upgrade; do not
  override them individually.
