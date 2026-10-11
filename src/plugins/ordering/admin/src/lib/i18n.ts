import { useCallback } from 'react';
import { useIntl } from 'react-intl';

import { PLUGIN_ID } from '../pluginId';
import { o3Messages } from '../translations/o3';

export type Translate = (
  key: string,
  values?: Record<string, string | number>,
  fallback?: string,
) => string;

/**
 * O3 screens keep VI and EN side by side in `translations/o3.ts` (one source, no key drift);
 * `registerTrads` merges them into the plugin's locale files.
 */
export const useT = (): Translate => {
  const { formatMessage } = useIntl();
  return useCallback(
    (key, values, fallback) => {
      const defaultMessage = o3Messages[key]?.[0] ?? fallback ?? key;
      if (!o3Messages[key] && fallback !== undefined) return fallback;
      return formatMessage({ id: `${PLUGIN_ID}.${key}`, defaultMessage }, values);
    },
    [formatMessage],
  );
};

export const o3Translations = (locale: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o3Messages).map(([key, [vi, en]]) => [`${PLUGIN_ID}.${key}`, locale === 'en' ? en : vi]),
  );

/** Admin interface language ('vi' | 'en'), for picking `{ vi, en }` catalog/branch names. */
export const useLocale = (): string => {
  const { locale } = useIntl();
  return locale?.startsWith('en') ? 'en' : 'vi';
};
