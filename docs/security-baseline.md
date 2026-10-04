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
