# Phase 7 — Staging, backup/restore, FE handoff

## 1. Mục tiêu

Đưa CMS lên **staging** ổn định (Strapi + PostgreSQL + S3/CDN + HTTPS), chứng minh backup/restore, hoàn thiện runbook editor/ops, và bàn giao **handoff pack** cho team frontend — **không** implement integration trong `salanca-web` ở phase này.

**Ước lượng:** 2–4 ngày (phụ thuộc infra access).

**Pattern source:** Nhà Thật media ops + data export/import notes; Salanca roadmap Phase 7.

## 2. Phụ thuộc

- Phase 4–6 closed (or Phase 6 contract frozen even if optional webhook deferred).  
- Owner decisions: host, Postgres, S3, domains, DNS, secrets store.  
- Named humans for deploy access.

## 3. Non-goals

- Production cutover (can reuse runbook later).  
- Frontend route wiring, SEO implementation, cache in Next.  
- Booking/forms automation.  
- Guaranteeing 100% EN translated content.

## 4. Work breakdown

### P7-01 — Staging infrastructure

**Thực hiện**

- Provision Strapi Node service, managed Postgres, S3 bucket/prefix `staging/`, CDN.  
- Env from secret store matching `.env.example` (no secrets in Git).  
- `FRONTEND_URLS` / CORS include staging web origin if exists; otherwise admin-only.  
- `API_REST_PREFIX=/api/v1`.  
- HTTPS admin + API domains.

**Nghiệm thu**

- Health/boot OK.  
- Admin login via HTTPS.  
- Upload media lands in staging bucket.

### P7-02 — Deploy application

**Thực hiện**

- Deploy pinned commit.  
- Run DB migrations / first boot.  
- `seed:demo` on staging **only if** staging is disposable; never blind-seed shared content DB without backup.

### P7-03 — Backup and restore drill

**Thực hiện**

1. `pg_dump` (or provider snapshot).  
2. Bucket versioning / backup note.  
3. Optional `strapi export` encrypted for content snapshot (understand: not full DR alone).  
4. Restore to scratch instance or prove provider restore once.  
5. Record time, owner, result in verification doc.

**Nghiệm thu**

- At least one successful restore proof.  
- Known limitations listed (what export does not include: admin users, etc.).

### P7-04 — Security staging pass

**Thực hiện**

- Re-run `npm audit` against public registry; no `audit fix --force`.  
- Confirm public write denied on staging.  
- Confirm secrets not in build logs.  
- Follow [`../security-baseline.md`](../security-baseline.md).

### P7-05 — Editor UAT on staging

**Checklist**

- [ ] Editor creates/translates/publishes one campaign without developer.  
- [ ] Draft/publish per locale.  
- [ ] Media upload + alt.  
- [ ] Data survives restart/redeploy.

### P7-06 — Operations runbook

**Thực hiện**

- Create/update `docs/cms-operations-runbook.md`:
  - deploy steps
  - env matrix
  - backup/restore
  - seed policy
  - incident: rotate secrets, revoke tokens
  - upgrade Strapi procedure pointer

### P7-07 — Frontend handoff pack

Deliver to FE team (document in `docs/fe-handoff.md` or section of STATUS):

| Item | Content |
| --- | --- |
| Staging API base URL | `https://…/api/v1` |
| Admin URL | for content preview only |
| Contract | link `cms-api-contract.md` |
| Locale rules | required `locale`, no server fallback |
| Populate maps | copy from contract |
| CORS origins | what is allowlisted |
| Auth | public read only; token plan if any |
| Webhook | if enabled: URL contract + secret out-of-band |
| Out of scope | forms, booking, account |
| Known limitations | EN coverage, component nested field sync policy |

**Explicit:** FE implements in a **later approved phase** (roadmap FE-1/FE-2).

## 5. Data and rollback

- Staging deploy rollback = previous image/commit + DB restore if schema migrated forward-only.  
- Prefer expand-contract migrations if schema changes after seed.  
- Production not in scope; do not point staging seed at production bucket.

## 6. Verification

- Staging smoke: health, Admin, one public GET published VI, one negative write.  
- Restore drill evidence.  
- Security notes.  
- Editor UAT sign-off.

Evidence: `docs/phase-07-verification.md`, STATUS “CMS-first milestone ready for FE phase”.

## 7. Documentation impact

| File | Change |
| --- | --- |
| `docs/cms-operations-runbook.md` | New/complete |
| `docs/fe-handoff.md` or STATUS section | Handoff pack |
| `docs/cms-editor-guide.md` | Staging URL notes |
| `docs/cms-technical-decisions.md` | Final provider values |
| `docs/STATUS.md` | Milestone status |

## 8. Exit gate (CMS-first milestone)

Aligned with roadmap Definition of Done:

1. Strapi on staging with PostgreSQL + S3/CDN.  
2. Schema in Git + content model docs.  
3. Admin CRUD + VI/EN + roles verified.  
4. Public read allowlist + contract + smokes.  
5. Seed path exists; staging content policy documented.  
6. Backup/restore proven once.  
7. FE handoff pack delivered.  
8. Frontend code **not** required to change for this phase to close.

## 9. After Phase 7 (out of this plan)

1. FE-1: integrate global, menu, campaigns, gallery, pages.  
2. FE-2: routing/SEO/cache/revalidate.  
3. Forms BE: contact/reservation lead endpoints + rate limit.  
4. Automation: notify channels, CAPTCHA.  
5. Booking engine only with real product requirements.
