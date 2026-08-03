# Plan — Pattern lift BE từ Nhà Thật → Salanca

Status: Draft (ready for owner review)
Owner: backend lead + project owner
Last updated: 2026-08-03
Related roadmap: [`../strapi-backend-roadmap.md`](../strapi-backend-roadmap.md)
Sibling reference (read-only patterns): `D:\outsource\batdongsan-cms\backend-bds`

## Goal

Mang các **pattern kỹ thuật và vận hành** đã ổn định ở backend Nhà Thật (`backend-bds`) sang `salanca-backend`, để CMS Salanca sẵn sàng staging và handoff frontend — **không** copy domain bất động sản.

Kết quả: Phase 4–7 có spec chi tiết, BE-first, design prototype (`../salanca-cms`) chỉ là nguồn nội dung tham chiếu.

## Non-goals

- Không tích hợp hoặc redesign `salanca-web` / `salanca-cms` trong plan này.
- Không port membership, contact-reveal quota, end-user Plus tier, project listing BĐS.
- Không xây booking engine, payment, CAPTCHA, Zalo/SMS trong plan này.
- Không tạo reservation/contact write models cho đến phase Forms riêng sau CMS-first.
- Không big-bang rewrite content model Phase 2–3 đang ổn.

## Current evidence

- Salanca Phase 1–3: schema, i18n VI/EN, smoke CRUD/i18n, deny-by-default public API — xem [`../STATUS.md`](../STATUS.md).
- Salanca roadmap Phase 4–7 chỉ outline — chưa có spec chấp nhận được để implement.
- Nhà Thật đã có: API prefix `/api/v1`, bootstrap provisioning, S3 mọi env, public permission allowlist, Vitest helper tests, seed/migrate scripts, media delete guard, CORS allowlist, architecture docs.

## Decisions and assumptions

### Decisions (accepted by this plan unless owner rejects)

| ID | Decision |
| --- | --- |
| D1 | Chỉ port **pattern** (config fail-fast, bootstrap idempotent, S3, permissions code, seed, quality gates). Domain giữ restaurant CMS. |
| D2 | Media: **S3/R2-compatible mọi environment** (kể cả local dev bucket/prefix riêng). Không coi local-disk là path production; tránh drift SQLite-style cho media. |
| D3 | REST prefix chuẩn hóa **`/api/v1`** trước khi frontend lock contract. |
| D4 | Public read permissions **provision bằng bootstrap code** (allowlist `find`/`findOne`), không cấu hình tay một lần trên Admin rồi quên. |
| D5 | Package manager: giữ **npm + lockfile** hiện tại trong plan này trừ khi owner yêu cầu chuyển pnpm (đồng bộ salanca-web). Đổi package manager = change riêng. |
| D6 | Strapi upgrade (5.50.2 → newer patch) = change riêng, không gộp vào Phase 4 feature work. |
| D7 | BE-first: FE integration chỉ sau Phase 7 handoff pack. |

### Assumptions

- Owner sẽ ghi tên người + provider (host, Postgres, S3, domain/CORS) trước khi implement Phase 4B/7.
- Manual Admin UAT Phase 2–3 sẽ hoàn tất (hoặc được waive có ghi chú) trước khi coi Phase 4 “in progress” là authorized.
- Prototype `../salanca-cms` đủ để seed Phase 5 copy VI; EN draft-only khi chưa có bản dịch duyệt.

### Owner decisions still required

Ghi vào [`../cms-technical-decisions.md`](../cms-technical-decisions.md):

1. Hosting Strapi  
2. Managed PostgreSQL + retention  
3. S3/R2 vendor + bucket strategy (local/staging/prod)  
4. Production/staging domains + CORS allowlist  
5. Người chịu trách nhiệm Node staging validation  

## Pattern map (Nhà Thật → Salanca)

| Pattern Nhà Thật | Target phase Salanca | Notes |
| --- | --- | --- |
| Phase specs + gates + non-goals | Phase 0, 4–7 docs | Đã viết dưới `docs/phases/` |
| `API_REST_PREFIX` + validation | Phase 4A | Default `/api/v1` |
| CORS / frontend origin allowlist | Phase 4A | Env-driven |
| Bootstrap modules (locales, permissions) | Phase 4A, 6 | Tách khỏi `src/index.ts` |
| S3 provider + CDN CSP + fail-fast | Phase 4B | Mọi env |
| Media delete reference guard | Phase 4B | `extensions/upload` style |
| Admin role matrix + token policy | Phase 4C | Community edition limits documented |
| Idempotent seed scripts | Phase 5 | From prototype |
| Public content permission provisioner | Phase 6 | Allowlist only |
| Explicit populate API contract | Phase 6 | No `populate=*` as default |
| Signed CMS webhooks (optional) | Phase 6 optional | For future Next revalidate |
| Export/import + backup/restore runbook | Phase 7 | Ops |
| End-user audit / BFF auth | **Out of scope** | Revisit only if Salanca adds accounts |
| Contact-access / membership | **Out of scope** | BĐS-only |

