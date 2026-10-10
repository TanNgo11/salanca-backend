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
  },
  { displayName: 'Nhật ký thay đổi' },
);
