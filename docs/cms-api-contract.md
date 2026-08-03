# CMS API contract

Anonymous Public role receives **read-only** access to published content after bootstrap
(`provisionPublicContentPermissions`). Writes stay denied.

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

## Errors

Strapi standard error JSON. Do not branch client logic on localized message text.

## Security

| Action | Public |
| --- | --- |
| `find` / `findOne` on allowlist | Yes (published only) |
| `create` / `update` / `delete` | No |
| Auth register/login | Users & Permissions defaults (not product end-user flows yet) |

## Cache expectations (for future FE)

- Published content is cacheable at the edge with short TTL or tag revalidation.
- Signed CMS webhooks for revalidate are optional follow-up (not required for this contract).

## Verification

```powershell
npm run seed:demo
npm run verify:seed
npm run smoke:api
```
