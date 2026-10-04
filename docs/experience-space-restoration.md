> Historical implementation record. Script cleanup on 2026-10-03 supersedes old commands; use the complete-release command in docs/content-bundle-deploy.md.

# Experience and space restoration

2026-10-03: Owner requested the old blocks and images from the mockup reference. No remote branch named mockup is advertised; f3b9865 (before the PDF refresh) is the working reference pending clarification. Experience restores SplitBand intro, Rodizio signal cards, original photography and white-flower quote art. Space restores the gallery, zones, amenities and optional configured-video composition. Public runtime still reads localized published CMS content.

Experience cut cards read optional experience-page.flavorCards before legacy flavorItems. This allows independent CMS image/copy editing without touching menu-item images. Backend ships restored source content and 40 original files via its release manifest (including the subsequent homepage dish image restoration); node scripts/seed-production-content.mjs --restore-experience-space updates only these two pages and gallery.

Verification is recorded after local seed and VI/EN desktop/mobile review. Production deployment is not included.
