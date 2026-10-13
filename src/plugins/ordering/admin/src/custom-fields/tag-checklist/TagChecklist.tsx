import { useState } from 'react';
import { Box, Button, Checkbox, Field, Flex, Tag, TextInput, Typography } from '@strapi/design-system';
import { Cross, Plus } from '@strapi/icons';
import { useIntl } from 'react-intl';

import { PLUGIN_ID } from '../../pluginId';

export type ChecklistOption = { code: string; i18nKey: string };

type Props = {
  name: string;
  value?: unknown;
  onChange: (event: { target: { name: string; type: string; value: string[] } }) => void;
  intlLabel?: { defaultMessage?: string };
  intlDescription?: { defaultMessage?: string };
  disabled?: boolean;
  required?: boolean;
  error?: string;
  options: ChecklistOption[];
  /** Renders a "Khác" add-row; entries persist as `custom:<name>` codes. */
  allowCustom?: boolean;
};

const CUSTOM_PREFIX = 'custom:';

const codesOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Checkbox grid for closed-code fields (O12 N5): known codes toggle directly, `custom:`
 * entries show as removable tags plus an add-row. Emits a deduped `string[]`.
 */
const TagChecklist = (props: Props) => {
  const intl = useIntl();
  const [customName, setCustomName] = useState('');
  const value = codesOf(props.value);
  const known = props.options.map((option) => option.code);
  const customs = value.filter((code) => code.startsWith(CUSTOM_PREFIX));

  const emit = (next: string[]) =>
    props.onChange({
      target: { name: props.name, type: 'json', value: [...new Set(next)] },
    });

  const toggle = (code: string, checked: boolean) =>
    emit(checked ? [...value, code] : value.filter((item) => item !== code));

  const addCustom = () => {
    const name = customName.trim();
    if (name === '') return;
    emit([...value, `${CUSTOM_PREFIX}${name}`]);
    setCustomName('');
  };

  const label = (option: ChecklistOption) =>
    intl.formatMessage({ id: `${PLUGIN_ID}.${option.i18nKey}`, defaultMessage: option.code });

  return (
    <Field.Root name={props.name} error={props.error} required={props.required}>
      <Field.Label>{props.intlLabel?.defaultMessage ?? props.name}</Field.Label>
      {props.intlDescription?.defaultMessage ? (
        <Typography variant="pi" textColor="neutral600">
          {props.intlDescription.defaultMessage}
        </Typography>
      ) : null}
      <Flex wrap="wrap" gap={3} paddingTop={2}>
        {props.options.map((option) => (
          <Box key={option.code} style={{ minWidth: '30%' }}>
            <Checkbox
              checked={value.includes(option.code)}
              disabled={props.disabled}
              onCheckedChange={(checked: boolean) => toggle(option.code, checked === true)}
            >
              {label(option)}
            </Checkbox>
          </Box>
        ))}
      </Flex>
      {props.allowCustom ? (
        <Box paddingTop={3}>
          <Flex wrap="wrap" gap={2}>
            {customs.map((code) => (
              <Tag
                key={code}
                icon={<Cross aria-hidden />}
                onClick={() => emit(value.filter((item) => item !== code))}
              >
                {code.slice(CUSTOM_PREFIX.length)}
              </Tag>
            ))}
          </Flex>
          <Flex gap={2} paddingTop={2} alignItems="flex-end">
            <Box style={{ maxWidth: 280 }}>
              <TextInput
                aria-label={`${props.name}-custom`}
                placeholder={intl.formatMessage({
                  id: `${PLUGIN_ID}.catalog.allergen.custom`,
                  defaultMessage: 'Khác — nhập tên',
                })}
                disabled={props.disabled}
                value={customName}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setCustomName(event.target.value)
                }
                onKeyDown={(event: React.KeyboardEvent) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustom();
                  }
                }}
              />
            </Box>
            <Button
              size="S"
              variant="tertiary"
              startIcon={<Plus />}
              disabled={props.disabled || customName.trim() === ''}
              onClick={addCustom}
            >
              {intl.formatMessage({ id: `${PLUGIN_ID}.catalog.allergen.add`, defaultMessage: 'Thêm' })}
            </Button>
          </Flex>
        </Box>
      ) : null}
      <Field.Error />
    </Field.Root>
  );
};

export default TagChecklist;
