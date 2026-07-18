# Security Baseline

## Dependency audit at bootstrap

Date: 2026-07-18

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
