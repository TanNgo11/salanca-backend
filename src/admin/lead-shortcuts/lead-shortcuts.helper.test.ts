import { describe, expect, it } from 'vitest';

import {
  contactMessageUid,
  leadListPath,
  leadReadPermissions,
  reservationRequestUid,
} from './lead-shortcuts.helper';

describe('lead shortcuts', () => {
  it('points at the Content Manager list of each lead collection', () => {
    expect(leadListPath(contactMessageUid)).toBe(
      '/content-manager/collection-types/api::contact-message.contact-message',
    );
    expect(leadListPath(reservationRequestUid)).toBe(
      '/content-manager/collection-types/api::reservation-request.reservation-request',
    );
  });

  it('gates the link on Content Manager read of that collection', () => {
    expect(leadReadPermissions(contactMessageUid)).toEqual([
      { action: 'plugin::content-manager.explorer.read', subject: contactMessageUid },
    ]);
  });
});
