# Content seed pipeline (web copy → CMS)

The approved Salanca design ships its wording and its asset map inside
`salanca-web` (`src/components/*/​*-page-copy.ts`, `*-assets.ts`,
`src/config/media-assets.ts`). Those files are the record of what the client
signed off on, so the CMS is seeded **from** them instead of being filled in by
hand — no second copy of the text to keep in sync, and re-running after a copy
change is one command.

## Two steps, two repos

```bash
# 1. salanca-web — regenerate the payload
pnpm run export:cms-seed          # writes ../salanca-backend/data/salanca-content.json

# 2. salanca-backend — write it into Strapi (Postgres must be up)
npm run seed:content
```

`export:cms-seed` runs under Node's TypeScript stripping with a small `@/`
resolver (`scripts/lib/alias-loader.mjs`) so it can import the copy modules
directly without adding a TypeScript runner to the frontend's dependencies.

## What the payload contains

`data/salanca-content.json` is the Strapi payload, with two placeholder forms
resolved at seed time:

| Placeholder | Becomes |
| --- | --- |
| `{ "__media": "hero-grill.jpg", "alt": … }` | `{ "media": <uploaded file id>, "alt": … }` |
| `{ "__ref": { "uid": …, "key": … } }` | the referenced document id (or a list) |

Media files are read from `../salanca-web/public/media/salanca`. Point
`SALANCA_WEB_MEDIA_DIR` elsewhere when the repos are not siblings. Uploads are
matched by file name, so re-running reuses what is already in the library.

Relations address a collection entry by its cross-locale `key`, never by a
localized slug — a slug only resolves in the locale that owns it.

## Idempotency and pruning

`seed:content` upserts: single types by locale, collections by their
`matchField` (`slug`, or `title` for gallery items, which carry no slug). A
second run reports `created=0`.

`npm run seed:content:prune` additionally **deletes** rows in the seeded
collections that the payload does not define. That is how leftovers from
`seed:demo` get cleared. It removes editor-created entries too, so use it only
on an environment whose content is meant to come entirely from the payload.

## What the seed deliberately does not own

- Decorative art (macaws, tropical leaves, pencil sketches, amenity icons) —
  the content model has no fields for it, and it is brand furniture rather than
  editorial content.
- Form field labels and option lists — kept in frontend code so editing Admin
  copy cannot break reservation or contact intake.
- Real restaurant facts still open with the client: see
  `salanca-web/docs/pending-client-decisions.md`.

## Draft preview token

`npm run token:preview` creates the read-only API token the frontend needs for
draft preview and prints it once. Copy it into `salanca-web/.env.local` as
`STRAPI_PREVIEW_TOKEN`; without it `/api/cms/preview` answers 503. Use
`--rotate` to replace an existing token (the stored value is a hash and cannot
be read back).
