# Phase 5 — Seed nội dung prototype

## 1. Mục tiêu

Có script seed **idempotent** nạp nội dung mẫu từ prototype `../salanca-cms` (và design copy) vào Strapi, đủ để editor và (sau Phase 6) frontend team xem data thật — không phụ thuộc click tay từng entry.

**Ước lượng:** 2–3 ngày dev.

**Pattern source:** Nhà Thật `scripts/seed-*-demo/` (types, content builders, document upsert, tests).

## 2. Phụ thuộc

- Phase 4 closed or at least 4A + 4B usable (media URLs stable on S3).  
- Content model Phase 2 stable.  
- Prototype readable at `../salanca-cms` (HTML pages as copy reference only).

## 3. Non-goals

- Không machine-translate full EN để “đủ record”.  
- Không seed admin users/passwords.  
- Không mở public API (Phase 6).  
- Không import binary media từ Git LFS khổng lồ nếu không cần — ưu tiên ít ảnh placeholder + CDN.  
- Không sửa frontend.

## 4. Quyết định khóa

| Hạng mục | Quyết định |
| --- | --- |
| Identity | Stable `seedKey` or documented unique field per type; never rely on auto id |
| Locale order | Create/update `vi` first; then `en` when approved copy exists |
| EN incomplete | Draft only |
| Prices | Numeric decimals, not formatted strings |
| Idempotency | Second run: update-in-place or skip; zero duplicates |
| Media | Upload once or reuse existing by seed key; alt required via `shared.image` |
| Secrets | No production URLs/secrets in seed source |

## 5. Work breakdown

### P5-01 — Seed harness

**Thực hiện**

- `scripts/seed-salanca-demo/` structure:
  - `index.ts` entry
  - `types.ts`
  - `content/*.ts` per domain (global, menu, campaign, pages, …)
  - optional `document.ts` upsert helpers
- npm scripts: `seed:demo`, `verify:seed`.  
- Bootstrapping via Strapi programmatic API or documented `strapi console` pattern — pick one and stick to it; mirror BDS jiti runner only if needed for TS.

**Nghiệm thu**

- `npm run seed:demo` runs on empty DB after migrate/boot.  
- Exit code non-zero on fatal errors; prints summary created/updated/skipped.

### P5-02 — Global + locations

**Thực hiện**

- Seed `global-setting` singleton VI (+ EN if copy exists).  
- Seed `location` collection with operating hours components.  
- Hotline/email/map URLs not senselessly duplicated as “translated”.

### P5-03 — Menu domain

**Thực hiện**

- `menu-category` → `menu-item` (respect required category invariant).  
- `menu-package` with adult/child prices as numbers.  
- `menu-page` single type sections.

### P5-04 — Campaigns + gallery

**Thực hiện**

- `campaign` with kind enum, dates, CTA.  
- Prefer valid `endsAt >= startsAt` (align with validation if enabled in 4A).  
- `gallery-item` with area enum; optional location relation.

### P5-05 — Page single types

**Thực hiện**

- `home-page`, `story-page`, `experience-page`, `space-page`, `contact-page`, `booking-page`, `campaign-page`.  
- Fixed sections only; SEO component filled for VI.  
- `booking-page` = copy + contact guidance only (no reservation records).

### P5-06 — verify:seed

**Thực hiện**

Assertions examples:

- Expected minimum counts per type.  
- No duplicate seed keys/slugs per locale.  
- Prices typeof number / decimal parseable.  
- EN records that exist are Draft if marked incomplete.  
- Required relations present.  
- Published VI samples exist for smoke later.

### P5-07 — Editor spot-check

**Checklist**

- [ ] Admin shows seeded VI content.  
- [ ] Re-run seed does not duplicate.  
- [ ] Media alt visible.  
- [ ] One EN draft sample (if any) does not auto-publish.

## 6. Data and rollback

- Seed is additive/upsert; destructive reset = drop DB or targeted delete by seed key (document command).  
- Never run destructive reset on staging with real editor content without backup (Phase 7).

## 7. Verification

```powershell
npm run seed:demo
npm run verify:seed
npm run smoke:crud
npm run smoke:i18n
npm run check
```

Manual: Admin browse each major type.

Evidence: `docs/phase-05-verification.md` + STATUS.

## 8. Documentation impact

- `docs/cms-editor-guide.md` — “load demo data” section.  
- `README.md` — seed commands.  
- `cms-content-model.md` only if seed reveals schema gaps (fix schema in separate small PR if needed).

## 9. Exit gate

1. Empty DB → seed → verify pass.  
2. Second seed → no duplicates; verify pass.  
3. No admin credentials in repo.  
4. STATUS marks Phase 5 complete.
