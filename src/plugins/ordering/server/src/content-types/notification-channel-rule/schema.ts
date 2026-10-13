import { collection } from '../internal';

/**
 * O13 step 6 — per-template channel ordering (`notification-channel-rule`). `channels` is the
 * ordered fallback chain (`['zalo', 'sms', 'email']`); `zns` holds the Zalo OA template mapping
 * `{templateId, params: {znsParam: pluginVar}}`. Unique `template` index lives in migration 0012;
 * rows absent here mean "email only" — the pre-O13 behavior.
 */
export default collection(
  'notification-channel-rule',
  {
    template: { type: 'string', required: true },
    channels: { type: 'json', required: true },
    zns: { type: 'json' },
    active: { type: 'boolean', required: true, default: true },
  },
  { displayName: 'Quy tắc kênh thông báo' },
);
