import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  EmptyStateLayout,
  Field,
  Flex,
  IconButton,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';

import { useT } from '../../lib/i18n';

type Range = { start: string; end: string };

export type SpecialHourRow = {
  date: string;
  closed: boolean;
  ranges: Range[];
  note?: string;
};

const MAX_ROWS = 366;
const MAX_RANGES = 6;

/** `YYYY-MM-DD` in an IANA timezone, without importing server code. */
export const localToday = (timezone: string): string => {
  const zone = timezone || 'Asia/Ho_Chi_Minh';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const parts = formatter.formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const nextDate = (today: string, taken: Set<string>): string => {
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let step = 0; step < MAX_ROWS; step += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (!taken.has(date)) return date;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return today;
};

const sorted = (rows: SpecialHourRow[]): SpecialHourRow[] =>
  [...rows].sort((left, right) => left.date.localeCompare(right.date));

const messageKey = (message: string | undefined): string | undefined => {
  if (!message) return undefined;
  if (message === 'duplicate special date') return 'branch.special.duplicate';
  if (message === 'ranges overlap') return 'branch.special.overlap';
  if (message.startsWith('closed is true')) return 'branch.special.needRange';
  return undefined;
};

/**
 * One receive method's special days (screens E1). Past days stay, folded behind a toggle.
 * A confirm dialog copies the list onto the other method; there is no dropdown inside it.
 */
export const SpecialHoursEditor = ({
  rows,
  onChange,
  timezone,
  errorPrefix,
  errors,
  copyLabel,
  onCopy,
}: {
  rows: SpecialHourRow[];
  onChange: (next: SpecialHourRow[]) => void;
  timezone: string;
  errorPrefix: string;
  errors: Record<string, string>;
  copyLabel: string;
  onCopy: () => void;
}) => {
  const t = useT();
  const today = localToday(timezone);
  const [showPast, setShowPast] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ordered = sorted(rows);
  const indexed = ordered.map((row, index) => ({ row, index }));
  const past = indexed.filter(({ row }) => row.date < today);
  const upcoming = indexed.filter(({ row }) => row.date >= today);

  const write = (next: SpecialHourRow[]) => onChange(sorted(next));

  const update = (index: number, next: SpecialHourRow) => {
    write(ordered.map((row, i) => (i === index ? next : row)));
  };

  const rowMessage = (index: number): string | undefined => {
    const prefix = `${errorPrefix}.${index}`;
    const raw = errors[prefix] || errors[`${prefix}.date`] || errors[`${prefix}.ranges`];
    if (!raw) return undefined;
    const key = messageKey(raw);
    return key ? t(key) : raw;
  };

  const renderRow = (row: SpecialHourRow, index: number) => {
    const message = rowMessage(index);
    return (
      <Flex key={`${row.date}-${index}`} direction="column" alignItems="stretch" gap={2}>
        <Flex gap={2} alignItems="flex-end" wrap="wrap">
          <Field.Root name={`${errorPrefix}.${index}.date`} error={message}>
            <Field.Label>{t('branch.special.date')}</Field.Label>
            <TextInput
              type="date"
              value={row.date}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                update(index, { ...row, date: event.target.value })
              }
            />
          </Field.Root>
          <Flex gap={2} paddingBottom={2}>
            <Switch
              checked={row.closed}
              onCheckedChange={(closed: boolean) =>
                update(index, {
                  ...row,
                  closed,
                  ranges: closed ? [] : row.ranges.length > 0 ? row.ranges : [{ start: '10:00', end: '14:00' }],
                })
              }
            />
            <Typography>{t('branch.special.closed')}</Typography>
          </Flex>
          <Box grow={1} minWidth="160px">
            <Field.Root name={`${errorPrefix}.${index}.note`}>
              <Field.Label>{t('branch.special.note')}</Field.Label>
              <TextInput
                value={row.note ?? ''}
                maxLength={100}
                placeholder={t('branch.special.notePlaceholder')}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  update(index, { ...row, note: event.target.value })
                }
              />
            </Field.Root>
          </Box>
          <IconButton
            label={t('branch.special.remove')}
            variant="ghost"
            onClick={() => write(ordered.filter((_, i) => i !== index))}
          >
            <Trash />
          </IconButton>
        </Flex>
        {row.closed ? null : (
          <Flex direction="column" alignItems="stretch" gap={2} paddingLeft={2}>
            {row.ranges.map((range, rangeIndex) => (
              <Flex key={rangeIndex} gap={2} alignItems="center">
                <TextInput
                  type="time"
                  aria-label={t('branch.special.open')}
                  value={range.start}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    update(index, {
                      ...row,
                      ranges: row.ranges.map((item, i) =>
                        i === rangeIndex ? { ...item, start: event.target.value } : item,
                      ),
                    })
                  }
                />
                <Typography>–</Typography>
                <TextInput
                  type="time"
                  aria-label={t('branch.special.close')}
                  value={range.end}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    update(index, {
                      ...row,
                      ranges: row.ranges.map((item, i) =>
                        i === rangeIndex ? { ...item, end: event.target.value } : item,
                      ),
                    })
                  }
                />
                {range.end < range.start ? (
                  <Typography textColor="neutral600">{t('branch.pastMidnight')}</Typography>
                ) : null}
                <IconButton
                  label={t('branch.special.removeRange')}
                  variant="ghost"
                  onClick={() =>
                    update(index, { ...row, ranges: row.ranges.filter((_, i) => i !== rangeIndex) })
                  }
                >
                  <Trash />
                </IconButton>
              </Flex>
            ))}
            {row.ranges.length < MAX_RANGES ? (
              <Box>
                <Button
                  size="S"
                  variant="tertiary"
                  startIcon={<Plus />}
                  onClick={() =>
                    update(index, { ...row, ranges: [...row.ranges, { start: '10:00', end: '14:00' }] })
                  }
                >
                  {t('branch.special.addRange')}
                </Button>
              </Box>
            ) : null}
          </Flex>
        )}
        {message ? <Typography textColor="danger600">{message}</Typography> : null}
      </Flex>
    );
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta">{t('branch.special.title')}</Typography>
        <Button variant="tertiary" onClick={() => setConfirming(true)}>
          {copyLabel}
        </Button>
      </Flex>
      {rows.length === 0 ? <EmptyStateLayout content={t('branch.special.empty')} /> : null}
      {upcoming.map(({ row, index }) => renderRow(row, index))}
      {past.length > 0 ? (
        <Box>
          <Button variant="tertiary" onClick={() => setShowPast((open) => !open)}>
            {t('branch.special.past', { count: past.length })}
          </Button>
          {showPast ? (
            <Flex direction="column" alignItems="stretch" gap={3} paddingTop={3}>
              {past.map(({ row, index }) => renderRow(row, index))}
            </Flex>
          ) : null}
        </Box>
      ) : null}
      {rows.length < MAX_ROWS ? (
        <Box>
          <Button
            variant="secondary"
            startIcon={<Plus />}
            onClick={() =>
              write([
                ...rows,
                {
                  date: nextDate(today, new Set(rows.map((row) => row.date))),
                  closed: false,
                  ranges: [{ start: '10:00', end: '14:00' }],
                },
              ])
            }
          >
            {t('branch.special.add')}
          </Button>
        </Box>
      ) : null}
      <Typography variant="pi" textColor="neutral600">
        {t('branch.special.hint')}
      </Typography>
      {errors[errorPrefix] ? <Typography textColor="danger600">{errors[errorPrefix]}</Typography> : null}
      <Dialog.Root open={confirming} onOpenChange={(open: boolean) => !open && setConfirming(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('branch.special.copyTitle')}</Dialog.Header>
          <Dialog.Body>
            <Typography>{t('branch.special.copyBody')}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary" onClick={() => setConfirming(false)}>
                {t('branch.special.copyCancel')}
              </Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button
                onClick={() => {
                  onCopy();
                  setConfirming(false);
                }}
              >
                {t('branch.special.copyConfirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
