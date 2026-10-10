import { forwardRef, useEffect, useState } from 'react';
import { Field, TextInput, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';

import { PLUGIN_ID } from '../pluginId';

type Props = {
  name: string;
  value?: Record<string, string> | null;
  onChange: (event: {
    target: { name: string; type: string; value: Record<string, string> };
  }) => void;
  intlLabel?: { defaultMessage?: string };
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

type LocaleRow = { code: string; name?: string; isDefault?: boolean };

/** Locales the staff can type, from the i18n admin API. `['vi', 'en']` when i18n is absent. */
const useEnabledLocales = (): { locales: LocaleRow[]; defaultLocale: string } => {
  const { get } = useFetchClient();
  const [state, setState] = useState<{ locales: LocaleRow[]; defaultLocale: string }>({
    locales: [
      { code: 'vi', isDefault: true },
      { code: 'en' },
    ],
    defaultLocale: 'vi',
  });
  useEffect(() => {
    let cancelled = false;
    get('/i18n/locales')
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data) || data.length === 0) return;
        const rows = data
          .filter((row): row is LocaleRow => typeof row?.code === 'string')
          .map((row) => ({ code: row.code, name: row.name, isDefault: row.isDefault === true }));
        if (rows.length > 0) {
          setState({
            locales: rows,
            defaultLocale: rows.find((row) => row.isDefault)?.code ?? rows[0].code,
          });
        }
      })
      .catch(() => {
        // i18n plugin disabled or route denied → keep the configured fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [get]);
  return state;
};

/**
 * One input per enabled locale (contracts §20.1). Emits `{ <locale>: <string> }`; a locale left
 * untouched stays absent from the map so empty strings never shadow real translations.
 */
const LocalizedTextInput = forwardRef<HTMLInputElement, Props>((props, ref) => {
  const { locales, defaultLocale } = useEnabledLocales();
  const intl = useIntl();
  return (
    <Field.Root name={props.name} error={props.error} required={props.required}>
      <Field.Label>{props.intlLabel?.defaultMessage ?? props.name}</Field.Label>
      {locales.map((locale, index) => (
        <div key={locale.code} style={{ marginBottom: 4 }}>
          <Typography variant="pi" textColor="neutral600">
            {locale.name ??
              intl.formatMessage(
                { id: `${PLUGIN_ID}.localized-text.locale.${locale.code}`, defaultMessage: locale.code },
              )}
            {locale.code === defaultLocale
              ? ` · ${intl.formatMessage({
                  id: `${PLUGIN_ID}.localized-text.default`,
                  defaultMessage: 'mặc định',
                })}`
              : ''}
          </Typography>
          <TextInput
            ref={index === 0 ? ref : undefined}
            aria-label={`${props.name} (${locale.code})`}
            placeholder={locale.name ?? locale.code}
            disabled={props.disabled}
            value={props.value?.[locale.code] ?? ''}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              props.onChange({
                target: {
                  name: props.name,
                  type: 'json',
                  value: { ...props.value, [locale.code]: event.target.value },
                },
              })
            }
          />
        </div>
      ))}
      <Field.Error />
    </Field.Root>
  );
});
LocalizedTextInput.displayName = 'LocalizedTextInput';
export default LocalizedTextInput;
