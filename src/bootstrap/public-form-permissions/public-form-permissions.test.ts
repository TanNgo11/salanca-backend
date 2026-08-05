import { describe, expect, it } from 'vitest';

import {
  getPublicFormPermissionActions,
  PublicFormPermissionAction,
} from './public-form-permissions.types';

describe('getPublicFormPermissionActions', () => {
  it('only grants create actions', () => {
    for (const action of getPublicFormPermissionActions()) {
      expect(action.endsWith('.create')).toBe(true);
      expect(action.includes('.find')).toBe(false);
      expect(action.includes('.update')).toBe(false);
      expect(action.includes('.delete')).toBe(false);
    }
  });

  it('includes contact-message and reservation-request create', () => {
    expect(getPublicFormPermissionActions()).toContain(
      PublicFormPermissionAction.CreateContactMessage,
    );
    expect(getPublicFormPermissionActions()).toContain(
      PublicFormPermissionAction.CreateReservationRequest,
    );
  });

  it('returns a stable non-empty allowlist', () => {
    const actions = getPublicFormPermissionActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
