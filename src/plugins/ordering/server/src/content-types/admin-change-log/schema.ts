import { collection } from '../internal';

export default collection(
  'admin-change-log',
  {
    actorRef: { type: 'string', required: true },
    action: { type: 'string', required: true },
    entityType: { type: 'string', required: true },
    entityId: { type: 'string', required: true },
    locationRef: { type: 'string' },
    occurredAt: { type: 'datetime', required: true },
    changes: { type: 'json', required: true },
    // O15: screen filters + tamper evidence. `category` comes from domain/audit/actions.ts;
    // `entityLabel` is the order code / item name at write time (never customer data);
    // `requestId` groups the rows of one admin request; hashes are filled after commit by the
    // `audit-chain` job.
    category: { type: 'string' },
    entityLabel: { type: 'string' },
    orderId: { type: 'integer' },
    requestId: { type: 'string' },
    prevHash: { type: 'string' },
    hash: { type: 'string' },
  },
  { displayName: 'Nhật ký thay đổi' },
);
