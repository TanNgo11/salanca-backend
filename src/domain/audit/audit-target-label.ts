import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';

import { boundTargetLabel } from './audit-payload';

const LABEL_KEYS = [
  'name',
  'title',
  'filename',
  'displayName',
  'email',
  'code',
  'slug',
] as const;

export const readStableTargetId = (value: unknown): string | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const documentId = trimmedNonEmptyString(value.documentId);
  if (documentId) {
    return documentId.slice(0, 64);
  }

  if (typeof value.id === 'number' && Number.isFinite(value.id)) {
    return String(value.id);
  }

  const id = trimmedNonEmptyString(value.id);
  return id ? id.slice(0, 64) : undefined;
};

export const resolveAuditTargetLabel = (value: unknown): string | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  for (const key of LABEL_KEYS) {
    const label = boundTargetLabel(trimmedNonEmptyString(value[key]));
    if (label) {
      return label;
    }
  }

  const firstName = trimmedNonEmptyString(value.firstname);
  const lastName = trimmedNonEmptyString(value.lastname);
  if (firstName || lastName) {
    return boundTargetLabel([firstName, lastName].filter(Boolean).join(' '));
  }

  return undefined;
};
