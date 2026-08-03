/**
 * Pure campaign date-range check. Returns an error message when invalid, else null.
 * Blank endsAt is allowed (open-ended campaigns).
 */
export function validateCampaignDateRange(
  startsAt: unknown,
  endsAt: unknown,
): string | null {
  if (startsAt == null || endsAt == null || startsAt === '' || endsAt === '') {
    return null;
  }

  const start = new Date(String(startsAt));
  const end = new Date(String(endsAt));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Campaign startsAt and endsAt must be valid dates when provided.';
  }

  if (end.getTime() < start.getTime()) {
    return 'Campaign endsAt must be greater than or equal to startsAt.';
  }

  return null;
}
