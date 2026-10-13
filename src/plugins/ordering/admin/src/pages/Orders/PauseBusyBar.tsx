import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  TextInput,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

import { formatTime } from '../../lib/format';
import { isCounterPrinter, setCounterPrinter } from '../../lib/print';
import { useT } from '../../lib/i18n';

const KINDS = ['pickup', 'delivery', 'dineIn'] as const;
type Kind = (typeof KINDS)[number];

export type BranchAvailability = {
  pause: Partial<Record<Kind, { until: string; reason?: string; by?: string } | null>> | null;
  busy: { extraMinutes: number; until: string; by?: string } | null;
};

const isActive = (until: string | undefined | null): boolean =>
  Boolean(until) && new Date(until as string).getTime() > Date.now();

const PAUSE_DURATIONS = [15, 30, 60, 120] as const;
const BUSY_EXTRAS = [10, 20, 30] as const;
const BUSY_DURATIONS = [30, 60, 120] as const;

/**
 * N3: the branch availability bar on the orders inbox. Paused kinds and busy mode show as
 * badges with their resume time; staff (`order.process`) open the two small dialogs to set a
 * new deadline. The server re-checks pause on every quote/create — this is only the control.
 */
export const PauseBusyBar = ({
  branch,
  availability,
  timezone,
  canProcess,
  onChanged,
}: {
  branch: string;
  availability: BranchAvailability | null | undefined;
  timezone: string;
  canProcess: boolean;
  onChanged: () => void;
}) => {
  const t = useT();
  const { post } = useFetchClient();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [busyOpen, setBusyOpen] = useState(false);
  const [kinds, setKinds] = useState<Kind[]>(['pickup']);
  const [minutes, setMinutes] = useState<number | 'endOfDay'>(30);
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState(20);
  const [busyMinutes, setBusyMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // N1: "máy in quầy" — a per-browser flag, not server data. When set, the inbox
  // auto-prints kitchen tickets for branches with `printing.autoKitchenTicket`.
  const [counter, setCounter] = useState(isCounterPrinter);

  const paused = useMemo(
    () =>
      KINDS.map((kind) => ({ kind, entry: availability?.pause?.[kind] ?? null })).filter(({ entry }) =>
        isActive(entry?.until),
      ),
    [availability],
  );
  const busyActive = isActive(availability?.busy?.until);

  const run = async (path: string, body: Record<string, unknown>) => {
    setSaving(true);
    setError('');
    try {
      await post(`/ordering/branches/${encodeURIComponent(branch)}/${path}`, body);
      onChanged();
      return true;
    } catch {
      setError(t('pause.failed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box paddingBottom={4}>
      <Flex gap={2} wrap="wrap" alignItems="center">
        {paused.map(({ kind, entry }) => (
          <Badge key={kind} variant="danger">
            {t('pause.bar.paused', {
              kinds: t(`kind.${kind}`),
              until: entry?.until ? formatTime(entry.until, timezone) : '',
            })}
          </Badge>
        ))}
        {busyActive && availability?.busy ? (
          <Badge variant="warning">
            {t('pause.bar.busy', {
              extra: availability.busy.extraMinutes,
              until: formatTime(availability.busy.until, timezone),
            })}
          </Badge>
        ) : null}
        {canProcess ? (
          <>
            <Button size="S" variant="tertiary" onClick={() => setPauseOpen(true)}>
              {t('pause.open')}
            </Button>
            {paused.length > 0 ? (
              <Button
                size="S"
                variant="tertiary"
                loading={saving}
                onClick={() =>
                  void run('resume', { kinds: paused.map((item) => item.kind) }).then(() => undefined)
                }
              >
                {t('pause.resume')}
              </Button>
            ) : null}
            <Button size="S" variant="tertiary" onClick={() => setBusyOpen(true)}>
              {t('busy.open')}
            </Button>
            {busyActive ? (
              <Button
                size="S"
                variant="tertiary"
                loading={saving}
                onClick={() => void run('busy/clear', {}).then(() => undefined)}
              >
                {t('busy.clear')}
              </Button>
            ) : null}
          </>
        ) : null}
        <Box marginLeft="auto">
          <Checkbox
            checked={counter}
            onCheckedChange={(checked: boolean) => {
              setCounter(checked === true);
              setCounterPrinter(checked === true);
            }}
          >
            {t('print.counter')}
          </Checkbox>
        </Box>
      </Flex>
      {error ? (
        <Box paddingTop={2}>
          <Alert variant="danger" closeLabel={t('common.close')} onClose={() => setError('')}>
            {error}
          </Alert>
        </Box>
      ) : null}

      <Modal.Root open={pauseOpen} onOpenChange={setPauseOpen}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('pause.openTitle')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" gap={4} alignItems="stretch">
              <Field.Root>
                <Field.Label>{t('pause.kinds')}</Field.Label>
                <Flex gap={4}>
                  {KINDS.map((kind) => (
                    <Checkbox
                      key={kind}
                      checked={kinds.includes(kind)}
                      onCheckedChange={(checked: boolean) =>
                        setKinds((current) =>
                          checked ? [...current, kind] : current.filter((item) => item !== kind),
                        )
                      }
                    >
                      {t(`kind.${kind}`)}
                    </Checkbox>
                  ))}
                </Flex>
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('pause.duration')}</Field.Label>
                <SingleSelect
                  value={String(minutes)}
                  onChange={(value: string | number) =>
                    setMinutes(value === 'endOfDay' ? 'endOfDay' : Number(value))
                  }
                >
                  {PAUSE_DURATIONS.map((option) => (
                    <SingleSelectOption key={option} value={String(option)}>
                      {t('pause.minutes', { count: option })}
                    </SingleSelectOption>
                  ))}
                  <SingleSelectOption value="endOfDay">{t('pause.endOfDay')}</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('pause.reason')}</Field.Label>
                <TextInput value={reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} />
              </Field.Root>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button
              loading={saving}
              disabled={kinds.length === 0}
              onClick={() =>
                void run('pause', {
                  kinds,
                  ...(minutes === 'endOfDay' ? { endOfDay: true } : { minutes }),
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                }).then((ok) => {
                  if (ok) setPauseOpen(false);
                })
              }
            >
              {t('pause.confirm')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>

      <Modal.Root open={busyOpen} onOpenChange={setBusyOpen}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('busy.openTitle')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" gap={4} alignItems="stretch">
              <Field.Root>
                <Field.Label>{t('busy.extra')}</Field.Label>
                <SingleSelect value={String(extra)} onChange={(value: string | number) => setExtra(Number(value))}>
                  {BUSY_EXTRAS.map((option) => (
                    <SingleSelectOption key={option} value={String(option)}>
                      +{t('pause.minutes', { count: option })}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('busy.duration')}</Field.Label>
                <SingleSelect
                  value={String(busyMinutes)}
                  onChange={(value: string | number) => setBusyMinutes(Number(value))}
                >
                  {BUSY_DURATIONS.map((option) => (
                    <SingleSelectOption key={option} value={String(option)}>
                      {t('pause.minutes', { count: option })}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button
              loading={saving}
              onClick={() =>
                void run('busy', { extraMinutes: extra, minutes: busyMinutes }).then((ok) => {
                  if (ok) setBusyOpen(false);
                })
              }
            >
              {t('busy.confirm')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </Box>
  );
};
