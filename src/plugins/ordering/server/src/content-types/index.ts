/** Minimal O0 schemas only. No order business rules or public CRUD routes. */
const internalOptions = {
  'content-manager': { visible: false },
  'content-type-builder': { visible: false },
  i18n: { localized: false },
};

const collection = (name: string, attributes: Record<string, unknown>, visible = false) => ({
  schema: {
    kind: 'collectionType',
    collectionName: `plugins_ordering_${name.replaceAll('-', '_')}`,
    info: { singularName: name, pluralName: `${name}s`, displayName: name },
    options: { draftAndPublish: false },
    pluginOptions: {
      ...internalOptions,
      'content-manager': { visible },
    },
    attributes,
  },
});

export default {
  order: collection('order', {
    code: { type: 'string', required: true, unique: true },
    locationRef: { type: 'string', required: true },
    counter: { type: 'integer', default: 0 },
    lines: { type: 'relation', relation: 'oneToMany', target: 'plugin::ordering.order-line', mappedBy: 'order' },
  }),
  'order-line': collection('order-line', {
    label: { type: 'string', required: true },
    order: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.order', inversedBy: 'lines' },
  }),
  'payment-event': collection('payment-event', {
    eventId: { type: 'string', unique: true, required: true },
    payload: { type: 'json' },
  }),
  outbox: collection('outbox', {
    eventId: { type: 'string', unique: true, required: true },
    status: { type: 'string', default: 'pending', required: true },
    owner: { type: 'string' },
    leaseUntil: { type: 'datetime' },
    deliveries: { type: 'integer', default: 0 },
  }),
  'job-lock': collection('job-lock', {
    key: { type: 'string', unique: true, required: true },
    owner: { type: 'string' },
    leaseUntil: { type: 'datetime' },
  }),
  'staff-location-scope': collection('staff-location-scope', {
    adminUserId: { type: 'integer', unique: true, required: true },
    allLocations: { type: 'boolean', default: false, required: true },
    locationRefs: { type: 'json', required: true },
  }),
};
