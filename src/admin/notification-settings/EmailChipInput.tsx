import { useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';

import { Field, Flex, Tag, TextInput } from '@strapi/design-system';
import { Cross } from '@strapi/icons';

import { addRecipients, MAX_RECIPIENTS_PER_KIND } from './notification-settings.helper';

type EmailChipInputProps = {
  id: string;
  label: string;
  hint: string;
  value: string[];
  /** Typed text not yet turned into a chip; owned by the screen so Save can include it. */
  draft: string;
  /** Error set by the screen (e.g. a bad entry found on save). */
  externalError?: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
  onDraftChange: (next: string) => void;
};

const COMMIT_KEYS = new Set(['Enter', ',', ';', ' ']);

export const EmailChipInput = ({
  id,
  label,
  hint,
  value,
  draft,
  externalError,
  disabled,
  onChange,
  onDraftChange,
}: EmailChipInputProps) => {
  const [localError, setError] = useState<string | undefined>();
  const error = localError ?? externalError;
  const full = value.length >= MAX_RECIPIENTS_PER_KIND;

  const commit = (raw: string): void => {
    if (!raw.trim()) return;
    const { list, invalid } = addRecipients(value, raw);
    const kept = list.slice(0, MAX_RECIPIENTS_PER_KIND);
    onChange(kept);
    onDraftChange(invalid.join(' '));
    setError(
      invalid.length > 0
        ? `Email không hợp lệ: ${invalid.join(', ')}`
        : list.length > kept.length
          ? `Tối đa ${MAX_RECIPIENTS_PER_KIND} email.`
          : undefined,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (COMMIT_KEYS.has(event.key) || (event.key === 'Tab' && draft.trim() !== '')) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    commit(`${draft} ${event.clipboardData.getData('text')}`);
  };

  return (
    <Field.Root error={error} hint={hint} id={id} name={id}>
      <Field.Label>{label}</Field.Label>
      {value.length > 0 ? (
        <Flex gap={2} paddingBottom={2} wrap="wrap">
          {value.map((address) => (
            <Tag
              disabled={disabled}
              icon={<Cross aria-hidden />}
              key={address}
              label={`Xoá ${address}`}
              onClick={() => onChange(value.filter((entry) => entry !== address))}
            >
              {address}
            </Tag>
          ))}
        </Flex>
      ) : null}
      <TextInput
        disabled={disabled || full}
        onBlur={() => commit(draft)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onDraftChange(event.target.value);
          setError(undefined);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={full ? `Đã đủ ${MAX_RECIPIENTS_PER_KIND} email` : 'Nhập email rồi bấm Enter'}
        value={draft}
      />
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );
};
