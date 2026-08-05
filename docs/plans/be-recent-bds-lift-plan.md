# Plan — Lift recent Nhà Thật BE updates → Salanca BE

**Status:** Waves 0–4 implemented (2026-08-04); Wave 5 Strapi patch deferred  
**Date:** 2026-08-04  
**Source (read-only):** `D:\outsource\batdongsan-cms\backend-bds`  
**Target:** `D:\outsource\salanca\salanca-backend`  
**Baseline already done:** Pattern-lift Phase 4–6 (2026-08-03) — `/api/v1`, CORS, optional S3, public read bootstrap, seed/smoke, CM labels, media delete guard, document invariants  
**Related docs:** `salanca-backend/docs/plans/be-pattern-lift-plan.md`, `docs/STATUS.md`

---

## 1. Goal

Tham khảo các update BE **gần đây** (≈ 2026-08-01 → 2026-08-04) của Nhà Thật (`backend-bds`, Phase 9–15 + hardening) và **port chỉ các pattern kỹ thuật / ops** còn thiếu sang Salanca restaurant CMS — không copy domain BĐS.

Kết quả mong đợi:

1. Gap analysis rõ: đã có / nên port / không port.
2. Chuỗi phase implementation có gate, non-goals, verification.
3. Code + docs cập nhật theo thứ tự an toàn (foundation → content quality → ops handoff).

---

## 2. Non-goals (khóa cứng)

| Không làm | Lý do |
| --- | --- |
| End-user membership / Plus / contact-access quota | BĐS-only |
| Password recovery + Resend/SMTP transactional mail (Phase 10) | Roadmap Salanca: không public auth end-user; form/email = phase Forms sau |
| `project` collection, property watermark profile | Domain BĐS |
| Contact-request intake write model | Explicit non-goal roadmap; phase Forms riêng |
| End-user audit middleware, profile API | Không có end-user session product |
| Copy footer BĐS `site-footer` schema nguyên si | Salanca đã có `global-setting`; chỉ lift **pattern validation** nếu cần |
| Big-bang Strapi major upgrade | Chỉ patch align nếu làm, PR riêng |
| FE integration trong plan này | Phase 7 handoff pack only |

---

## 3. Snapshot: BDS recent vs Salanca hiện tại

### 3.1 Commits / phase BDS gần đây (backend-bds)

| Khi | Phase / theme | Nội dung chính |
| --- | --- | --- |
| 08-02 | Phase 9 | S3 **mọi env** fail-closed, CDN CSP, CloudFly ACL, reconcile |
| 08-02 | Phase 6/8 content | Site contact, contact intake, support channels |
| 08-02 | Phase 11 | `src/shared/normalization/` (value + phone) |
| 08-02→04 | Phase 10 | Password reset hardened + Resend SMTP |
| 08-02→03 | Phase 12 | `project` + safe Google Maps embed (`parse5`) |
| 08-03 | Phase 15 | Localized `site-footer` + closed `destinationKey` |
| 08-04 | Phase 13 | Pre-storage WebP pipeline (`sharp`, private source, processing record) |
| 08-04 | Phase 14 | `focalPointX/Y` trên media-with-alt + presentation validation |

### 3.2 Salanca đã có (không làm lại)

- `API_REST_PREFIX=/api/v1`, CORS `FRONTEND_URLS`
- Media helper + **optional** S3 khi `S3_BUCKET` set (local disk vẫn default)
- Upload delete **reference guard**
- Bootstrap: locales, public read allowlist, CM labels + Admin VI + field-hint hide
- Seed modular + verify + smoke:api/crud/i18n
- Document invariants: menu relations, campaign date range
- Vitest + `npm run check` / phase gates
- Strapi **5.50.2** (BDS đã **5.51.1**)

### 3.3 Gap map (portable patterns còn thiếu)

