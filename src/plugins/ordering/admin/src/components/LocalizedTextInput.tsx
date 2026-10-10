import { forwardRef } from 'react';
import { Field, TextInput } from '@strapi/design-system';

type Props = {
  name: string;
  value?: Record<string, string> | null;
  onChange: (event: { target: { name: string; type: string; value: Record<string, string> } }) => void;
  intlLabel?: { defaultMessage?: string };
  disabled?: boolean;
  required?: boolean;
  error?: string;
};

const LocalizedTextInput = forwardRef<HTMLInputElement, Props>((props, ref) => (
  <Field.Root name={props.name} error={props.error} required={props.required}>
    <Field.Label>{props.intlLabel?.defaultMessage ?? props.name}</Field.Label>
    {['vi', 'en'].map((locale, index) => (
      <TextInput
        key={locale}
        ref={index === 0 ? ref : undefined}
        aria-label={`${props.name} (${locale.toUpperCase()})`}
        placeholder={locale === 'vi' ? 'Tiếng Việt' : 'English'}
        disabled={props.disabled}
        value={props.value?.[locale] ?? ''}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => props.onChange({
          target: { name: props.name, type: 'json', value: { ...props.value, [locale]: event.target.value } },
        })}
      />
    ))}
    <Field.Error />
  </Field.Root>
));
LocalizedTextInput.displayName = 'LocalizedTextInput';
export default LocalizedTextInput;
