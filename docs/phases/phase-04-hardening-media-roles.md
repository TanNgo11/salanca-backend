# Phase 4 — Hardening, media production-grade, Admin roles

## 1. Mục tiêu

Nâng `salanca-backend` từ CMS dev-ready (Phase 1–3) lên **foundation production-shaped**:

1. **4A** — Config fail-fast, API versioning, CORS, bootstrap modules, unit test gate.  
2. **4B** — Object storage (S3-compatible) + CDN CSP + media delete safety.  
3. **4C** — Admin roles, token policy, manual permission UAT.

Frontend vẫn **chưa** tích hợp. Public Content API **vẫn deny** read/write cho anonymous cho đến Phase 6.

**Ước lượng:** 3–5 ngày dev (4A ~1.5n, 4B ~2n, 4C ~1n), chưa gồm chờ credentials S3.

**Pattern source:** `batdongsan-cms/backend-bds` — `config/api-prefix.helper.ts`, `config/media-storage.helper.ts`, `config/middlewares.ts`, `config/plugins.ts`, `src/bootstrap/*`, `src/extensions/upload/`, phase-9 media docs.

## 2. Phụ thuộc

- Phase 0 exit gate met (UAT/decisions/STATUS authorize).  
- Spec này được owner/backend lead approve.  
- **4B** cần S3/R2 credentials + bucket (hoặc MinIO local) trước khi mark 4B complete.  
- PostgreSQL local vẫn chạy qua Docker Compose.

## 3. Non-goals

- Mở Public role `find`/`findOne` (Phase 6).  
- Seed full prototype (Phase 5).  
- Staging deploy (Phase 7).  
- Custom Admin screens, end-user auth BFF, audit trail end-user.  
- Strapi major/minor upgrade gộp chung (change riêng).  
- Đổi npm → pnpm trừ khi owner yêu cầu change riêng.

## 4. Quyết định khóa trong phase

| Hạng mục | Quyết định |
| --- | --- |
| REST prefix | `API_REST_PREFIX` default `/api/v1`; validate lowercase path, no trailing slash |
| CORS | Allowlist từ env (`FRONTEND_URLS` hoặc `CORS_ORIGINS`); non-local empty list = fail startup |
| Upload provider | `@strapi/provider-upload-aws-s3` pin cùng version line Strapi; S3 API compatible |
| Local media | Bucket/prefix dev riêng; **không** fallback silent sang `public/uploads` khi production-shaped config bật |
| CDN | `CDN_URL` bare origin; inject CSP `img-src` / `media-src` |
| ACL | Hỗ trợ ACL-disabled (AWS) và `public-read` (vendor kiểu CloudFly) qua env |
| Bootstrap | Locale provisioning tách module; idempotent |
| Public API | Vẫn deny-by-default |
| Unit tests | Vitest cho pure helpers (config/bootstrap helpers) |

## 5. Work breakdown

### Track 4A — Foundation hardening

#### P4A-01 — API prefix helper

**Thực hiện**

- Thêm `config/api-prefix.helper.ts` (+ `.test.ts`).  
- Wire `config/api.ts` (và chỗ cookie/path liên quan nếu có) dùng helper.  
- Cập nhật `.env.example`: `API_REST_PREFIX=/api/v1`.  
- Cập nhật [`../cms-api-contract.md`](../cms-api-contract.md) base path.

**Nghiệm thu**

- Unit tests cover valid/invalid prefixes.  
- Invalid prefix fails startup with clear error.  
- Routes list under `/api/v1/...` (verify via Strapi docs or `routes:list` nếu dùng).

#### P4A-02 — CORS allowlist

**Thực hiện**

- `config/middlewares.ts`: CORS origins từ env, credentials policy rõ ràng.  
- Local may allow `http://localhost:3000` default documented.  
- Staging/production: require explicit list.

**Nghiệm thu**

- Helper/unit test for parsing allowlist.  
- Document env vars in README + `.env.example`.

#### P4A-03 — Bootstrap split: content locales

**Thực hiện**

- Move VI/EN locale ensure logic from `src/index.ts` → `src/bootstrap/content-locales/`.  
- `src/index.ts` chỉ compose register/bootstrap.  
- Keep idempotent behavior; do not delete unexpected locales automatically.

**Nghiệm thu**

- Fresh DB still gets `vi` default + `en`.  
- Existing smoke:i18n still pass.

#### P4A-04 — Extract document middleware modules

**Thực hiện**

- Move menu-item/category invariants from inline `register` into testable module(s), e.g. `src/middlewares/document-invariants/` or `src/domain/menu/`.  
- Optional same track: campaign `endsAt >= startsAt` if Phase 0 chose fix-now.

**Nghiệm thu**

- Unit tests for relation guards.  
- Manual or smoke: cannot delete category with items; cannot create item without category.

#### P4A-05 — Vitest + quality gate

**Thực hiện**

- Add `vitest`, `npm run test`, expand `npm run check` → schema + typecheck + test + build (lint optional if ESLint added).  
- Prefer pure functions; do not require full Strapi boot for unit tests.

**Nghiệm thu**

```powershell
npm run test
npm run check
```

#### P4A-06 — Architecture doc

**Thực hiện**

- Add [`../architecture.md`](../architecture.md): ownership map (Strapi vs future Next), startup composition, config seams, media, permissions timeline, doc routing.  
- Style reference: Nhà Thật `docs/architecture.md` — adapt, do not paste BĐS product.