| Pattern BDS | Salanca | Ưu tiên | Ghi chú |
| --- | --- | --- | --- |
| S3 **required** mọi env + CDN fail-closed | Optional `S3_BUCKET` | **P1** | Align Phase 9 decision D2 trong lift plan; owner vẫn cần bucket local/staging |
| `config/env.helper.ts` | Inline `requireEnv` rải rác | **P1** | Foundation cho media/webhook/email sau này |
| Config unit tests (`plugins`, `middlewares`, media provider) | Thiếu một phần | **P1** | Giảm regression khi siết S3 |
| Shared normalization (`isPlainRecord`, `trimmedNonEmptyString`) | Chưa | **P1** | Phase 11 style; dùng cho invariants / future helpers |
| Safe map URL normalize (embed/iframe → HTTPS allowlist) | `mapUrl` free string | **P2** | Port helper thuần, gắn `location` + `global-setting` |
| Social URL platform hostname policy | Free URL | **P2** | Pattern Phase 15 social validation |
| Nav `destinationKey` closed registry (thay free `url`) | `shared.link` free URL | **P2** | Breaking contract; cần FE agreement — có thể **defer** |
| Presentation focal points trên image component | `shared.image` chỉ media/alt/caption | **P2** | Port Phase 14 fields + pure validation |
| Signed CMS webhooks (revalidate) | Documented optional only | **P2** | Cho Phase 7 / FE cache |
| Pre-storage WebP processing (Phase 13) | Chưa | **P3** | Phụ thuộc S3 fail-closed; **không** watermark property |
| Strapi 5.50.2 → 5.51.1 | Chưa | **P3** | PR riêng + backup + full gate |
| Media processing record CT, private source lifecycle | Chưa | **P3** | Theo sau WebP nếu bật |
| Contact form write + email notify | Ngoài scope | — | Forms phase |
| Auth recovery / Resend | Ngoài scope | — | Không port |

---

## 4. Decisions (đề xuất; owner có thể reject)

| ID | Decision |
| --- | --- |
| D1 | Chỉ port **pattern**; domain giữ restaurant (menu, campaign, pages, location, global-setting). |
| D2 | **Media storage:** tiến tới S3-compatible **required** khi `NODE_ENV=production` **hoặc** flag `MEDIA_STORAGE_MODE=s3`; local dev có thể giữ disk **cho đến** khi có MinIO/CloudFly local bucket — **không** bắt dev không có S3 fail boot trong wave 1 nếu owner chưa cấp credential. Wave 2 (staging) = fail-closed như BDS. |
| D3 | WebP processing (P3) **opt-in** qua `MEDIA_PROCESSING_ENABLED`; profile chỉ `editorial-clean` (không watermark). |
| D4 | Focal points: additive fields trên `shared.image` (default 50/50), backward compatible seed. |
| D5 | Map URL: validate/normalize optional fields; widen max length nếu paste iframe (BDS fix `officeMapUrl`). |
| D6 | Free-form nav URLs **giữ** trong wave 1; destinationKey registry chỉ khi FE sẵn sàng paired contract. |
| D7 | Strapi patch align = change riêng, không gộp feature wave. |
| D8 | Package manager: giữ npm + lockfile hiện tại (không ép pnpm). |

---

## 5. Implementation waves

```text
Wave 0  Docs + STATUS gap lock (this plan → docs/plans/)
    ↓
Wave 1  Foundation: env.helper, normalization, config test parity, S3 path tighten
    ↓
Wave 2  Content boundary quality: map URL, social URL, focal points (+ optional image a11y invariants)
    ↓
Wave 3  Ops for FE: signed CMS webhooks + public permission/docs updates
    ↓
Wave 4  Optional media pipeline: WebP editorial-clean (depends S3 + sharp)
    ↓
Wave 5  Strapi patch align 5.51.x (dedicated)
    ↓
(existing) Phase 7 staging + handoff (ops humans + providers)
```

Mỗi wave: adapt code từ BDS (rename UIDs, drop BĐS types), unit tests trước/cùng helper, `npm run check` (+ smoke khi DB available).

---

### Wave 0 — Document the follow-up plan

**Files**

- Thêm `salanca-backend/docs/plans/be-recent-bds-lift-plan.md` (bản ổn định của plan này).
- Update `docs/STATUS.md` section “Next authorized work” + link plan.
- Update `docs/plans/be-pattern-lift-plan.md` completion note: Phase 4–6 code done; follow-up = recent BDS 9–15 patterns.

