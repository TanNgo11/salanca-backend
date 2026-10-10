/** Shared validation result used by the admin bundle and the server middleware.
 *
 * This module deliberately has no Strapi, Node, or server imports. Keep the
 * structural validators browser-safe: the Admin custom fields are compiled by
 * Vite and must not pull the Node-only `@strapi/utils` package into that bundle.
 */
export type ValidationPath = Array<string | number>;

export type ValidationFailure = {
  valid: false;
  message: string;
  code: string;
  path: ValidationPath;
  details: Record<string, unknown>;
};

export type ValidationSuccess<T> = { valid: true; value: T };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function isValidationFailure(value: unknown): value is ValidationFailure {
  return isRecord(value) && value.valid === false && typeof value.message === 'string';
}

export function validationFailure(
  field: string,
  path: ValidationPath,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ValidationFailure {
  return {
    valid: false,
    message: `${field}${path.length > 0 ? `.${path.join('.')}` : ''}: ${message}`,
    code,
    path,
    details: { field, path, ...details },
  };
}

export function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function assertStrictKeys(
  field: string,
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: ValidationPath,
): ValidationFailure | undefined {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return undefined;
  const keys = unknown.map((key) => `'${key}'`).join(', ');
  return validationFailure(field, path, 'unrecognized_keys', `Unrecognized key(s) in object: ${keys}`);
}