**Nghiệm thu**

- Docs map in `docs/README.md` links architecture.  
- New contributors can find “who owns what” without reading all phases.

### Track 4B — S3 media + safety

#### P4B-01 — Install provider

**Thực hiện**

- Add `@strapi/provider-upload-aws-s3` aligned with `@strapi/strapi` version.  
- No interactive Marketplace install as source of truth.

#### P4B-02 — media-storage helper

**Thực hiện**

- `config/media-storage.helper.ts` (+ tests):  
  - `S3_BUCKET`, `S3_REGION`, `S3_ROOT_PATH`, `CDN_URL`  
  - optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`  
  - optional static key pair or ambient credentials  
  - optional `S3_ACL=public-read` vs ACL omitted  
- Wire `config/plugins.ts` upload config.  
- Fail startup on missing/malformed required storage config **when storage mode is enabled** (document local bootstrap path if temporary bypass exists — prefer zero bypass).

**Nghiệm thu**

- Unit tests for AWS shape vs S3-compatible shape.  
- Upload one image in Admin; URL uses CDN origin.  
- Restart Strapi; media still reachable.

#### P4B-03 — CSP for CDN

**Thực hiện**

- Append CDN origin to `img-src` / `media-src` in security middleware (same origin helper as media config).

**Nghiệm thu**

- Admin preview loads remote media without CSP console errors for that origin.

#### P4B-04 — MIME / size policy

**Thực hiện**

- Review `allowedTypes` / `deniedTypes`; tighten to product need (restaurant site: images + maybe PDF).  
- Document max upload size if configured.

#### P4B-05 — Media delete reference guard

**Thực hiện**

- Port pattern: refuse delete when file still related to documents; Vietnamese or bilingual error message consistent with Admin language policy.  
- Tests for guard helper.

**Nghiệm thu**

- Deleting in-use asset blocked; unused asset deletable.

#### P4B-06 — Media ops notes

**Thực hiện**

- Short section or `docs/media-storage-operations.md`: backup bucket, env matrix, no commit of uploads, export/import interaction with S3.

### Track 4C — Admin roles & tokens

#### P4C-01 — Role matrix document

**Thực hiện**

| Role | Allowed | Denied |
| --- | --- | --- |
| Super Admin | System, plugins, tokens, all content | — |
| Content Editor | CRUD content + media | Users, tokens, plugins, critical settings |
| Publisher | Editor + publish/unpublish | System settings |

Document Community edition limits honestly if RBAC depth is limited.

#### P4C-02 — Manual multi-account UAT

**Checklist**

- [ ] Editor cannot open API token / plugin settings.  
- [ ] Publisher can publish campaign/page.  
- [ ] Editor draft-only path works if that is policy.  
- [ ] Anonymous Content API still denied.

#### P4C-03 — Token policy

**Thực hiện**

- Document: no full-access token in browser; server tokens least privilege; rotation plan.  
- Do not put admin JWT in frontend env examples.

## 6. Data and rollback

- **4A:** mostly config; rollback = revert commit; DB schema unchanged.  
- **4B:** media uploaded to S3 after cutover; local `public/uploads` legacy not auto-migrated (same stance as Nhà Thật Phase 9: no legacy media migration unless owner orders it).  
- **4C:** Admin role changes — document how to restore Super Admin access.

## 7. Verification

### Automated

```powershell
npm ci
npm run test
npm run verify:schema
npm run smoke:crud
npm run smoke:i18n
npm run typecheck
npm run build
npm run check
```

### Manual

- Admin login; upload/replace/delete media on S3.  
- Locale bootstrap still correct on fresh DB.  
- Role accounts matrix.  
- CORS: browser request from non-allowlisted origin fails as expected (when testable).

### Evidence to record

- `docs/phase-04-verification.md` (create when executing).  
- Update [`../STATUS.md`](../STATUS.md).  
- Update [`../cms-technical-decisions.md`](../cms-technical-decisions.md) with storage/CORS/prefix decisions.

## 8. Documentation impact

| File | Change |
| --- | --- |
| `.env.example` | API prefix, CORS, S3, CDN |
| `docs/architecture.md` | New |
| `docs/cms-api-contract.md` | Base path `/api/v1` |
| `docs/cms-technical-decisions.md` | Storage, CORS, prefix |
| `docs/media-storage-operations.md` | New or section |
| `README.md` | Env setup notes |
| `docs/STATUS.md` | Phase 4 progress |

## 9. Exit gate

Phase 4 **closed** when:

1. 4A helpers tested; `/api/v1` live; bootstrap locales modular.  
2. 4B uploads work via S3+CDN on at least local-dev bucket; delete guard on.  
3. 4C role matrix documented and manually verified.  
4. Public anonymous still cannot read/write content API.  
5. `npm run check` (+ smokes) pass.  
6. Verification report + STATUS updated.

## 10. Order of implementation

```text
P4A-01 → P4A-02 → P4A-03 → P4A-04 → P4A-05 → P4A-06
                ↘ (parallel after A-01 if credentials ready)
                  P4B-01 → … → P4B-06
                               then P4C-01 → P4C-03
```

Do not start Phase 5 seed until 4B path is clear (seed with local-disk then re-upload is waste).
