import { createLogger, REDACT_PATTERNS } from '@tanngo11/log';

/**
 * Process-wide structured logger (log contract v1). `strapi.log` routes through it via
 * `config/logger.ts`; LOG_LEVEL sets the minimum level (default `info`).
 * Vietnamese phone numbers are masked in every string: reservation and contact leads carry them.
 */
export const log = createLogger({ redactValues: [REDACT_PATTERNS.phoneVN] });
