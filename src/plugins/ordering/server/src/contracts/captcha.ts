import type { ValidationResult } from './common';

/** Captcha proves a request is not a bot; it is not a substitute for idempotency or scope (§11). */
export interface CaptchaProvider {
  code: string;
  verify(input: { token: string; ip?: string; action: string }): Promise<ValidationResult>;
}
