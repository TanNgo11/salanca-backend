import { z } from '@strapi/utils';

const issueText = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

/**
 * Shared strict parser for O13 provider settings (same contract as `parseSepaySettings`):
 * `null` when the entry is absent or `enabled !== true`; a thrown Error when it is enabled
 * but malformed — boot must fail before a webhook can be accepted unsigned or a credential
 * is half-configured. `refines` run after the schema for cross-field rules.
 */
export const parseProviderSettings = <T>(
  name: string,
  schema: z.ZodType<T>,
  raw: unknown,
  refines: Array<(settings: T) => string | null> = [],
): T | null => {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${name}: expected an object keyed by setting name`);
  }
  if ((raw as { enabled?: unknown }).enabled !== true) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name}: ${issueText(parsed.error)}`);
  }
  for (const refine of refines) {
    const message = refine(parsed.data);
    if (message) throw new Error(`${name}: ${message}`);
  }
  return parsed.data;
};
