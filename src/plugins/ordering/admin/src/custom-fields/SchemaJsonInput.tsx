import { forwardRef, useEffect, useRef, useState } from 'react';
import { Field, Textarea, Typography } from '@strapi/design-system';

export type JsonValidation =
  | { valid: true; value: unknown }
  | { valid: false; message: string };

type Props = {
  name: string;
  value?: unknown;
  onChange: (event: { target: { name: string; type: string; value: unknown } }) => void;
  intlLabel?: { defaultMessage?: string };
  intlDescription?: { defaultMessage?: string };
  disabled?: boolean;
  required?: boolean;
  error?: string;
  /** Structural check run on the parsed JSON before the value is emitted upward. */
  validate: (raw: unknown) => JsonValidation;
};

const pretty = (value: unknown): string =>
  value === null || value === undefined ? '' : JSON.stringify(value, null, 2);

/**
 * Schema-aware JSON editor: a formatted textarea that only emits a parsed value when it both
 * parses and passes the same domain schema the server enforces. Reference checks (documentIds
 * of groups/modifiers/variants) still happen server-side — this editor reports them verbatim.
 * Fallback for the structured pickers planned later; the deviation is recorded in the O2
 * completion record.
 */
const SchemaJsonInput = forwardRef<HTMLTextAreaElement, Props>((props, ref) => {
  const [draft, setDraft] = useState(() => pretty(props.value));
  const [localError, setLocalError] = useState<string | null>(null);
  const lastEmitted = useRef<string>(pretty(props.value));

  // Adopt external resets (form reset, locale switches) but never clobber an in-progress edit.
  useEffect(() => {
    const incoming = pretty(props.value);
    if (incoming !== lastEmitted.current) {
      setDraft(incoming);
      setLocalError(null);
      lastEmitted.current = incoming;
    }
  }, [props.value]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    setDraft(text);
    if (text.trim().length === 0) {
      setLocalError(null);
      lastEmitted.current = '';
      props.onChange({ target: { name: props.name, type: 'json', value: null } });
      return;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const result = props.validate(parsed);
      if (!result.valid) {
        setLocalError(result.message);
        return;
      }
      setLocalError(null);
      lastEmitted.current = text;
      props.onChange({ target: { name: props.name, type: 'json', value: result.value } });
    } catch (error) {
      setLocalError((error as Error).message);
    }
  };

  return (
    <Field.Root
      name={props.name}
      error={props.error ?? localError ?? undefined}
      required={props.required}
    >
      <Field.Label>{props.intlLabel?.defaultMessage ?? props.name}</Field.Label>
      {props.intlDescription?.defaultMessage ? (
        <Typography variant="pi" textColor="neutral600">
          {props.intlDescription.defaultMessage}
        </Typography>
      ) : null}
      <Textarea
        ref={ref}
        aria-label={props.name}
        disabled={props.disabled}
        value={draft}
        onChange={handleChange}
        style={{ fontFamily: 'monospace', minHeight: '10rem' }}
      />
      <Field.Error />
    </Field.Root>
  );
});
SchemaJsonInput.displayName = 'SchemaJsonInput';
export default SchemaJsonInput;
