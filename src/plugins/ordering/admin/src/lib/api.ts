import { useCallback } from 'react';
import { useNotification } from '@strapi/strapi/admin';

import type { Translate } from './i18n';
import { useT } from './i18n';
import { fieldErrorsOf, issueText, type ValidationIssue } from './validation';

export type ApiError = { code?: string; message?: string; details?: Record<string, unknown> };

/** The `{ error: { code, message, details } }` body of a failed plugin route, if any. */
export const apiErrorOf = (error: unknown): ApiError => {
  const body = (error as { response?: { data?: { error?: ApiError } } })?.response?.data?.error;
  return body ?? {};
};

/** HTTP status of a failed admin fetch (Strapi's FetchError keeps it on `status`). */
export const httpStatusOf = (error: unknown): number | undefined => {
  const value = error as { status?: number; response?: { status?: number } };
  return value?.status ?? value?.response?.status;
};

/**
 * Field-addressed validation issues (`details.issues[{ path, message, code, min, max }]`) by path.
 * Pass `t` to render translated text (the server `message` is English); without it the raw server
 * message is kept for callers that have no translator in scope.
 */
export const fieldErrors = (error: unknown, t?: Translate): Record<string, string> => {
  const issues = apiErrorOf(error).details?.issues;
  if (!Array.isArray(issues)) {
    const field = apiErrorOf(error).details?.field;
    return typeof field === 'string' ? { [field]: apiErrorOf(error).message ?? '' } : {};
  }
  if (t) return fieldErrorsOf(issues as ValidationIssue[], t);
  return Object.fromEntries(
    (issues as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? '', issue.message ?? '']),
  );
};

/** Danger toast with a translated message for known codes, the server message otherwise. */
export const useErrorToast = () => {
  const { toggleNotification } = useNotification();
  const t = useT();
  return useCallback(
    (error: unknown) => {
      const { code, message, details } = apiErrorOf(error);
      const known = code ? t(`error.${code}`, undefined, '') : '';
      const head = known || message || t('error.generic');
      const issue = (details?.issues as ValidationIssue[] | undefined)?.[0];
      toggleNotification({ type: 'danger', message: issue ? `${head}: ${issueText(t, issue)}` : head });
    },
    [t, toggleNotification],
  );
};
