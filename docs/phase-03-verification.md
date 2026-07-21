# Phase 3 verification

Date: 2026-07-19

## Automated evidence

| Gate | Result |
| --- | --- |
| Built-in i18n package | Pass: `@strapi/i18n` `5.50.2`, bundled by Strapi core |
| Locale registry | Pass: exactly `vi`, `en` |
| Default locale | Pass: `vi` |
| Localized content types | Pass: all 15 |
| Field localization matrix | Pass: checked by `npm run verify:schema` |
| Localized slug | Pass: VI/EN differ on one `documentId` |
| Localized relation | Pass: EN menu item populates EN category |
| Missing translation | Pass: EN lookup returns `null`, no implicit VI fallback |
| Shared technical fields | Pass: price update synchronized across locales |
| Localized component | Pass: VI/EN SEO copy differs |
| Required dataset | Pass: global singleton, localized page, 2 categories, 4 items, package, campaign, location and gallery |
| Shared media policy | Pass: one uploaded binary is reused while VI/EN alt and caption differ; asset is removed after the smoke |
| Write validation | Pass: duplicate localized slug and menu item without category return HTTP 400 |
| Draft/Publish independence | Pass: VI stays Published after EN unpublish |
| Authenticated REST locale API | Pass: temporary full-access token, HTTP 200 for explicit VI/EN, no public-role permission change |
| Fixture cleanup | Pass: zero smoke records remain |
| TypeScript and production Admin build | Pass via `npm run check:phase3` |

Commands:

```powershell
npm run verify:schema
npm run smoke:i18n
npm run check:phase3
```

## Confirmed Strapi behavior

- Strapi 5 uses built-in `@strapi/i18n`; installing obsolete `@strapi/plugin-i18n` would be wrong.
- Top-level non-localized fields are synchronized by the i18n document middleware.
- Relation resolution follows locale when the related content type is localized.
- The required Phase 3 dataset is created temporarily for the smoke and deleted afterward; it is not production seed content.
- A localized component stores its component instance per locale. Nested technical fields such as `seo.noIndex` and the media reference inside `shared.image` do not become physically shared merely because their nested schema flag is non-localized. Editor/seed must deliberately keep them equal while allowing alt/caption to differ.

## Manual editor UAT still required

- Confirm Admin shows only VI and EN, with VI selected by default.
- Create localization using the Admin action, not a database/API workaround.
- Reuse one uploaded asset with different VI/EN alt and caption.
- Check required-field and duplicate-slug feedback in Content Manager.
- Run the full editor workflow in `docs/cms-editor-guide.md`.

Phase 3 code and automated workflow are not equivalent to editor acceptance. Do not close the editor-UAT checkbox until a real editor completes it.
