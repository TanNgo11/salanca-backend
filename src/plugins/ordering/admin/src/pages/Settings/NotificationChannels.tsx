import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Mail, Trash } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import { useErrorToast } from '../../lib/api';
import type { Translate } from '../../lib/i18n';

type Channel = 'zalo' | 'sms' | 'email';

type ZnsRule = { templateId: string; params: Record<string, string> };

type RuleRow = {
  template: string;
  label: string;
  customized: boolean;
  valid: boolean;
  active: boolean;
  channels: Channel[];
  zns: ZnsRule | null;
};

type Overview = {
  providers: Record<Channel, boolean>;
  dailyLimit: number;
  costEstimates: Record<string, number>;
  sentToday: number;
  rules: RuleRow[];
};

const CHANNELS: Channel[] = ['zalo', 'sms', 'email'];

/** `params` ↔ one `znsParam=pluginVar` per line in the textarea. */
const paramsToText = (params: Record<string, string> | null): string =>
  Object.entries(params ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

const textToParams = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

/** P3 "Kênh thông báo" — ordered fallback chain + ZNS mapping per template, test-send, daily cap. */
const NotificationChannelsBlock = ({ t }: { t: Translate }) => {
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    channels: Channel[];
    templateId: string;
    paramsText: string;
    active: boolean;
  } | null>(null);
  const [testDraft, setTestDraft] = useState<{ channel: Channel; target: string }>({
    channel: 'zalo',
    target: '',
  });
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle');

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/notification-channels');
      setOverview(data as Overview);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (row: RuleRow) => {
    setSelected(row.template);
    setDraft({
      channels: [...row.channels],
      templateId: row.zns?.templateId ?? '',
      paramsText: paramsToText(row.zns?.params ?? null),
      active: row.active,
    });
    setTestDraft({ channel: row.channels[0] ?? 'email', target: '' });
  };

  const move = (index: number, dir: -1 | 1) => {
    if (!draft) return;
    const channels = [...draft.channels];
    const swap = index + dir;
    if (swap < 0 || swap >= channels.length) return;
    [channels[index], channels[swap]] = [channels[swap], channels[index]];
    setDraft({ ...draft, channels });
  };

  const save = async () => {
    if (!selected || !draft || busy !== 'idle') return;
    setBusy('saving');
    try {
      await put(`/ordering/notification-channels/${selected}`, {
        channels: draft.channels,
        active: draft.active,
        zns: draft.channels.includes('zalo')
          ? { templateId: draft.templateId.trim(), params: textToParams(draft.paramsText) }
          : null,
      });
      toggleNotification({ type: 'success', message: t('p3.saved') });
      setSelected(null);
      setDraft(null);
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  const sendTest = async () => {
    if (!selected || busy !== 'idle' || !testDraft.target.trim()) return;
    setBusy('testing');
    try {
      const result = await post('/ordering/notification-channels/test', {
        template: selected,
        channel: testDraft.channel,
        target: testDraft.target.trim(),
      });
      const id = (result.data as { providerMessageId?: string | null }).providerMessageId;
      toggleNotification({
        type: 'success',
        message: t('p3.test.sent', { id: id ?? '—' }),
      });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  const channelChip = (channel: Channel, costEstimates?: Record<string, number>) => (
    <Badge key={channel}>
      {t(`p3.channel.${channel}`)}
      {channel !== 'email' && costEstimates?.[channel] !== undefined
        ? ` ~${costEstimates[channel]}₫`
        : ''}
    </Badge>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Box>
        <Typography variant="delta" tag="h2">
          {t('p3.title')}
        </Typography>
        <Box paddingTop={1}>
          <Typography variant="pi" textColor="neutral600">
            {t('p3.subtitle')}
          </Typography>
        </Box>
      </Box>
      {state === 'loading' ? (
        <Flex justifyContent="center" padding={6}>
          <Loader>{t('common.loading')}</Loader>
        </Flex>
      ) : state === 'error' || !overview ? (
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={t('common.error.title')}
          action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
        >
          {t('p3.loadFailed')}
        </Alert>
      ) : (
        <>
          <Flex gap={3} alignItems="center" wrap="wrap">
            {CHANNELS.map((channel) => (
              <Badge
                key={channel}
                {...(overview.providers[channel]
                  ? { textColor: 'success700', backgroundColor: 'success100' }
                  : {})}
              >
                {t(`p3.channel.${channel}`)}:{' '}
                {overview.providers[channel]
                  ? t('p3.provider.configured')
                  : t('p3.provider.notConfigured')}
              </Badge>
            ))}
            <Badge>
              {t('p3.limit.badge', { sent: overview.sentToday, limit: overview.dailyLimit })}
            </Badge>
          </Flex>
          {overview.sentToday >= overview.dailyLimit ? (
            <Alert variant="warning" closeLabel={t('common.close')} title={t('p3.limit.title')}>
              {t('p3.limit.body', { sent: overview.sentToday, limit: overview.dailyLimit })}
            </Alert>
          ) : null}
          <Table colCount={5} rowCount={overview.rules.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">{t('p3.col.template')}</Typography></Th>
                <Th><Typography variant="sigma">{t('p3.col.chain')}</Typography></Th>
                <Th><Typography variant="sigma">{t('p3.col.zns')}</Typography></Th>
                <Th><Typography variant="sigma">{t('p3.col.active')}</Typography></Th>
                <Th><Typography variant="sigma">{t('p3.col.action')}</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {overview.rules.map((row) => (
                <Tr key={row.template}>
                  <Td><Typography variant="pi">{row.label}</Typography></Td>
                  <Td>
                    <Flex gap={1} wrap="wrap">
                      {row.channels.map((channel) => channelChip(channel, overview.costEstimates))}
                    </Flex>
                  </Td>
                  <Td>
                    <Typography variant="pi" textColor={row.zns ? undefined : 'neutral500'}>
                      {row.zns?.templateId ?? '—'}
                    </Typography>
                  </Td>
                  <Td>
                    <Badge {...(row.active ? {} : { textColor: 'neutral600', backgroundColor: 'neutral150' })}>
                      {row.active ? t('p3.active') : t('p3.inactive')}
                    </Badge>
                  </Td>
                  <Td>
                    <Button size="S" variant="tertiary" onClick={() => open(row)}>
                      {t('p3.edit')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </>
      )}

      {selected && draft ? (
        <>
          <Divider />
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Typography variant="delta" tag="h3">
              {t('p3.editing', { name: selected })}
            </Typography>
            <Field.Root name="channels">
              <Field.Label>{t('p3.edit.chain')}</Field.Label>
              <Flex direction="column" alignItems="stretch" gap={2}>
                {draft.channels.map((channel, index) => (
                  <Flex key={channel} gap={2} alignItems="center">
                    {channelChip(channel)}
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="up"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={index === draft.channels.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="down"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      size="S"
                      variant="danger-light"
                      disabled={draft.channels.length <= 1}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          channels: draft.channels.filter((_, i) => i !== index),
                        })
                      }
                      aria-label="remove"
                    >
                      <Trash />
                    </Button>
                  </Flex>
                ))}
                {draft.channels.length < CHANNELS.length ? (
                  <SingleSelect
                    aria-label={t('p3.edit.addChannel')}
                    placeholder={t('p3.edit.addChannel')}
                    value=""
                    onChange={(value: string | number) =>
                      value &&
                      setDraft({
                        ...draft,
                        channels: [...draft.channels, value as Channel],
                      })
                    }
                  >
                    {CHANNELS.filter((channel) => !draft.channels.includes(channel)).map(
                      (channel) => (
                        <SingleSelectOption key={channel} value={channel}>
                          {t(`p3.channel.${channel}`)}
                        </SingleSelectOption>
                      ),
                    )}
                  </SingleSelect>
                ) : null}
              </Flex>
            </Field.Root>
            {draft.channels.includes('zalo') ? (
              <Flex gap={4} alignItems="flex-start">
                <Field.Root name="znsTemplateId" required>
                  <Field.Label>{t('p3.edit.znsTemplate')}</Field.Label>
                  <TextInput
                    value={draft.templateId}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setDraft({ ...draft, templateId: event.target.value })
                    }
                  />
                </Field.Root>
                <Field.Root name="znsParams" hint={t('p3.edit.paramsHint')} grow={1}>
                  <Field.Label>{t('p3.edit.znsParams')}</Field.Label>
                  <Textarea
                    value={draft.paramsText}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setDraft({ ...draft, paramsText: event.target.value })
                    }
                    style={{ fontFamily: 'monospace', minHeight: '6rem' }}
                  />
                  <Field.Hint />
                </Field.Root>
              </Flex>
            ) : null}
            <Checkbox
              checked={draft.active}
              onCheckedChange={(checked: boolean) => setDraft({ ...draft, active: checked })}
            >
              {t('p3.edit.active')}
            </Checkbox>
            <Flex gap={2} alignItems="flex-end" wrap="wrap">
              <Button loading={busy === 'saving'} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              <Field.Root name="testTarget">
                <Field.Label>{t('p3.test.target')}</Field.Label>
                <Flex gap={2} alignItems="center">
                  <Box width="220px">
                    <TextInput
                      value={testDraft.target}
                      placeholder={t('p3.test.targetHint')}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setTestDraft({ ...testDraft, target: event.target.value })
                      }
                    />
                  </Box>
                  <SingleSelect
                    aria-label={t('p3.test.channel')}
                    value={testDraft.channel}
                    onChange={(value: string | number) =>
                      setTestDraft({ ...testDraft, channel: value as Channel })
                    }
                  >
                    {draft.channels.map((channel) => (
                      <SingleSelectOption key={channel} value={channel}>
                        {t(`p3.channel.${channel}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Button
                    variant="secondary"
                    startIcon={<Mail />}
                    loading={busy === 'testing'}
                    disabled={!testDraft.target.trim()}
                    onClick={() => void sendTest()}
                  >
                    {t('p3.test.send')}
                  </Button>
                </Flex>
              </Field.Root>
            </Flex>
          </Flex>
        </>
      ) : null}
    </Flex>
  );
};

export default NotificationChannelsBlock;
