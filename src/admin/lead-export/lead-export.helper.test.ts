import { describe, expect, it } from 'vitest';

import { buildLeadExportPath, defaultExportRange, leadExportKindsForUid } from './lead-export.helper';

describe('lead export helper', () => {
  it('builds the export path with optional dates', () => {
    expect(buildLeadExportPath('reservations', '2030-06-01', '2030-06-30')).toBe(
      '/lead-export/reservations?from=2030-06-01&to=2030-06-30',
    );
    expect(buildLeadExportPath('newsletter', '', '')).toBe('/lead-export/newsletter');
  });

  it('defaults to the current month in local time', () => {
    expect(defaultExportRange(new Date(2030, 5, 15))).toEqual({
      from: '2030-06-01',
      to: '2030-06-15',
    });
  });

  it('offers export kinds only on the lead lists', () => {
    expect(leadExportKindsForUid('api::reservation-request.reservation-request')).toEqual([
      'reservations',
    ]);
    expect(leadExportKindsForUid('api::contact-message.contact-message')).toEqual([
      'contacts',
      'newsletter',
    ]);
    expect(leadExportKindsForUid('api::menu-item.menu-item')).toEqual([]);
    expect(leadExportKindsForUid(undefined)).toEqual([]);
  });
});