## Phase sequence

```text
Phase 0  Close Phase 1–3 UAT + platform decisions
    ↓
Phase 4  Hardening + S3 media + Admin roles   (4A → 4B → 4C)
    ↓
Phase 5  Idempotent seed from prototype
    ↓
Phase 6  Public read contract + provisioner + API QA
    ↓
Phase 7  Staging + backup drill + FE handoff pack
    ↓
(later)  FE integration · Forms BE · Automation · Booking
```

Chi tiết:

| Phase | Spec | Ước lượng |
| --- | --- | --- |
| 0 — Close UAT & decisions | [`../phases/phase-00-close-uat-and-decisions.md`](../phases/phase-00-close-uat-and-decisions.md) | 0.5–1 ngày + owner latency |
| 4 — Hardening, media, roles | [`../phases/phase-04-hardening-media-roles.md`](../phases/phase-04-hardening-media-roles.md) | 3–5 ngày dev |
| 5 — Seed prototype | [`../phases/phase-05-seed-content.md`](../phases/phase-05-seed-content.md) | 2–3 ngày dev |
| 6 — API contract & public read | [`../phases/phase-06-api-contract-and-qa.md`](../phases/phase-06-api-contract-and-qa.md) | 2–3 ngày dev |
| 7 — Staging & handoff | [`../phases/phase-07-staging-and-handoff.md`](../phases/phase-07-staging-and-handoff.md) | 2–4 ngày + infra |

## Invariants (toàn bộ plan)

1. PostgreSQL only — never SQLite fallback.  
2. Public API write remains denied.  
3. Locale VI default, EN secondary; no silent cross-locale fallback in API.  
4. Draft & Publish independent per locale.  
5. Prices stored as numbers; frontend formats.  
6. Secrets only in env / secret store; never in Git.  
7. Fixed page schemas — no generic page builder.  
8. Reservation/contact write models stay deferred.

## Target repository shape (incremental)

```text
salanca-backend/
├── config/
│   ├── api-prefix.helper.ts (+ test)
│   ├── media-storage.helper.ts (+ test)
│   ├── middlewares.ts
│   └── plugins.ts
├── src/
│   ├── bootstrap/
│   │   ├── content-locales/
│   │   └── public-content-permissions/   # Phase 6
│   ├── api/…                             # existing schemas
│   ├── extensions/upload/                # Phase 4B delete guard
│   └── index.ts                          # thin register/bootstrap compose
├── scripts/
│   ├── seed-salanca-demo/                # Phase 5
│   └── verify-seed/
├── docs/
│   ├── architecture.md                   # Phase 4A
│   ├── plans/be-pattern-lift-plan.md     # this file
│   └── phases/phase-0{0,4,5,6,7}-*.md
```

## Verification philosophy

- Mỗi phase có **automated commands** + **manual UAT** + **documentation updates**.  
- “Roadmap says X” ≠ “X is done”. STATUS + verification report mới là evidence.  
- Port code từ Nhà Thật phải **adapt** (paths, content UIDs, product names), không copy-paste mù.

## Risks and blockers

| Risk | Mitigation |
| --- | --- |
| Owner decisions chậm → Phase 4B/7 kẹt | Phase 4A có thể chạy song song với decision gathering; 4B/7 blocked explicitly |
| S3 vendor chưa chọn | Helper viết S3-API-compatible (endpoint + path-style) như BDS Phase 9 |
| Seed EN bịa → SEO rác | EN draft-only policy; verify script |
| Mở public API quá sớm | Phase 6 only; provisioner allowlist; smoke negative tests |
| Scope creep booking/forms | Explicit non-goals; separate future phase |
| Strapi security advisories | Dedicated upgrade PR; never `npm audit fix --force` |

## Documentation impact

- New phase specs under `docs/phases/`.  
- This overview under `docs/plans/`.  
- Update [`../STATUS.md`](../STATUS.md), [`../README.md`](../README.md) map, roadmap links.  
- Implementation later updates `cms-technical-decisions.md`, `cms-api-contract.md`, `architecture.md`.

## Completion record

- [x] Overview plan drafted (2026-08-03).  
- [x] Phase 0, 4, 5, 6, 7 detailed specs drafted.  
- [ ] Owner review / approve.  
- [ ] Phase 0 gates closed.  
- [ ] Implementation starts at Phase 4A only after Phase 0 entry for 4 is met.
