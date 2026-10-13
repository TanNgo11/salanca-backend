// Runs every ordering integration script in order as a child process and reports
// pass/fail + duration. Exit 1 when any script fails. Run: node scripts/ordering/run-all.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const scripts = [
  'check-admin-imports.mjs',
  'check-dist-imports.mjs',
  'admin-build.mjs',
  'schema.mjs',
  'disable-survives.mjs',
  'registry-boot.mjs',
  'idempotency.mjs',
  'create-order.mjs',
  'promotions.mjs',
  'promotion-race.mjs',
  'promotion-money.mjs',
  'promotions-admin.mjs',
  'rating.mjs',
  'transition.mjs',
  'payment-refund.mjs',
  'outbox-two-process.mjs',
  'jobs.mjs',
  'scope.mjs',
  'catalog-slug.mjs',
  'catalog-json.mjs',
  'catalog-adapter.mjs',
  'catalog-api.mjs',
  'catalog-categories.mjs',
  'catalog-availability.mjs',
  'catalog-extension.mjs',
  'review-additions.mjs',
  'branches.mjs',
  'special-hours.mjs',
  'daily-stock.mjs',
  'order-edit.mjs',
  'pickup-slots.mjs',
  'storefront.mjs',
  'admin-orders.mjs',
  'notifications.mjs',
  'sla-alerts.mjs',
  'alerts-engine.mjs',
  'ops-status.mjs',
  'cash-closing.mjs',
  'reports.mjs',
  'order-export.mjs',
  'retention.mjs',
  'audit-log.mjs',
  'audit-coverage.mjs',
  'lookup-drafts.mjs',
  'stream.mjs',
  'sepay-webhook.mjs',
  'sepay-match.mjs',
  'sepay-review.mjs',
  'sepay-manual.mjs',
  'sepay-reconcile.mjs',
  'sepay-expiry.mjs',
  'sepay-refund.mjs',
  'sepay-alerts.mjs',
  'sepay-link.mjs',
  'admin-units.mjs',
  'delivery-quote.mjs',
  'delivery-assignment.mjs',
  'webhooks-out.mjs',
  'webhooks-admin.mjs',
  'openapi.mjs',
  'catalog-csv.mjs',
  'email-templates.mjs',
  'courier.mjs',
  // O11: customer profiles backfill (step 1). Later O11 scripts append below.
  'customers.mjs',
  // O11 step 2: OTP sign-in + sessions (email channel until O13).
  'customer-auth.mjs',
  // O11 step 4: server carts (lifecycle) + checkout.
  'cart.mjs',
  'cart-checkout.mjs',
  'cart-promotion.mjs',
  // O11 step 5: reorder + abandoned-cart reminder.
  'cart-reminder.mjs',
  // O11 step 6: Decree 13 export/erasure + staff data-request queue.
  'data-rights.mjs',
  // O11 step 7: the staff customer book — masked directory/detail, scope 404s, logged reveal.
  'admin-customers.mjs',
  // O14: channel, group and time-window prices.
  'price-lists.mjs',
  // O9 step 2: gift-card ledger invariant under a seeded random walk.
  'gift-card-ledger.mjs',
  // O9 step 3: digital gift-card sale — workflow, issuance, mail, counter stock.
  'gift-card-sale.mjs',
  // O9 step 4: card as a co-payment — debit, refunds, expiry, concurrency, probing.
  'gift-card-payment.mjs',
  // O9 step 5: staff admin — masked list/detail, issue/resend, lifecycle, physical batches.
  'gift-card-admin.mjs',
];

const results = [];
let failures = 0;
for (const script of scripts) {
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], {
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
    child.on('error', () => resolve(1));
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = code === 0;
  if (!ok) failures += 1;
  results.push({ script, ok, seconds });
  console.log(`[check:ordering] ${ok ? 'PASS' : 'FAIL'} ${script} (${seconds}s)`);
}

console.log('\n[check:ordering] summary');
for (const result of results) {
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.script.padEnd(28)} ${result.seconds}s`);
}
if (failures > 0) {
  console.error(`[check:ordering] ${failures} script(s) failed`);
  process.exit(1);
}
console.log(`[check:ordering] all ${scripts.length} scripts passed`);
