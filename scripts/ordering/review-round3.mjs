import { withApp } from './_harness.mjs';
import { testErasureRace } from './review-erasure-race.mjs';
import { testWebhookFanout } from './review-webhook-fanout.mjs';
import { testCartMerge } from './review-cart-merge.mjs';
import { testOtpRace } from './review-otp-race.mjs';
await withApp(async app => {
  let failed = 0;
  for (const [name, test] of [['erasure', testErasureRace], ['webhook', testWebhookFanout], ['merge', testCartMerge], ['otp', testOtpRace]]) {
    try { await test(app); console.log(`[review-race] ${name} PASS`); }
    catch (error) { failed += 1; console.error(`[review-race] ${name} FAIL: ${error.message}`); }
  }
  if (failed) throw new Error(`${failed} concurrency regression(s) failed`);
});
