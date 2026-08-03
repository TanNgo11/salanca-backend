# Salanca Backend Documentation

This directory contains product, architecture, implementation, verification, and operator documentation for the standalone Salanca Strapi backend.

Start with [`STATUS.md`](STATUS.md). The roadmap describes intended direction; it is not proof that a phase is complete.

## Document map

| Question | Source |
| --- | --- |
| What is implemented, verified, blocked, and authorized next? | [`STATUS.md`](STATUS.md) |
| What product is this backend allowed to become? | [`product-context.md`](product-context.md) |
| What architecture and platform decisions are accepted? | [`cms-technical-decisions.md`](cms-technical-decisions.md) |
| What is the runtime ownership / startup map? | [`architecture.md`](architecture.md) |
| What content types, components, fields, and relations exist? | [`cms-content-model.md`](cms-content-model.md) |
| What REST and locale behavior must clients rely on? | [`cms-api-contract.md`](cms-api-contract.md) |
| How are Admin roles meant to be split? | [`admin-roles.md`](admin-roles.md) |
| How does media/S3 ops work? | [`media-storage-operations.md`](media-storage-operations.md) |
| What is the security baseline and unresolved dependency risk? | [`security-baseline.md`](security-baseline.md) |
| What is the full delivery sequence? | [`strapi-backend-roadmap.md`](strapi-backend-roadmap.md) |
| What BE pattern-lift plan (from Nhà Thật) governs Phase 0/4–7? | [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md) |
| What must an editor do in Admin? | [`cms-editor-guide.md`](cms-editor-guide.md) |
| What did the initial bootstrap verify? | [`bootstrap-report.md`](bootstrap-report.md) |
| What evidence exists for Phase 2? | [`phase-02-verification.md`](phase-02-verification.md) |
| What evidence exists for Phase 3? | [`phase-03-verification.md`](phase-03-verification.md) |

## Phase specifications

### Closed / implemented baseline

- [`Phase 1 - Foundation`](phases/phase-01-foundation.md)
- [`Phase 2 - Content model`](phases/phase-02-content-model.md)
- [`Phase 3 - Internationalization`](phases/phase-03-internationalization.md)

### Draft BE-first specs (owner review; implement after Phase 0)

- [`Phase 0 - Close UAT and decisions`](phases/phase-00-close-uat-and-decisions.md)
- [`Phase 4 - Hardening, media, roles`](phases/phase-04-hardening-media-roles.md)
- [`Phase 5 - Seed content`](phases/phase-05-seed-content.md)
- [`Phase 6 - API contract and QA`](phases/phase-06-api-contract-and-qa.md)
- [`Phase 7 - Staging and handoff`](phases/phase-07-staging-and-handoff.md)

Overview: [`plans/be-pattern-lift-plan.md`](plans/be-pattern-lift-plan.md). Do not implement Phase 4+ from roadmap bullets alone; use these specs. Phase 0 must pass before Phase 4 implementation.

## Source-of-truth rules

When documents disagree with accepted decisions or runtime behavior, stop and reconcile them. Use this investigation order:

1. Accepted owner or product decisions.
2. Version-controlled runtime code, schemas, migrations, and configuration.
3. Current automated verification.
4. Content model and API contract.
5. Current status and active phase specification.
6. Roadmap and historical reports.
7. The frontend prototype as design reference only.

Behavior changes are incomplete until the corresponding durable documentation is updated. Follow the update matrix in [`AGENTS.md`](../AGENTS.md).

## Status language

- **Implemented** means the change exists.
- **Automated verification passed** means named current commands passed.
- **Ready for manual UAT** means automation passed but human checks remain.
- **Phase closed** means automated, manual, ownership, and handoff gates all passed and are recorded.
