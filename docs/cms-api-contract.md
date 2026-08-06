# CMS API contract

Anonymous Public role receives **read-only** access to published **marketing content** after bootstrap
(`provisionPublicContentPermissions`). Content writes stay denied.

**Exception — form intake:** Public may `POST` create on `contact-messages` and `reservation-requests` only
(`provisionPublicFormPermissions`). Public cannot list, read, update, or delete leads.

## Base path

- REST prefix: **`/api/v1`** (`API_REST_PREFIX`, validated at startup).
- Admin remains at `/admin`.
- Do not call unversioned `/api/...` in new clients.

## Locale rules

- Consumers **must** send `locale=vi` or `locale=en`.
- Backend never silently falls back EN → VI.
- Missing localization returns empty list / no document for that locale.
- Public consumers only see **published** entries.
- `documentId` is the stable identity across locales; slugs are localized.

## CORS

Origins must appear in `FRONTEND_URLS` (bare origins). Credentials allowed.

## Public read allowlist

### Single types (`GET /api/v1/<singular>`)

| Resource | Path |
| --- | --- |
| Global setting | `/global-setting` |
| Home page | `/home-page` |
| Menu page | `/menu-page` |
| Campaign page | `/campaign-page` |
| Story page | `/story-page` |
| Experience page | `/experience-page` |
| Space page | `/space-page` |
| Contact page | `/contact-page` |
| Booking page | `/booking-page` |

### Collections (`GET /api/v1/<plural>` and `GET /api/v1/<plural>/:documentId`)

| Resource | Path |
| --- | --- |
| Locations | `/locations` |
| Menu categories | `/menu-categories` |
| Menu items | `/menu-items` |
| Menu packages | `/menu-packages` |
| Campaigns | `/campaigns` |
| Gallery items | `/gallery-items` |

## Explicit populate maps (recommended)

Avoid `populate=*`. Prefer:

### Global setting

```text
populate[logo][populate]=media
populate[openingHours]=true
populate[socialLinks]=true
populate[headerLinks]=true
populate[footerExploreLinks]=true
populate[footerInfoLinks]=true
populate[mainLocation]=true
populate[defaultSeo][populate]=shareImage
```

### Menu item

```text
populate[category]=true
populate[image][populate]=media
```

### Menu package

```text
populate[includedItems]=true
populate[image][populate]=media
populate[seo][populate]=shareImage
```

### Campaign

```text
populate[coverImage][populate]=media
populate[gallery][populate]=media
populate[cta]=true
populate[seo][populate]=shareImage
```

### Home page

```text
populate[hero][populate][backgroundImage][populate]=media
populate[hero][populate][primaryLink]=true
populate[experienceImage][populate]=media
populate[experienceLink]=true
populate[featuredPackage]=true
populate[featuredMenuItems]=true
populate[closingCta][populate]=link
populate[seo][populate]=shareImage
```

### Gallery item

```text
populate[image][populate]=media
populate[location]=true
```

## Example queries

```text
GET /api/v1/global-setting?locale=vi
GET /api/v1/menu-items?locale=vi&filters[slug][$eq]=picanha&populate[category]=true
GET /api/v1/menu-items?locale=en&filters[slug][$eq]=picanha-en&populate[category]=true
GET /api/v1/campaigns?locale=vi&filters[isFeatured][$eq]=true&sort=displayOrder:asc
GET /api/v1/locations?locale=vi&filters[slug][$eq]=salanca-quan-1
```

## Pagination, filters, sort

- Default page size: 25; max: 100 (`config/api.ts`).
- Use Strapi 5 filter / sort / pagination query params.
- Secondary sort on `documentId` is recommended when `displayOrder` ties.

## Media

- With object storage: public URLs use `CDN_URL` origin.
- Editorial images should expose alt via `shared.image.alt`.
- `shared.image` also exposes `focalPointX` / `focalPointY` (0–100, default 50) for responsive crop.
- `mapUrl` on location/global-setting accepts a Google Maps share URL, embed URL, or a single pasted iframe; the CMS persists only a normalized HTTPS URL (never raw HTML).
- `socialLinks[].url` must be HTTPS and match the platform hostname policy (facebook/instagram/tiktok/youtube; `other` = any HTTPS host).

## Errors

Strapi standard error JSON. Do not branch client logic on localized message text.

## Public form intake (contact)

```http
POST /api/v1/contact-messages
Content-Type: application/json

{
  "data": {
    "fullName": "Nguyen Van A",
    "email": "a@example.com",
    "phone": "0901234567",
    "topic": "private_event",
    "message": "Muon dat tiec 30 khach.",
    "sourceLocale": "vi",
    "sourcePath": "/vi/lien-he",
    "website": ""
  }
}
```

