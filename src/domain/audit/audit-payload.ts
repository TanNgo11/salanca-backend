import { isPlainRecord, trimmedNonEmptyString } from '../../shared/normalization/value';

export const AUDIT_PAYLOAD_MAX_DEPTH = 4;
export const AUDIT_PAYLOAD_MAX_KEYS = 64;
export const AUDIT_PAYLOAD_MAX_ARRAY_LENGTH = 20;
export const AUDIT_PAYLOAD_MAX_STRING_LENGTH = 320;
export const AUDIT_PAYLOAD_MAX_SERIALIZED_BYTES = 8_192;

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|set-cookie|credit|card|cvv|pin|otp|bank|accountnumber|account_number|phone|rawbody|raw_body)/i;

const CONTENT_MANAGER_EXCLUDED_FIELDS = new Set([
  'createdAt',
  'createdBy',
  'documentId',
  'id',
  'locale',
  'localizations',
  'publishedAt',
  'updatedAt',
  'updatedBy',
]);

export class AuditPayloadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditPayloadRejectedError';
  }
}

const boundString = (value: string): string =>
  value.length <= AUDIT_PAYLOAD_MAX_STRING_LENGTH
    ? value
    : value.slice(0, AUDIT_PAYLOAD_MAX_STRING_LENGTH);

const normalizeNode = (value: unknown, depth: number): unknown => {
  if (depth > AUDIT_PAYLOAD_MAX_DEPTH) {
    throw new AuditPayloadRejectedError('Audit payload exceeded the depth bound.');
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new AuditPayloadRejectedError('Audit payload rejected a non-finite number.');
    }
    return value;
  }

  if (typeof value === 'string') {
    return boundString(value);
  }

  if (Array.isArray(value)) {
    if (value.length > AUDIT_PAYLOAD_MAX_ARRAY_LENGTH) {
      throw new AuditPayloadRejectedError('Audit payload exceeded the array bound.');
    }
    return value.map((entry) => normalizeNode(entry, depth + 1));
  }

  if (
    !isPlainRecord(value) ||
    value instanceof Date ||
    ArrayBuffer.isView(value)
  ) {
    throw new AuditPayloadRejectedError('Audit payload rejected an unsupported shape.');
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AuditPayloadRejectedError('Audit payload rejected an unsupported shape.');
  }

  const keys = Object.keys(value);
  if (keys.length > AUDIT_PAYLOAD_MAX_KEYS) {
    throw new AuditPayloadRejectedError('Audit payload exceeded the key bound.');
  }

  const normalized: Record<string, unknown> = {};
  for (const key of keys.sort((left, right) => left.localeCompare(right))) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    normalized[key] = normalizeNode(value[key], depth + 1);
  }
  return normalized;
};

export const normalizeAuditPayload = (value: unknown): unknown => {
  const normalized = normalizeNode(value, 0);
  const serialized = JSON.stringify(normalized);
  if (serialized.length > AUDIT_PAYLOAD_MAX_SERIALIZED_BYTES) {
    throw new AuditPayloadRejectedError('Audit payload exceeded the serialized size bound.');
  }
  return normalized;
};

export const readContentManagerChangedFields = (body: unknown): readonly string[] => {
  if (!isPlainRecord(body)) {
    return [];
  }

  const data = isPlainRecord(body.data) ? body.data : body;
  return Object.keys(data)
    .filter((key) => !CONTENT_MANAGER_EXCLUDED_FIELDS.has(key))
    .sort((left, right) => left.localeCompare(right));
};

export const maskAuditIdentifier = (value: string): string => {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at > 0) {
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1);
    const visible = local.slice(0, 1);
    return `${visible}***@${domain}`;
  }

  if (trimmed.length <= 2) {
    return '***';
  }

  return `***${trimmed.slice(-2)}`;
};

export const boundTargetLabel = (value: string | null | undefined): string | undefined => {
  const trimmed = trimmedNonEmptyString(value);
  if (!trimmed) {
    return undefined;
  }
  return boundString(trimmed);
};
