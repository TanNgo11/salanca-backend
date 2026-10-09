import { describe, expect, it } from 'vitest';

import { activeLeadShortcut } from './lead-nav-highlight.helper';

describe('activeLeadShortcut', () => {
  it('maps a lead list view to its sidebar shortcut', () => {
    expect(
      activeLeadShortcut(
        '/admin/content-manager/collection-types/api::reservation-request.reservation-request',
      ),
    ).toBe('/plugins/reservation-requests');
    expect(
      activeLeadShortcut('/admin/content-manager/collection-types/api::contact-message.contact-message'),
    ).toBe('/plugins/contact-messages');
  });

  it('keeps the shortcut active on the edit and create views', () => {
    expect(
      activeLeadShortcut(
        '/admin/content-manager/collection-types/api::reservation-request.reservation-request/abc123',
      ),
    ).toBe('/plugins/reservation-requests');
    expect(
      activeLeadShortcut(
        '/admin/content-manager/collection-types/api::contact-message.contact-message/create',
      ),
    ).toBe('/plugins/contact-messages');
  });

  it('reads an encoded path', () => {
    expect(
      activeLeadShortcut(
        '/admin/content-manager/collection-types/api%3A%3Areservation-request.reservation-request',
      ),
    ).toBe('/plugins/reservation-requests');
  });

  it('leaves other Content Manager screens to the Content Manager link', () => {
    expect(activeLeadShortcut('/admin/content-manager/collection-types/api::menu-item.menu-item')).toBeNull();
    expect(
      activeLeadShortcut(
        '/admin/content-manager/collection-types/api::reservation-request.reservation-request-archive',
      ),
    ).toBeNull();
    expect(activeLeadShortcut('/admin/plugins/lead-export')).toBeNull();
  });
});
