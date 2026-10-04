import { describe, expect, it } from 'vitest';

import {
  contactMessageUid,
  hideLeadCollectionLinks,
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

describe('hideLeadCollectionLinks', () => {
  it('drops the lead collections from the Content Manager list and keeps the rest', () => {
    const gallery = { uid: 'api::gallery-item.gallery-item', name: 'api::gallery-item.gallery-item' };
    const models = [{ uid: 'x' }];

    const result = hideLeadCollectionLinks({
      ctLinks: [
        gallery,
        { uid: contactMessageUid, name: contactMessageUid },
        { uid: reservationRequestUid, name: reservationRequestUid },
      ],
      models,
    });

    expect(result.ctLinks).toEqual([gallery]);
    expect(result.models).toBe(models);
  });
});
