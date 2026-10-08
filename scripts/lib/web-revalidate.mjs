import { createHmac } from 'node:crypto';

import { buildRevalidateWebhookBody } from '../backfill-media/backfill-media.helper.mjs';

/**
 * Pages render from CMS data cached before a media script ran until their TTL
 * runs out. Sends the same signed webhook a media Replace sends; skipped when
 * CMS_WEBHOOK_URL / CMS_WEBHOOK_SECRET are unset.
 */
export async function requestWebRevalidation() {
  const url = process.env.CMS_WEBHOOK_URL?.trim();
  const secret = process.env.CMS_WEBHOOK_SECRET?.trim();
  if (!url || !secret) {
    console.log('\nWeb revalidation skipped: CMS_WEBHOOK_URL / CMS_WEBHOOK_SECRET not set.');
    return;
  }
  const body = buildRevalidateWebhookBody();
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cms-signature': `sha256=${signature}` },
      body,
    });
    console.log(`\nWeb revalidation: HTTP ${response.status}`);
  } catch (error) {
    console.error(`\nWeb revalidation failed: ${error?.message ?? error}`);
  }
}
