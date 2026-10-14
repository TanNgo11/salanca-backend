import { useCallback } from 'react';
import { useIntl } from 'react-intl';

import { PLUGIN_ID } from '../pluginId';
import { o3Messages } from '../translations/o3';
import { o4Messages } from '../translations/o4';
import { o5Messages } from '../translations/o5';
import { o6Messages } from '../translations/o6';
import { o7Messages } from '../translations/o7';
import { o15Messages } from '../translations/o15';
import { o10Messages } from '../translations/o10';
import { o11Messages } from '../translations/o11';
import { o8Messages } from '../translations/o8';
import { o9Messages } from '../translations/o9';
import { o13Messages } from '../translations/o13';
import { o14Messages } from '../translations/o14';

const messagesOf = (key: string): [string, string] | undefined =>
  o3Messages[key] ??
  o4Messages[key] ??
  o5Messages[key] ??
  o6Messages[key] ??
  o7Messages[key] ??
  o15Messages[key] ??
  o10Messages[key] ??
  o11Messages[key] ??
  o8Messages[key] ??
  o9Messages[key] ??
  o13Messages[key] ??
  o14Messages[key];

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
      const entry = messagesOf(key);
      const defaultMessage = entry?.[0] ?? fallback ?? key;
      if (!entry && fallback !== undefined) return fallback;
      return formatMessage({ id: `${PLUGIN_ID}.${key}`, defaultMessage }, values);
    },
    [formatMessage],
  );
};

const pack = (messages: Record<string, [string, string]>, locale: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(messages).map(([key, [vi, en]]) => [`${PLUGIN_ID}.${key}`, locale === 'en' ? en : vi]),
  );

export const o3Translations = (locale: string): Record<string, string> => pack(o3Messages, locale);

export const o4Translations = (locale: string): Record<string, string> => pack(o4Messages, locale);

export const o5Translations = (locale: string): Record<string, string> => pack(o5Messages, locale);

export const o6Translations = (locale: string): Record<string, string> => pack(o6Messages, locale);

export const o7Translations = (locale: string): Record<string, string> => pack(o7Messages, locale);

export const o15Translations = (locale: string): Record<string, string> => pack(o15Messages, locale);

export const o10Translations = (locale: string): Record<string, string> => pack(o10Messages, locale);

export const o11Translations = (locale: string): Record<string, string> => pack(o11Messages, locale);
export const o8Translations = (locale: string): Record<string, string> => pack(o8Messages, locale);
export const o9Translations = (locale: string): Record<string, string> => pack(o9Messages, locale);
export const o13Translations = (locale: string): Record<string, string> => pack(o13Messages, locale);

export const o14Translations = (locale: string): Record<string, string> => pack(o14Messages, locale);

/** Admin interface language ('vi' | 'en'), for picking `{ vi, en }` catalog/branch names. */
export const useLocale = (): string => {
  const { locale } = useIntl();
  return locale?.startsWith('en') ? 'en' : 'vi';
};
