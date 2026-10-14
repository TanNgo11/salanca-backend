# Ordering fourth review fixes

Status: Automated verification passed
Owner: Codex, authorized by owner on 2026-10-14
Related phases: O11 customers, O14 price lists, O5 refunds

## Evidence and scope

At b75f3d3 four failures were reproduced on PostgreSQL: a failed price-list update
lost override rows and changed quote 40000 -> 45000; two different OTP challenges
created two email-only profiles; parallel verification left 11 sessions with cap 10;
line cancellation and line refund deadlocked (40P01).

Only plugin services, targeted regression scripts and documentation change. No
schema/dependency/migration changes, production/CMS/other worktrees, full ordering
gate, commit, merge or push. Use only salanca_ordering_review_fixes for integration.

## Implementation and invariants

1. Make price-list create/update atomic with audit and derived price rows; serialize
   updates by locking the list row before reading it. Failed writes keep old quotes.
2. Serialize OTP verification by the same target lock as issuance, before locking
   its challenge; reread challenge after locks. One new mailbox resolves to one profile.
3. Wrap session issuance in a transaction with a per-customer session advisory lock;
   hold count/revoke/insert together, including nested callers. Live count stays at cap.
4. Scope-check line refunds, lock their lines in ascending id order before the payment,
   then reread payment balances and lines. Match cancellation and order editing's existing
   line -> payment order; do not introduce payment -> line against the edit path.

## Data and rollback

No migration or automatic merge of existing duplicate profiles. No reconstruction
of already lost prices; editor can save the affected list again. Changes prevent
recurrence and cap is restored on subsequent issuance. Rollback is code-only and
reopens the races. Existing API response shapes and permission scopes stay intact.

## Verification

Add review-round4.mjs with real transactions, controlled read barriers, PostgreSQL
lock-wait observation and injected write failures; never sleep or print secrets.
Run before fixes to record failures in all four categories, then after fixes to pass all.
Also cover failed create, overlapping list updates, both deadlock schedules and
standalone session issuance. Register runner without running check:ordering.

Commands: pnpm run build:ordering; pnpm run lint; pnpm run typecheck;
pnpm exec vitest run src/plugins/ordering; targeted review-round4, review-round3,
customer-auth, price-lists, payment-refund, admin-orders and data-rights scripts.
Record actual exits below and in STATUS.md. Browser UAT/full-suite verification
are outside this fix request; no phase closure is claimed.

## Completion record

Implemented in price-list.ts, customer-auth.ts and refund.ts. The refund core uses
line -> payment so cancellation and order editing keep their existing lock order.
Preflight checks payment/order scope and line membership before locking lines;
payment balances and line quantities are read again under locks. Multiple line ids
are deduplicated and locked in ascending order without changing response ordering.

The corrected regression runner was executed against b75f3d3 service artifacts:
six failing cases in the four reported categories (including both deadlock schedules),
one passing nested concurrent-update coverage case, EXIT=1. Final service artifacts
were rebuilt afterwards; all seven cases passed, EXIT=0. The runner uses real separate
PostgreSQL backends, barriers and observed lock waits, with no sleeps or exposed secrets.

| Command | Actual result |
| --- | --- |
| pnpm run build:ordering | EXIT=0, including final refund implementation |
| pnpm run lint | EXIT=0, final source |
| pnpm run typecheck | EXIT=0 |
| pnpm exec vitest run src/plugins/ordering | EXIT=0, 62 files / 660 tests, final source |
| node scripts/ordering/review-round4.mjs | EXIT=0, seven cases on final source |
| node scripts/ordering/review-round3.mjs | EXIT=0 |
| node scripts/ordering/customer-auth.mjs | EXIT=0 |
| node scripts/ordering/price-lists.mjs | EXIT=0 |
| node scripts/ordering/payment-refund.mjs | EXIT=0, repeated after final refund change |
| node scripts/ordering/admin-orders.mjs | EXIT=0, repeated after final refund change |
| node scripts/ordering/data-rights.mjs | EXIT=0 |
| node scripts/ordering/order-edit.mjs | EXIT=0 after final refund change |
| git diff --check | EXIT=0 |

Every integration command used ORDERING_TEST_DATABASE=salanca_ordering_review_fixes,
sequentially. Registered the new regression in run-all.mjs; did not run that full suite.
Existing Strapi populate/pg concurrent-query deprecation warnings remain; they are
separate from passed assertions and exit codes. No dependencies, schema, migrations,
production data, other worktrees or main changes. No commit, merge or push in this round.
Browser UAT, full check:ordering and phase closure are not claimed.
