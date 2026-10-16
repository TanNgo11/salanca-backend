import type { Translate } from './i18n';

export type ValidationIssue = { path?: string; message?: string; code?: string; min?: number; max?: number };

/**
 * Text for one server validation issue: `validation.<path>.<code>`, then `validation.<code>`, then a
 * generic line. The server `message` is English and is never shown.
 */
export const issueText = (t: Translate, issue: ValidationIssue): string => {
  const values = { min: issue.min ?? '', max: issue.max ?? '' };
  const code = issue.code ?? '';
  for (const key of [`validation.${issue.path ?? ''}.${code}`, `validation.${code}`]) {
    const text = t(key, values, '');
    if (text) return text;
  }
  return t('validation.invalid');
};

export const fieldErrorsOf = (issues: ValidationIssue[], t: Translate): Record<string, string> =>
  Object.fromEntries(issues.map((issue) => [issue.path ?? '', issueText(t, issue)]));
