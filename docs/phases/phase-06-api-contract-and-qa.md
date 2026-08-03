# Phase 6 — API contract, public read permissions, backend QA

## 1. Mục tiêu

Chốt **REST contract** mà `salanca-web` sẽ dùng sau này, mở **tối thiểu** quyền đọc Public cho content published, và có smoke/QA chứng minh locale + populate + security boundaries.

**Ước lượng:** 2–3 ngày dev.

**Pattern source:** Nhà Thật `src/bootstrap/public-content-permissions/`, phase API example docs, cms-webhook (optional).

## 2. Phụ thuộc

- Phase 4 closed (prefix `/api/v1`, CORS, media URLs stable).  
- Phase 5 seed available (strongly recommended for realistic responses).  
- Phase 0 decisions on domains (for CORS examples).

## 3. Non-goals

- Frontend integration code in `salanca-web`.  
- Public `create`/`update`/`delete` on any content type.  
- Reservation/contact form write APIs.  
- GraphQL.  
- `populate=*` as production default.

## 4. Quyết định khóa

| Hạng mục | Quyết định |
| --- | --- |
| Base path | `/api/v1` |
| Locale | Consumer **must** pass `locale=vi` or `locale=en` |
| Fallback | Backend **never** returns VI when EN requested |
| Draft | Public role sees **published only** |
| Identity | `documentId` stable; slug localized for routes |
| Permissions | Bootstrap allowlist `find` / `findOne` only on approved UIDs |
| Populate | Per-type explicit map documented in contract |
| Auth for browser | Still no end-user product auth; optional read-only API token for server later |

### Public read allowlist (initial)

Single types (find):

- `global-setting`
- `home-page`, `menu-page`, `campaign-page`, `story-page`, `experience-page`, `space-page`, `contact-page`, `booking-page`

Collections (find + findOne):

- `location`, `menu-category`, `menu-item`, `menu-package`, `campaign`, `gallery-item`

Adjust only via code review of provisioner allowlist — not silent Admin clicks.

## 5. Work breakdown

### P6-01 — Complete API contract document

**Thực hiện** — expand [`../cms-api-contract.md`](../cms-api-contract.md):

- Base URL per env.  
- Auth model (public read; future token).  
- Locale rules + examples VI/EN.  
- Pagination, filters, sort conventions.  
- **Populate maps** for:
  - global-setting
  - menu-item (+ category)
  - campaign
  - home-page (and other pages as needed)
- Media URL + alt shape.  
- Error envelope.  
- Cache expectations (hint for FE; no FE code).  
- Example `curl` for each major resource.

### P6-02 — public-content-permissions bootstrap

**Thực hiện**

- `src/bootstrap/public-content-permissions/`:
  - typed action list
  - idempotent ensure permission on Public role
  - skip missing content types safely
- Wire into `src/index.ts` bootstrap **after** locales.  
- Unit tests for action list purity / ensure logic where pure.

**Nghiệm thu**

- Fresh boot grants allowlist only.  
- Second boot no duplicates.  
- Types not on list remain denied.

### P6-03 — Negative security smoke

**Thực hiện**

Script or documented curls:

- Anonymous `POST`/`PUT`/`DELETE` → fail.  
- Anonymous `GET` draft-only document → not returned.  
- Anonymous `GET` published + `locale=en` missing → empty/404, not VI.  
- Unknown populate abuse: contract still recommends explicit populate; document risk of deep populate.

### P6-04 — Positive contract smoke

**Thực hiện**

- `npm run smoke:api` (new) against running Strapi + seeded DB:
  - locale isolation
  - slug filter
  - pagination
  - menu-item → category same locale
  - media URL present for sample with image

### P6-05 — Optional CMS webhooks

**Thực hiện (optional, recommended if FE revalidate planned soon)**

- Signed publish/unpublish webhook when `CMS_WEBHOOK_URL` + `CMS_WEBHOOK_SECRET` set.  
- No-op when unset.  
- Pattern: Nhà Thật `src/api/cms-webhook/`.  
- Document payload + secret header for future Next route.

Skip if owner wants minimal Phase 6; record as follow-up.

### P6-06 — Domain validation polish

**Thực hiện**

- Campaign date range if not done in 4A.  
- Any contract-breaking schema mismatch fixed with content-model doc update.

## 6. Data and rollback

- Permission rows added by bootstrap: idempotent; rollback = revert code + manual permission cleanup or DB restore.  
- Opening public read is intentional; rollback is redeploy previous provisioner that does not grant (note: removing permissions may need explicit revoke helper — document if required).

## 7. Verification

```powershell
npm run test
npm run seed:demo
npm run verify:seed
npm run smoke:crud
npm run smoke:i18n
npm run smoke:api
npm run check
```

Manual:

- API Explorer / curl examples from contract on local.  
- Confirm Admin still works; editors unaffected.

Evidence: `docs/phase-06-verification.md`, refresh OpenAPI if documentation plugin used, STATUS.

## 8. Documentation impact

| File | Change |
| --- | --- |
| `docs/cms-api-contract.md` | Full contract |
| `docs/architecture.md` | Permissions + optional webhook |
| `docs/cms-technical-decisions.md` | Public read allowlist decision |
| `README.md` | smoke:api |
| OpenAPI generated | Refresh if committed |

## 9. Exit gate

1. Contract doc complete with real examples.  
2. Public allowlist provisioned in code.  
3. Positive + negative smokes pass.  
4. No public write.  
5. STATUS: ready for Phase 7 staging / FE handoff pack (FE still not implementing until Phase 7 gate).
