/**
 * Shared domain validation error for public form intake.
 * Feature modules own code enums; this class carries the code as a string.
 */

export class FormValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FormValidationError';
    this.code = code;
  }
}

export type FormFail = (code: string, message: string) => never;

/** Builds a fail helper that throws FormValidationError with the given code. */
export const createFormFail = (): FormFail => (code, message) => {
  throw new FormValidationError(code, message);
};
