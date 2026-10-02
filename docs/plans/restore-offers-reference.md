# Restore owner-referenced offers

Owner authorization: 2026-10-01, restore https://salancarest.com.vn/vi/uu-dai
using actual backend content rather than frontend mock data.

The existing page-family layout matches the reference. Restore the localized
campaign-page hero, featured relation, event CTA and closing photo; publish the
seven existing campaign drafts with original restaurant photos. Restore only
recognized source-audit documents, reject edited drafts, snapshot all affected
local rows first. Resolve existing upload media by filename; do not upload or
touch menu, story, galleries, leads or settings. Frontend continues CMS-only.

Preview before apply. Verify public VI/EN page and campaign API reads, affected
CMS tests/typecheck/lint and browser layouts/filter/detail links. Record any
unrun production or manual gates. Production data and deployment are separate.

Applied locally: 14 campaign locale records and two campaign-page locale records.
Restored original restaurant photographs using existing upload records. Snapshot
saved under .tmp/offers-restore/ before changes. Public API confirms seven
published campaigns per locale. No production mutation, commit or push.

Passed: FE typecheck, affected seed/assets lint, 13 CMS adapter tests, production
build, VI/EN browser checks at 320, 375, 768, 1280 and 1920px (no text clipping
or horizontal document overflow). VI and EN group filters return the correct
private-party card; its VI detail link opens the CMS title. Mobile grid minimum
track and filter wrapping corrected in page-scoped CSS. Not run: full production
E2E, zoom and full keyboard walkthrough. Owner visual UAT remains pending.

Evidence in ../../../.tmp/layout-audit-2026-10-01/: offers-restored.png,
offers-featured-restored.png, offers-en-mobile.png and offers-responsive.json.
