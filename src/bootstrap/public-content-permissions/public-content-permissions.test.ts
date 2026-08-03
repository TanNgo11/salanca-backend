import { describe, expect, it } from 'vitest';

import {
  getPublicContentPermissionActions,
  PublicContentPermissionAction,
} from './public-content-permissions.types';

describe('getPublicContentPermissionActions', () => {
  it('only grants find and findOne actions', () => {
    for (const action of getPublicContentPermissionActions()) {
      expect(action.endsWith('.find') || action.endsWith('.findOne')).toBe(true);
      expect(action.includes('.create')).toBe(false);
      expect(action.includes('.update')).toBe(false);
      expect(action.includes('.delete')).toBe(false);
    }
  });

  it('includes global-setting and menu-item reads', () => {
    const actions = getPublicContentPermissionActions();
    expect(actions).toContain(PublicContentPermissionAction.FindGlobalSetting);
    expect(actions).toContain(PublicContentPermissionAction.FindMenuItem);
    expect(actions).toContain(PublicContentPermissionAction.FindOneMenuItem);
  });

  it('returns a stable non-empty allowlist', () => {
    const actions = getPublicContentPermissionActions();
    expect(actions.length).toBeGreaterThan(10);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
