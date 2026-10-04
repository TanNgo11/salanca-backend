import { createHmac } from 'node:crypto';

import { trimmedNonEmptyString } from '../../shared/normalization/value';

export const createAuditIdentifierFingerprint = (
  identifier: string,
  secret: string,
): string => createHmac('sha256', secret).update(identifier).digest('hex');

export const readFailedLoginIdentifier = (body: unknown): string | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const candidate = body as Readonly<{
    email?: unknown;
    identifier?: unknown;
  }>;

  return (
    trimmedNonEmptyString(candidate.email)?.toLowerCase() ??
    trimmedNonEmptyString(candidate.identifier)?.toLowerCase() ??
    null
  );
};
