# Ordering review fixes

Status: Automated verification passed
Owner: Codex, authorized by owner on 2026-10-13
Related phases: O8 promotions and O11 carts; O1 transitions

## Goal and invariants
- A cart converts into at most one order, including concurrent different-key requests.
- Same-key checkout replays remain valid; unrelated completed keys cannot replay a converted cart.
- Customer cancellation checks locked group states and retains locks through cancellation.
- Every cart quote with a promotion code uses the same guessing guard, including create and delayed line additions.

## Implementation and verification
1. Lock and reload the cart inside checkout's transaction; serialize idempotency keys with transaction advisory locks so nested replay cannot abort PostgreSQL transactions.
2. Lock all fulfillment groups in id order before checking customer cancellation eligibility.
3. Share the promotion guard across cart create, read, patch, line mutations and customer reorder. Setting a code (create, PATCH with `promotionCode`) is captcha-gated past the threshold; a stored code (reads, line changes, reorder) is not, and each (IP, cart, code) counts as one guess the first time a quote can judge it — so a customer with a stored wrong code is never locked out of their own cart (review change by Claude, 2026-10-13: the first version counted and captcha-gated every read).
4. Extend cart-checkout, transition and cart-promotion integration scripts with regression cases. Run build:ordering, the affected scripts and idempotency against an isolated loopback test DB, lint, typecheck, typecheck:admin and unit tests.

## Data and rollback
No schema changes or migrations. Existing carts and idempotency rows remain compatible. Revert code to roll back. No production data, dependencies, commits or pushes are included.

## Acceptance
Browser UAT remains open; this fix does not close phase acceptance.

## Completion record (2026-10-13)
- Implemented all three review fixes, including the customer reorder path sharing the promotion guard.
- `pnpm run build:ordering`: EXIT=0 on final sources.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run typecheck:admin`: EXIT=0; focused ESLint and typecheck also passed after the fixes.
- `pnpm run test`: EXIT=0, 171 files / 1298 tests.
- `ORDERING_TEST_DATABASE=salanca_ordering_review_fixes node scripts/ordering/<name>.mjs`: EXIT=0 for `cart-checkout`, `transition`, `cart-promotion`, `idempotency`, `cart`, `storefront`, `openapi`, `payment-refund`, `customers`. Executed sequentially against the isolated loopback database.
- Checkout regression: different concurrent keys create one order; same key returns the same token; a key linked to another order is refused; an injected failure after order creation rolls back the order and idempotency row, keeping the cart active and retryable.
- Cancellation regression: staff commits preparing after the customer's stale read; the customer cancellation is refused and preparing remains committed.
- Promotion regression: creation and deferred quoting count failures once per cart+code; 25 reads of a cart with a stored wrong code stay 200; a new code past the threshold still needs the captcha; reorder quotes the stored code.
- OpenAPI: no query `captchaToken` on reads/reorder (not needed after the review change).
- Existing PostgreSQL client.query concurrency deprecation warning remains in aggregate population; it did not fail these gates.
- Full `check:ordering`, browser UAT and production checks were not run. No commit or push.


## Second review round (2026-10-13, fixed by Claude)

Four issues Codex reproduced on an isolated DB, all confirmed and fixed:

1. **[P1] Out-of-scope orders through the customer profile.** `admin-customers.detail` and the staff export
   (`data-rights.exportForStaff`) listed every order of the customer; a Q1-only staff member saw Q3 orders. Both now
   filter orders by the caller's location scope (all-location staff unchanged; the customer's own export unchanged).
2. **[P1] Customer cancel of a paid order did not refund.** `transition.customerCancel` now calls
   `admin-orders.refundHeldInTransaction` in the cancel transaction — same rule as a staff cancel (cash refunded,
   transfer as a pending refund).
3. **[P2] Customers backfilled by `0007-o11-customers` had no `document_id`.** 0007 now inserts one
   (`migrations/document-id.ts`, cuid2-shaped, no new dependency) and `0009b-o11-customer-document-ids` fills existing
   NULL rows (idempotent).
4. **[P2] Concurrent cart mutations lost lines.** `addLine`, `updateLine`, `removeLine` and the sign-in `merge` run
   read-modify-write under the cart row lock (`mutateLocked`: lock, reload, change, save).

Regression: `scripts/ordering/review-extra.mjs` (scope on profile + export, paid self-cancel refund, documentId backfill,
three concurrent adds). PASS together with `schema`, `cart`, `cart-checkout`, `admin-customers`, `data-rights`,
`storefront`, `transition`; lint, typecheck, vitest 632.

## Third review round

Status: In progress; authorized by owner, handoff a190039.
Plan: preserve the first two rounds; add PostgreSQL regression tests and record red results before editing services.
Use a shared advisory customer key then customer row lock for checkout linking and erasure finalization; recheck open orders under the lock.
Make webhook insert/payload activation atomic and repair incomplete existing rows on retry. Lock both carts in id order and re-read the source before merging.
Serialize OTP count/create by target hash and defer mail to the outermost transaction commit.
No schema/dependency changes or new migrations are planned. Test only on salanca_ordering_review_fixes; run the handoff's compact gates, then fetch/merge origin/feat/ordering and repeat them before pushing both feature branches. Each fix gets a separate co-authored commit. Browser UAT remains outside this backend fix.
