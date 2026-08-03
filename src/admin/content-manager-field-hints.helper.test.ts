import { describe, expect, it } from 'vitest';

import { shouldHideContentManagerFieldHints } from './content-manager-field-hints.helper';

describe('shouldHideContentManagerFieldHints', () => {
  it('returns true for Content Manager paths', () => {
    expect(
      shouldHideContentManagerFieldHints(
        '/admin/content-manager/single-types/api::global-setting.global-setting',
      ),
    ).toBe(true);
  });

  it('returns false for Settings and other Admin paths', () => {
    expect(shouldHideContentManagerFieldHints('/admin/settings/users-permissions')).toBe(false);
    expect(shouldHideContentManagerFieldHints('/admin')).toBe(false);
  });
});
