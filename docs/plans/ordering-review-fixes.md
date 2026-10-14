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

Status: Automated verification passed, final verification 2026-10-14. Publication targets: feat/ordering-finish and feat/ordering.
Owner authorization: handoff a190039, 2026-10-13. No schema changes, migrations or dependencies were added.

| Issue | Regression before fix | Result after fix | Commit |
| --- | --- | --- | --- |
| Customer erasure / order linking | Barrier after the real initial count: request becomes done while a new order is linked; test expected waiting | Shared identity advisory lock then customer row lock; recount in final transaction. Both signed-in email-only and guest-phone orders force waiting. Newly closed orders are scrubbed under the lock before done. Checkout takes the customer lock before the cart; erasure waits on busy carts without blocking while holding the customer lock. | 25e2ad4 |
| Webhook fanout interruption | Inject customer read failure after the old placeholder INSERT; retry delivered 0 instead of 1 | INSERT, payload and activation commit together. Retry also repairs legacy placeholders. Three concurrent retries keep one row and deliver once; completed delivery never reactivates. | 67584a2 |
| Concurrent guest cart merge | Three concurrent merges turn quantity 1 into 3 | Lock both carts by ascending id, reload source and skip an already consumed source. Concurrent claim also preserves one cart. | ab6c4cb |
| Concurrent OTP requests | Eight concurrent requests persisted 8 challenges instead of sendMax=3 | Advisory lock by target around count/insert: 3 real challenges and mails, 5 phantom replies. Mail waits for outermost commit; rollback sends none. | 526c280 |

PostgreSQL regression files: `review-erasure-race.mjs`, `review-webhook-fanout.mjs`, `review-cart-merge.mjs`,
`review-otp-race.mjs`. Each can run directly. `review-round3.mjs` runs all four in one Strapi boot and is registered
in run-all for future gates. Synchronization uses barriers or actual parallel calls; no sleep-based ordering.
The erasure closed-order race also failed before the additional final scrub and passed afterwards.

### Verification before integration merge

All integration commands used `ORDERING_TEST_DATABASE=salanca_ordering_review_fixes` on loopback PostgreSQL.
- `pnpm install --frozen-lockfile`: EXIT=0; lock/config unchanged.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build:ordering`: EXIT=0.
- `pnpm exec vitest run src/plugins/ordering`: EXIT=0; 62 files / 660 tests.
- `node scripts/ordering/<name>.mjs`: EXIT=0 for `review-round3`, `review-extra`, `data-rights`, `webhooks-out`, `cart`, `customer-auth`, `create-order`.
- `pnpm audit --registry=https://registry.npmjs.org --json`: EXIT=1; existing baseline 2 critical / 3 high / 27 moderate / 2 low. No dependency changes or audit fix applied.
- Existing pg concurrent-query deprecation warning was observed and excluded from these fixes per the handoff.
- No check:ordering, check:phase3, smoke, Admin build, production access or manual UAT. Other workers' worktrees remain untouched; no stash or reserved migration numbers used.

### Final integration verification (2026-10-14)

- `git fetch origin` and `git merge origin/feat/ordering`: EXIT=0, Already up to date. No upstream-only commits or conflicts. Repeated immediately before publication with the same result.
- After that merge check, `pnpm run build:ordering`, lint, typecheck and plugin Vitest passed; Vitest remained 62 files / 660 tests.
- All seven compact integration scripts above passed again (EXIT=0).
- An additional controlled PostgreSQL checkout/erasure interleaving exposed SQLSTATE 40P01. Checkout now takes the shared customer lock before its cart; erasure skips busy cart locks and records waiting. The same test now commits erasure and makes the waiting checkout see CART_NOT_FOUND, with no deadlock.
- After this last runtime change: build:ordering, lint, typecheck, Vitest 660, `review-round3`, `data-rights`, `cart-checkout`, `create-order` all EXIT=0. Other compact scripts had already passed with unchanged runtime paths.
- The four fix commits above remain separate and have Codex co-author trailers. The lock-order follow-up was folded into the erasure commit before any push; the final rebased tree was byte-for-byte identical to the tested tree (`git diff --name-only b9c7508 HEAD` was empty).
- Publication uses ordinary non-force pushes to feat/ordering-finish and feat/ordering; main is excluded. Remote SHAs will be checked against HEAD in the completion report.
