import { describe, expect, it } from 'vitest';

import {
  hideDeveloperOnlyAdminPermissions,
  isDeveloperOnlyAdminPermission,
} from './admin-navigation-visibility.helper';

describe('developer-only Admin navigation visibility', () => {
  it.each([
    'admin::marketplace.read',
    'plugin::documentation.read',
    'plugin::documentation.settings.regenerate',
    'plugin::documentation.settings.update',
  ])('classifies %s as hidden', (action) => {
    expect(isDeveloperOnlyAdminPermission(action)).toBe(true);
  });

  it.each(['admin::users.read', 'plugin::upload.read', 'plugin::content-manager.explorer.read'])(
    'does not classify %s as hidden',
    (action) => {
      expect(isDeveloperOnlyAdminPermission(action)).toBe(false);
    },
  );

  it('preserves unrelated permissions while removing hidden navigation actions', () => {
    const permissions = [
      { action: 'admin::marketplace.read', subject: null },
      { action: 'admin::users.read', subject: null },
      { action: 'plugin::documentation.read', subject: null },
      { action: 'plugin::upload.read', subject: null },
    ];

    expect(hideDeveloperOnlyAdminPermissions(permissions)).toEqual([
      { action: 'admin::users.read', subject: null },
      { action: 'plugin::upload.read', subject: null },
    ]);
    expect(permissions).toHaveLength(4);
  });
});
