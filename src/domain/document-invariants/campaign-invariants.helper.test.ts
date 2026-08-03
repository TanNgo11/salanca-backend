import { describe, expect, it } from 'vitest';

import { validateCampaignDateRange } from './campaign-invariants.helper';

describe('validateCampaignDateRange', () => {
  it('allows missing endsAt', () => {
    expect(validateCampaignDateRange('2026-01-01T00:00:00.000Z', null)).toBeNull();
  });

  it('allows equal start and end', () => {
    expect(
      validateCampaignDateRange('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ).toBeNull();
  });

  it('allows endsAt after startsAt', () => {
    expect(
      validateCampaignDateRange('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
    ).toBeNull();
  });

  it('rejects endsAt before startsAt', () => {
    expect(
      validateCampaignDateRange('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ).toMatch(/endsAt must be greater than or equal to startsAt/);
  });
});
