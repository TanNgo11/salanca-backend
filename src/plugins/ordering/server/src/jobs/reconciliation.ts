import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { NormalizedPaymentEvent } from '../contracts/payment';
import type { SepayTransactionPage } from '../providers/sepay/client';
import { sepaySettingsFromConfig } from '../providers/sepay/provider';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';
import type paymentMatchingFactory from '../services/payment-matching';
import type { OrderingRegistry } from '../services/registry';

const PER_PAGE = 100;
const MAX_PAGES = 50;

const digits = (value: string | null | undefined): string => (value ?? '').replace(/\s/g, '');

/**
 * What reconciliation stores. The match reads content from the event, not from this object.
 * Account numbers and the raw transfer text stay out of the row.
 */
const reconciliationPayload = (event: NormalizedPaymentEvent): Record<string, unknown> => ({
  source: 'reconciliation',
  referenceCode: event.reference ?? null,
  transactionDate:
    typeof event.metadata?.transactionDate === 'string' ? event.metadata.transactionDate : null,
  transferType: event.transferType ?? null,
});

type PageLister = {
  listTransactionPage(input: { cursor?: string }): Promise<SepayTransactionPage>;
};

/**
 * Catch-up for SePay transfers the webhook missed. One process holds the lease.
 * `since_id` is stored per account. The user API id is a UUID; the webhook id is an integer.
 * Ingest treats the same bank reference and the same amount as one transfer.
 */
export const runSepayReconciliation = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; ingested: number; duplicates: number }> => {
  const plugin = strapi.plugin('ordering');
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const settings = sepaySettingsFromConfig(config.providers.payment);
  const registry = plugin.service('registry') as OrderingRegistry;
  if (!settings || !registry.hasPaymentProvider('sepay')) {
    return { ran: true, ingested: 0, duplicates: 0 };
  }

  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const matching = plugin.service('payment-matching') as ReturnType<typeof paymentMatchingFactory>;
  const provider = registry.paymentProvider('sepay') as unknown as PageLister;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:sepay-reconciliation' }, now };
  const store = strapi.store({ type: 'plugin', name: 'ordering' });

  const outcome = await jobLock.withLock(
    { jobName: 'sepay-reconciliation', owner: options.owner, now },
    async () => {
      let ingested = 0;
      let duplicates = 0;
      for (const account of Object.values(settings.accounts)) {
        const storeKey = `sepay-since:${account.accountNumber}`;
        const stored = await store.get({ key: storeKey });
        let cursor = typeof stored === 'string' && stored !== '' ? stored : undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const listed = await provider.listTransactionPage({ cursor });
          if (listed.rows.length === 0 || !listed.lastId || listed.lastId === cursor) break;
          for (const row of listed.rows) {
            if (!row.event) continue;
            if (digits(row.accountNumber) !== digits(account.accountNumber)) continue;
            const saved = await matching.ingest(
              { event: row.event, rawPayload: reconciliationPayload(row.event) },
              ctx,
            );
            if (saved.duplicate) duplicates += 1;
            else ingested += 1;
          }
          await store.set({ key: storeKey, value: listed.lastId });
          if (listed.fetched < PER_PAGE) break;
          cursor = listed.lastId;
        }
      }
      return { ingested, duplicates };
    },
  );

  if (!outcome.ran) return { ran: false, ingested: 0, duplicates: 0 };
  strapi.log.info(
    `[ordering] sepay reconciliation ingested=${outcome.result.ingested} duplicate=${outcome.result.duplicates}`,
  );
  return { ran: true, ingested: outcome.result.ingested, duplicates: outcome.result.duplicates };
};
