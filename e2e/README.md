# Ordering E2E suite (Playwright)

This is a browser and API end-to-end suite for the `ordering` plugin: storefront API, admin API and admin UI.
See `CASES.md` for the full feature checklist and its known gaps.

## Run

```bash
# 1. a seeded UAT server (see "Seed" below) listening on E2E_BASE_URL
# 2. a super admin of that database: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (no default, on purpose)
pnpm test:e2e                       # everything except @slow
pnpm test:e2e --grep-invert @bug    # only the functional suite
pnpm test:e2e --grep @bug           # only the bug regressions
pnpm test:e2e:ui                    # Playwright UI mode
```

`@slow` specs (BUG-03/04/05) are **off by default**; the config excludes them unless `E2E_SLOW=1`:

```powershell
$env:E2E_SLOW = '1'; pnpm test:e2e --grep '@slow'      # PowerShell
E2E_SLOW=1 pnpm test:e2e --grep @slow                  # bash
```

The first run on a machine also needs `pnpm exec playwright install chromium`.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://127.0.0.1:1447` | Strapi server under test |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | **required** | super admin of the UAT database; the suite aborts in global setup when unset |
| `E2E_UAT_CRED_FILE` (or `UAT_CRED_FILE`) | — | JSON written by `uat-server.mjs` (`{password, accounts:[{name,email}]}`); supplies the lower roles |
| `E2E_UAT_PASSWORD` | — | shared password for the seed accounts if no cred file |
| `E2E_<ROLE>_EMAIL` / `_PASSWORD` | seed names | per-role override; ROLE ∈ `LAN, CHAIN, COURIER, MANAGER, ACCOUNTANT, PHONE_COURIER` (seed accounts lan-q1, quan-ly-chuoi, giao-q1, quanly-q1, ketoan, giao-phone) |
| `E2E_INTAKE_SECRET` | `e2e-local-intake-secret` | must equal `FORM_INTAKE_SHARED_SECRET` of the server; gives each test its own rate-limit bucket via `x-salanca-visitor-ip` |
| `E2E_ARTIFACTS_DIR` | `$TMPDIR/salanca-e2e-artifacts` | storageState, traces, HTML report, `results.json` |
| `E2E_SLOW` | unset | `1` includes the `@slow` specs |
| `E2E_RACE_DB` | `salanca_ordering_e2e_race` | database BUG-03 may TRUNCATE (never the UAT database) |
| `E2E_ADMIN_DEV` | unset | `1` when the server is `strapi develop`; enables BUG-11, which needs React's dev warnings |

Artifacts are written **outside the repo** on purpose. `strapi develop` watches the project directory
and restarts the server whenever a file changes inside it, and that restart kills a running suite. For
the same reason, don't edit specs while a run is in progress against a `develop` server.

`global-setup.ts` logs every role in once through the real login page. It saves one storageState and
token per role. Strapi rate-limits `/admin/login`, so the setup backs off on HTTP 429. A role whose
credentials are missing is skipped, and its tests `skip`.

## Seed

The suite expects the data from `scripts/ordering/uat-server.mjs`: branches Q1/Q3, the seed menu, roles and
the UAT accounts. It creates its own uniquely-suffixed data. It does not rely on same-day cash-closing state:
the cash tests close **or** adjust as needed.

The setup the first report used (not re-verified end to end):

1. Seed once: `UAT_PORT=1447 UAT_CRED_FILE=<path outside the repo>/uat-creds.json node scripts/ordering/uat-server.mjs`
   (default port is **1355**, not 1447; it seeds `salanca_ordering_o8_uat` and truncates it first). Stop it after the
   `[ordering-uat] ready on` line if you want to serve the database with `strapi develop` instead.
2. `uat-server.mjs` does **not** create a super admin, and Strapi refuses first-admin registration once users exist.
   Create one for `E2E_ADMIN_EMAIL` (for example `pnpm exec strapi admin:create-user ...` with `DATABASE_NAME` set
   to the UAT database; the report inserted it with SQL).
3. Server env: `ORDERING_ENABLED=true`, `FORM_INTAKE_SHARED_SECRET=<E2E_INTAKE_SECRET>`, `PORT=1447`,
   `DATABASE_NAME=<UAT database>`. Never point the suite at the development database (`salanca_cms`): it creates
   branches, promotions, gift cards and customers and runs erase requests.

Use test, mock or unset values for every provider. The suite never calls MoMo, VNPay, SePay, Ahamove, SMS
or Zalo, and never triggers email sends. OTP, cart-reminder, template/channel test sends and gift-card
resend are deliberately left out (see `CASES.md` ⛔).

### `@slow` tests

The `@slow` tests run repo scripts in child processes:
- BUG-03 runs `scripts/ordering/review-otp-race.mjs`. It boots its own app on `E2E_RACE_DB` (default `salanca_ordering_e2e_race`), whose ordering tables the harness **truncates**, on a random port. The suite pins that database so an inherited `ORDERING_TEST_DATABASE` can never aim the truncate at the UAT database. Make sure the email provider is unset or a sink.
- BUG-04 runs `vitest` on `registry.test.ts`.
- BUG-05 boots `uat-server.mjs` against a throwaway DB, `salanca_ordering_e2e_seedcheck`, and kills it once it is ready.

Don't run `@slow` in parallel with a `strapi develop` server that is rebuilding the plugin `dist`.

## Layout

```
e2e/
  playwright.config.ts   baseURL, vi-VN locale, Asia/Ho_Chi_Minh TZ, 1 worker, list+html+json reporters, @slow gate
  global-setup.ts        per-role login → storageState + token
  helpers/env.ts         env/credential resolution, uid(), todayVN()
  helpers/fixtures.ts    api / apiAs(role) / pub (storefront) / orders (place, advance, state) / pageAs(role) / ui helpers
  specs/01-orders … 08-api      UI + API flows (each UI action is verified through the API)
  specs/10-storefront           public API incl. negative, race and idempotency cases
  specs/11-admin-api            admin API breadth incl. validation cases
  specs/99-bugs                 @bug-01..@bug-15 + @ux-erase-confirm regressions (BUG-09 is `fixme`, BUG-11 needs E2E_ADMIN_DEV=1)
  CASES.md
```

## Locators and suggested `data-testid`s

The specs prefer `getByRole` and `getByLabel`. The following places have no accessible name, so the specs
fall back to structure. Adding a `data-testid` (or an `aria-label`) at these points would make the suite
sturdier:

| Page | Element | Current fallback |
|---|---|---|
| Price list editor | item row: variant input + price input ("Món và giá") | `getByText('Món và giá').locator('..').getByRole('textbox').nth(1)` |
| Categories | name inputs (label "Tên" + sub-label "Vietnamese (vi)") | `getByPlaceholder('Vietnamese (vi)')` |
| Cash closing | difference ("Chênh lệch") cell per collector; collector summary vs history rows | header index lookup / `.first()` |
| Orders / Cash closing / Tables | branch picker shows names on some pages and codes ("Q1") on others | `ui.branch()` accepts both |
| Ratings | detail dialog actions and tag chips | role + text |
| Data requests | rows (masked phone `****123`), "Từ chối" button re-rendered by polling | `toPass` retry |
| Kitchen | order cards | `getByText(code)` |
| Promotions | "KHÁCH THẤY" preview block | `getByText(/KHÁCH THẤY/).locator('..')` |
| Tables | active switch per row | `getByRole('switch')` / checkbox |