**Done when:** Owner/dev có single source of truth trong repo Salanca.

---

### Wave 1 — Foundation (P1) — ~1–2 ngày

#### W1-01 `config/env.helper.ts` (+ test)

Port từ BDS:

- `requireEnvValue`, `emailAddressPattern` / `isValidEmailAddress` (email helpers sẵn cho Forms sau; không bật SMTP).
- Dùng lại trong `media-storage.helper` thay duplicate.

#### W1-02 `src/shared/normalization/value.ts` (+ test)

Port Phase 11 primitives:

- `isPlainRecord`
- `trimmedNonEmptyString`

**Không** port phone E.164 trừ khi Wave 2 hotline validation cần — nếu cần, port `phone.ts` nhưng policy lỗi vẫn thuộc `global-setting` helper.

#### W1-03 Config test parity

Port/adapt:

- `media-storage.provider.test.ts` patterns (ACL `public-read` vs undefined, path-style endpoint)
- `middlewares` CSP + CORS coverage nếu còn mỏng
- `plugins` upload branch (disk vs S3)

#### W1-04 S3 policy tighten (không full fail-closed nếu owner chưa sẵn)

1. Document rõ staging/prod **must** set `S3_BUCKET` + `CDN_URL` + credentials.
2. Optional: `assertProductionMediaStorage(env)` throw khi production thiếu S3.
3. Giữ local disk khi unset (khác BDS) — ghi decision trong `cms-technical-decisions.md`.
4. Ensure CloudFly-style `ACL: public-read` path đã test (BDS fix `6314240`).

**Verify**

```powershell
npm run test
npm run typecheck
npm run lint
```

---

### Wave 2 — Content boundary quality (P2) — ~2–3 ngày

#### W2-01 Safe map URL helper

Port **pure** logic từ `project.map-embed.helper.ts` → `src/shared/map-url/` (hoặc `domain/map-embed/`):

- Accept HTTPS Maps embed URL **or** single iframe → persist only normalized `src`.
- Reject secrets in query, non-allowlisted hosts, raw HTML multi-node.
- Dependency: `parse5` (cùng approach BDS).

Wire via Document Service middleware / lifecycle on:

- `api::location.location` → `mapUrl`
- `api::global-setting.global-setting` → `mapUrl`

Schema: tăng `maxLength` nếu cần paste iframe tạm (BDS migration widen) — persist normalized URL ngắn hơn.

#### W2-02 Social link hostname policy

Helper: platform enum → allowed host suffixes (facebook, instagram, tiktok, youtube; `other` = HTTPS only).

Wire on `shared.social-link` consumers (global-setting) at publish/update boundary.

#### W2-03 Presentation focal points (Phase 14 lite)

1. Extend `src/components/shared/image.json`:
   - `focalPointX`, `focalPointY` float 0–100, default 50, required
   - Optionally `decorative` boolean if a11y model wants parity (Salanca currently requires `alt` always — **keep required alt**; do not silently switch to decorative-without-alt without product decision)
2. Port pure `presentation-media` validation (focal only; ratio checks soft/best-effort).
3. Register invariant in `document-invariants` for components using `shared.image` (or validate at component level on save of parent types).
4. Update seed builders to include defaults.
5. Update `docs/cms-api-contract.md` + `cms-content-model.md` field table.

**Defer:** closed `destinationKey` nav registry (breaking for FE/seed). Track as Wave 2.5 if FE requests.

**Verify**

```powershell
npm run test
npm run verify:schema
npm run seed:demo   # if Postgres up
npm run verify:seed
npm run smoke:api
```

---

### Wave 3 — Signed CMS webhooks (P2 ops) — ~1–2 ngày

Port slim version of `src/api/cms-webhook/`:

- HMAC SHA-256 signature verify
- Allowlist UIDs = Salanca public content types only
- Allowlist locales `vi` | `en`
- Body size cap
- Emit on publish/unpublish lifecycle (not every draft save unless product wants)

Env: `CMS_WEBHOOK_SECRET`, `CMS_WEBHOOK_URL` (optional enable when URL set).

