import { trimmedNonEmptyString } from '../../shared/normalization/value';

import { AuditActorType, type AuditEventActor } from './audit-event.types';

export interface AdminAuditUserCandidate {
  email?: unknown;
  firstname?: unknown;
  id?: unknown;
  lastname?: unknown;
  username?: unknown;
}

export const toAdminAuditActor = (
  user: AdminAuditUserCandidate | null | undefined,
): AuditEventActor | null => {
  if (!user) {
    return null;
  }

  const id =
    typeof user.id === 'number' || typeof user.id === 'string'
      ? String(user.id)
      : null;
  if (!id) {
    return null;
  }

  const firstname = trimmedNonEmptyString(user.firstname);
  const lastname = trimmedNonEmptyString(user.lastname);
  const name = [firstname, lastname].filter(Boolean).join(' ');
  const email = trimmedNonEmptyString(user.email);
  const username = trimmedNonEmptyString(user.username);
  const label = email
    ? name
      ? `${name} (${email})`
      : email
    : name || username || `admin:${id}`;

  return {
    type: AuditActorType.AdminUser,
    documentId: id,
    label,
  };
};
