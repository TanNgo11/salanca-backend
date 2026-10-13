import { collection } from '../internal';

export default collection(
  'dining-table',
  {
    locationRef: { type: 'string', required: true },
    // Branch-unique short code ("B5"); enforced by the 0011 migration's unique index.
    code: { type: 'string', required: true },
    name: { type: 'string', required: true },
    area: { type: 'string' },
    seats: { type: 'integer' },
    /**
     * sha256 of the QR secret: the public `/tables/:token` route looks tables up by hash, so
     * a leaked table list does not hand out the capability. The QR image needs the raw secret
     * again — `qrUrl` keeps the full link for staff reprints (rotate to revoke both).
     */
    qrTokenHash: { type: 'string', required: true },
    qrUrl: { type: 'string' },
    active: { type: 'boolean', required: true, default: true },
    sessions: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.table-session',
      mappedBy: 'table',
    },
  },
  { displayName: 'Bàn ăn' },
);