| Rule | Detail |
| --- | --- |
| Success | `201` `{ data: { documentId, status: "new" } }` |
| Required | `fullName`, `message`, `sourceLocale` (`vi`\|`en`), and **email or phone** |
| Alias | Body key `locale` accepted as alias for `sourceLocale` (prefer `sourceLocale`) |
| Honeypot | `website` must be empty/absent; non-empty → `400` |
| Client `status` | Ignored; server forces `new` |
| `GET /contact-messages` | Public denied (`401`/`403`) |
| Rate limit | After successful validation; in-process per client IP; default 5 / 10 min; env `CONTACT_RATE_LIMIT_*`; over → `429` Strapi-shaped `{ error: { name: ApplicationError, details.code: CONTACT_RATE_LIMITED } }` with `Retry-After` |
| Email / CAPTCHA | **Not in MVP** (Automation phase residual risk) |

## Public form intake (reservation)

```http
POST /api/v1/reservation-requests
Content-Type: application/json

{
  "data": {
    "fullName": "Nguyen Van A",
    "phone": "0901234567",
    "email": "a@example.com",
    "preferredDate": "2026-08-20",
    "preferredTime": "19:00",
    "guestCount": 4,
    "occasion": "birthday",
    "note": "Gan cua so neu con",
    "menuSelectionMode": "now",
    "menuPackages": ["pkgDocumentId"],
    "menuItems": ["itemDocumentId"],
    "sourceLocale": "vi",
    "sourcePath": "/vi/dat-ban",
    "website": ""
  }
}
```

| Rule | Detail |
| --- | --- |
| Success | `201` `{ data: { documentId, status: "new", overlapCount, hasOverlap } }` (`hasOverlap` derived, not stored) |
| Required | `fullName`, `phone`, `preferredDate`, `preferredTime`, `guestCount`, `menuSelectionMode`, `sourceLocale` |
| `preferredTime` | Canonical 24-hour `HH:mm` (`"19:00"`). Anything else (`"7:00 PM"`, `"19h"`, `"24:00"`) → `400` `RESERVATION_PREFERRED_TIME_INVALID`. Required so soft-overlap counting compares like with like |
| `menuSelectionMode` | `later` (no menu ids) or `now` (at least one package or item documentId, published+active) |
| Menu locale | Menu ids are resolved in `sourceLocale`, so an EN page submits the EN rows it displayed |
| Soft overlap | Same date+time with status `new`\|`read` → store `overlapCount` via DB count; **does not reject** |
| Rate limit | After successful validation; in-process per client IP; default 5 / 10 min; env `RESERVATION_RATE_LIMIT_*`; over → `429` Strapi-shaped `{ error: { name: ApplicationError, details.code: RESERVATION_RATE_LIMITED } }` with `Retry-After` |
| Quota accounting | Consumed **before** menu resolution, so a request that then fails `RESERVATION_MENU_IDS_INVALID` still costs a slot. A limiter that ran after the database work would not protect the database |
| Honeypot | `website` empty/absent; non-empty → `400` (does not consume rate limit) |
| Client `status` | Ignored; server forces `new` |
| `GET /reservation-requests` | Public denied (`401`/`403`) |
| Email / CAPTCHA / Redis RL | **Not in Forms-2** (Automation / later) |

## Security

| Action | Public |
| --- | --- |
| `find` / `findOne` on content allowlist | Yes (published only) |
| `create` / `update` / `delete` on marketing content | No |
| `create` on `contact-messages` | Yes (validated intake) |
| `find` / `update` / `delete` on `contact-messages` | No |
| `create` on `reservation-requests` | Yes (validated intake + soft overlap + IP rate limit) |
| `find` / `update` / `delete` on `reservation-requests` | No |
| Auth register/login | Users & Permissions defaults (not product end-user flows yet) |

## Signed CMS webhooks (optional)

When both `CMS_WEBHOOK_URL` and `CMS_WEBHOOK_SECRET` are set, publish/unpublish of public content types POSTs:

```json
{
  "uid": "api::home-page.home-page",
  "locale": "vi",
  "documentId": "…",
  "event": "entry.publish"
}
```

Header: `x-cms-signature: sha256=<hmac-sha256-hex-of-raw-body>`.  
Delivery is fire-and-forget (does not block publish); failures are logged and never roll back the CMS write. FE verifies the signature before revalidating.

**One payload per locale.** Publishing all locales (`locale: '*'`) or relying on the default locale fans out to every allowed locale (`vi`, `en`) as separate signed POSTs; an explicit locale sends one. The FE revalidate route must therefore be idempotent and safe to call twice in quick succession. An explicit locale outside the allowlist is logged and skipped.

## Cache expectations (for future FE)

- Published content is cacheable at the edge with short TTL or tag revalidation.
- Prefer signed CMS webhooks above for on-publish revalidation.

## Verification

```powershell
npm run seed:demo
npm run verify:seed
npm run smoke:api
```