Docs: `docs/cms-api-contract.md` webhook section; Phase 7 handoff note for Next revalidate.

**Out:** audit-event persistence table (BDS) — log-only first; audit CT optional later.

**Verify:** unit tests for sign/verify/allowlist; no live HTTP required.

---

### Wave 4 — Editorial WebP pipeline (P3, optional) — ~3–5 ngày

Only after Wave 1 S3 path is real on a bucket.

Port **subset** of `src/domain/media-processing/`:

| Keep | Drop |
| --- | --- |
| sharp decode → orient → resize bounds → WebP | Property watermark asset/profile |
| `editorial-clean` only | `property-public` profile |
| Opt-in `MEDIA_PROCESSING_ENABLED` | Fail-closed watermark policy |
| Private source + processing record **if** S3 private prefix ready | Forced private-source before product legal OK |

Upload extension: decorate optimize + reference-safe remove (already have remove).

**Verify:** unit tests processor; manual upload smoke → WebP public object; legacy media untouched.

---

### Wave 5 — Strapi patch align (P3, dedicated) — ~0.5–1 ngày + regression

- Upgrade `@strapi/*` 5.50.2 → **same patch as BDS (5.51.1)** via official tooling.
- Backup DB first.
- Full `npm run check` + smoke + Admin boot.

Không gộp feature waves.

---

## 6. Target shape (additive)

```text
salanca-backend/
├── config/
│   ├── env.helper.ts (+ test)              # Wave 1
│   ├── media-storage.helper.ts             # tighten
│   └── … existing
├── src/
│   ├── shared/
│   │   ├── normalization/value.ts          # Wave 1
│   │   ├── map-url/…                       # Wave 2
│   │   └── presentation-media/…            # Wave 2
│   ├── api/cms-webhook/…                   # Wave 3
│   ├── domain/
│   │   ├── document-invariants/            # extend
│   │   └── media-processing/               # Wave 4 optional
│   └── components/shared/image.json        # focal fields
└── docs/plans/be-recent-bds-lift-plan.md
```

---

## 7. Verification philosophy

- Evidence = commands + tests, not “BDS already did it”.
- Port = **adapt** (UIDs, product names, drop BĐS); no blind copy of `project` / auth / contact-request.
- Each wave updates `STATUS.md` with date + pass/fail table.
- Manual Admin UAT Phase 0 vẫn open (human) — không block Wave 1–2 unit work.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Force S3-every-env breaks local Windows without bucket | Wave 1 production-only assert; local disk until credential |
| Focal fields break old Admin drafts | Defaults 50/50; required with default |
| Map iframe paste UX vs free URL | Normalize on write; document editor paste flow |
| WebP doubles storage / complexity | Wave 4 opt-in; no watermark |
| Scope creep Forms/auth | Non-goals table; reject in review |
| Strapi upgrade side effects | Dedicated wave + backup |

---

## 9. Suggested first PR sequence (sau khi approve)

1. **docs-only** Wave 0  
2. **foundation** Wave 1  
3. **map + social + focal** Wave 2 (có thể tách 2 PR: map/social | focal)  
4. **webhooks** Wave 3  
5. **webp** Wave 4 (optional)  
6. **strapi patch** Wave 5  

---

## 10. Open questions for owner (nếu cần chốt trước code)

1. Local dev: giữ disk upload hay bắt MinIO/S3 như BDS Phase 9?  
2. Focal points: có cần ngay cho FE crop hero/gallery hay chỉ chuẩn bị schema?  
3. Webhook revalidate: FE đã có endpoint chưa, hay chỉ scaffold BE?  
4. Wave 4 WebP: làm trước staging hay sau khi có CDN thật?

*(Nếu không trả lời: plan mặc định D2–D6 ở mục 4.)*

---

## 11. Immediate next step after approval

1. Ghi plan vào `salanca-backend/docs/plans/be-recent-bds-lift-plan.md`.  
2. Start **Wave 1** implementation (env.helper + normalization + tests + production S3 assert).  
3. Không đụng Phase 10 auth/email / project / contact-request.
