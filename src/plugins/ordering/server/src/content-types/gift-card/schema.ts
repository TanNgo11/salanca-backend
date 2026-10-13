import { collection } from '../internal';

/**
 * A gift card (O9 plan step 1). The raw 16-char code is NEVER stored: `codeHash` is the
 * keyed HMAC used for lookups, `last4` the only fragment that may surface. `sealedCode`
 * holds the AES-256-GCM sealed plaintext for the one-time staff display; the retention job
 * deletes it after 24 hours. `inactive` cards are preprinted physical stock that activates
 * when sold at the counter; `balance` never goes below zero (CHECK in migration 0010).
 */
export default collection(
  'gift-card',
  {
    codeHash: { type: 'string', required: true },
    last4: { type: 'string', required: true },
    initialAmount: { type: 'biginteger', required: true },
    balance: { type: 'biginteger', required: true, default: 0 },
    currency: { type: 'string', required: true, default: 'VND' },
    status: {
      type: 'enumeration',
      enum: ['inactive', 'active', 'blocked', 'expired'],
      required: true,
      default: 'active',
    },
    source: {
      type: 'enumeration',
      enum: ['sale', 'manual', 'batch'],
      required: true,
      default: 'sale',
    },
    issuedAt: { type: 'datetime' },
    expiresAt: { type: 'datetime', required: true },
    soldAt: { type: 'datetime' },
    order: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.order' },
    orderLine: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.order-line' },
    batch: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.gift-card-batch',
      inversedBy: 'cards',
    },
    recipientEmailHash: { type: 'string' },
    issuedBy: { type: 'string' },
    note: { type: 'text' },
    sealedCode: { type: 'text' },
    ledgerEntries: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.gift-card-ledger',
      mappedBy: 'card',
    },
  },
  { displayName: 'Thẻ quà tặng' },
);
