import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  IconButton,
  Loader,
  NumberInput,
  Switch,
  Tabs,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Plus, Trash } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { fieldErrors, useErrorToast } from '../../lib/api';
import { useT, type Translate } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import type { InboxSettings } from '../../lib/types';
import EmailTemplatesBlock from './EmailTemplates';
import NotificationChannelsBlock from './NotificationChannels';

type AlertRule = {
  enabled: boolean;
  threshold: number;
  criticalThreshold?: number;
  aggregationMinutes: number;
  recipients: string[];
};

type AlertRules = Record<string, AlertRule>;

/** The fixed codes (mirrors server `domain/alert-codes.ts` — Admin never imports server). */
const ALERT_CODES = [
  'webhook-failing',
  'webhook-endpoint-disabled',
  'payment-unmatched',
  'outbox-stuck',
  'job-heartbeat-missed',
  'order-awaiting-acceptance',
  'reconciliation-mismatch',
  'manual-payment-unconfirmed',
  'cash-closing-mismatch',
  'audit-tampered',
  'notification-template-broken',
  'low-rating',
  'gift-card-probing',
] as const;

const RECIPIENT_CHOICES = ['branch-email', 'ops.read', 'report.read', 'payment.review', 'order.read'];

const numberOrUndefined = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Alert-rule editor block (O6, screens "Cảnh báo" in Settings): saved on its own button. */
const AlertRulesBlock = ({ t }: { t: Translate }) => {
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [rules, setRules] = useState<AlertRules | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [alertErrors, setAlertErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/settings/alert-rules');
      setRules((data as { rules: AlertRules }).rules);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (code: string, patch: Partial<AlertRule>) => {
    if (!rules) return;
    setRules({ ...rules, [code]: { ...rules[code], ...patch } });
  };

  const toggleRecipient = (code: string, recipient: string, checked: boolean) => {
    if (!rules) return;
    const current = rules[code].recipients;
    update(code, {
      recipients: checked ? [...current, recipient] : current.filter((item) => item !== recipient),
    });
  };

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    setAlertErrors({});
    try {
      const { data } = await put('/ordering/settings/alert-rules', { rules });
      setRules((data as { rules: AlertRules }).rules);
      toggleNotification({ type: 'success', message: t('settings.alerts.saved') });
    } catch (error) {
      setAlertErrors(fieldErrors(error));
      toastError(error);
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return (
      <Flex justifyContent="center" padding={6}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (state === 'error' || !rules) {
    return (
      <Alert
        variant="danger"
        closeLabel={t('common.close')}
        title={t('common.error.title')}
        action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
      >
        {t('settings.alerts.loadFailed')}
      </Alert>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta" tag="h2">
          {t('settings.alerts')}
        </Typography>
        <Button size="S" loading={saving} onClick={() => void save()}>
          {t('settings.alerts.save')}
        </Button>
      </Flex>
      <Table colCount={6} rowCount={ALERT_CODES.length + 1}>
        <Thead>
          <Tr>
            <Th><Typography variant="sigma">{t('settings.alerts.col.rule')}</Typography></Th>
            <Th><Typography variant="sigma">{t('settings.alerts.col.enabled')}</Typography></Th>
            <Th><Typography variant="sigma">{t('settings.alerts.col.threshold')}</Typography></Th>
            <Th><Typography variant="sigma">{t('settings.alerts.col.critical')}</Typography></Th>
            <Th><Typography variant="sigma">{t('settings.alerts.col.window')}</Typography></Th>
            <Th><Typography variant="sigma">{t('settings.alerts.col.recipients')}</Typography></Th>
          </Tr>
        </Thead>
        <Tbody>
          {ALERT_CODES.map((code) => {
            const rule = rules[code];
            if (!rule) return null;
            return (
              <Tr key={code}>
                <Td>
                  <Typography variant="pi">{t(`alert.code.${code}`, undefined, code)}</Typography>
                </Td>
                <Td>
                  <Switch checked={rule.enabled} onCheckedChange={(value: boolean) => update(code, { enabled: value })} />
                </Td>
                <Td>
                  <Box width="120px">
                    <Field.Root
                      error={alertErrors[`${code}.threshold`]}
                      hint={code === 'low-rating' ? t('settings.alerts.lowRatingHint') : undefined}
                    >
                      <NumberInput
                        name={`${code}-threshold`}
                        min={1}
                        value={rule.threshold}
                        onValueChange={(next?: number) =>
                          update(code, { threshold: numberOrUndefined(next) ?? rule.threshold })
                        }
                      />
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                </Td>
                <Td>
                  <Box width="120px">
                    <Field.Root error={alertErrors[`${code}.criticalThreshold`]} hint={t('settings.alerts.col.critical.none')}>
                      <NumberInput
                        name={`${code}-critical`}
                        min={1}
                        value={rule.criticalThreshold}
                        onValueChange={(next?: number) =>
                          update(code, { criticalThreshold: numberOrUndefined(next) })
                        }
                      />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                </Td>
                <Td>
                  <Box width="120px">
                    <Field.Root error={alertErrors[`${code}.aggregationMinutes`]}>
                      <NumberInput
                        name={`${code}-window`}
                        min={1}
                        max={1440}
                        value={rule.aggregationMinutes}
                        onValueChange={(next?: number) =>
                          update(code, { aggregationMinutes: numberOrUndefined(next) ?? rule.aggregationMinutes })
                        }
                      />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                </Td>
                <Td>
                  <Flex direction="column" gap={1}>
                    <Field.Root error={alertErrors[`${code}.recipients`]}>
                      <Flex direction="column" gap={1}>
                        {RECIPIENT_CHOICES.map((recipient) => (
                          <Checkbox
                            key={recipient}
                            checked={rule.recipients.includes(recipient)}
                            onCheckedChange={(checked: boolean) => toggleRecipient(code, recipient, checked)}
                          >
                            {t(`alert.recipient.${recipient}`)}
                          </Checkbox>
                        ))}
                      </Flex>
                      <Field.Error />
                    </Field.Root>
                  </Flex>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
      <Typography variant="pi" textColor="neutral600">
        {t('settings.alerts.hint')}
      </Typography>
    </Flex>
  );
};

/** Settings → "Bán hàng" (screens S9): inbox dialog, sound default, reject reasons, delays. */
const SettingsPage = () => {
  const t = useT();
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [delayText, setDelayText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/settings');
      const value = (data as { settings: InboxSettings }).settings;
      setSettings(value);
      setDelayText(value.delayMinutes.join(', '));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setErrors({});
    const delayMinutes = delayText
      .split(',')
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isFinite(item));
    try {
      const { data } = await put('/ordering/settings', { ...settings, delayMinutes });
      setSettings((data as { settings: InboxSettings }).settings);
      toggleNotification({ type: 'success', message: t('settings.saved') });
    } catch (error) {
      setErrors(fieldErrors(error));
      toastError(error);
    } finally {
      setSaving(false);
    }
  };

  const tags = settings?.ratingTags ?? [];
  const setTags = (next: InboxSettings['ratingTags']) => settings && setSettings({ ...settings, ratingTags: next });
  const moveTag = (index: number, delta: number) => {
    const next = [...tags];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setTags(next);
  };
  const reasons = settings?.rejectReasons ?? [];
  const setReasons = (next: InboxSettings['rejectReasons']) => settings && setSettings({ ...settings, rejectReasons: next });
  const move = (index: number, delta: number) => {
    const next = [...reasons];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setReasons(next);
  };

  return (
    <Page.Protect permissions={PERMISSIONS.settings}>
      <Page.Title>{t('settings.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('settings.title')}
          subtitle={t('settings.subtitle')}
          primaryAction={
            <Button loading={saving} disabled={!settings} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          }
        />
        <Layouts.Content>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' || !settings ? (
            <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')} action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}>
              {t('settings.loadFailed')}
            </Alert>
          ) : (
            <Tabs.Root defaultValue="general">
              <Tabs.List aria-label={t('settings.title')}>
                <Tabs.Trigger value="general">{t('settings.tab.general')}</Tabs.Trigger>
                <Tabs.Trigger value="templates">{t('settings.tab.templates')}</Tabs.Trigger>
                <Tabs.Trigger value="channels">{t('settings.tab.channels')}</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="general">
            <Flex direction="column" alignItems="stretch" gap={5} paddingTop={4}>
              <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
                <Flex direction="column" alignItems="stretch" gap={5}>
                <Flex gap={2}>
                  <Switch checked={settings.newOrderDialog} onCheckedChange={(value: boolean) => setSettings({ ...settings, newOrderDialog: value })} />
                  <Typography>{t('settings.dialog')}</Typography>
                </Flex>
                <Flex gap={2}>
                  <Switch checked={settings.soundByDefault} onCheckedChange={(value: boolean) => setSettings({ ...settings, soundByDefault: value })} />
                  <Typography>{t('settings.sound')}</Typography>
                </Flex>
                <Box>
                  <Typography variant="delta" tag="h2">
                    {t('settings.reasons')}
                  </Typography>
                  {errors.rejectReasons ? <Typography textColor="danger600">{errors.rejectReasons}</Typography> : null}
                  {reasons.map((reason, index) => (
                    <Flex key={index} gap={2} paddingTop={2} alignItems="flex-end">
                      <Field.Root error={errors[`rejectReasons.${index}.code`]}>
                        <Field.Label>{t('settings.reason.code')}</Field.Label>
                        <TextInput value={reason.code} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReasons(reasons.map((item, i) => (i === index ? { ...item, code: event.target.value } : item)))} />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>VI</Field.Label>
                        <TextInput value={reason.label.vi ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReasons(reasons.map((item, i) => (i === index ? { ...item, label: { ...item.label, vi: event.target.value } } : item)))} />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>EN</Field.Label>
                        <TextInput value={reason.label.en ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReasons(reasons.map((item, i) => (i === index ? { ...item, label: { ...item.label, en: event.target.value } } : item)))} />
                      </Field.Root>
                      <IconButton label={t('settings.up')} variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp />
                      </IconButton>
                      <IconButton label={t('settings.down')} variant="ghost" disabled={index === reasons.length - 1} onClick={() => move(index, 1)}>
                        <ArrowDown />
                      </IconButton>
                      <IconButton label={t('create.remove')} variant="ghost" onClick={() => setReasons(reasons.filter((_, i) => i !== index))}>
                        <Trash />
                      </IconButton>
                    </Flex>
                  ))}
                  <Box paddingTop={2}>
                    <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => setReasons([...reasons, { code: '', label: { vi: '', en: '' } }])}>
                      {t('settings.addReason')}
                    </Button>
                  </Box>
                </Box>
                <Field.Root error={errors.delayMinutes} hint={t('settings.delaysHint')}>
                  <Field.Label>{t('settings.delays')}</Field.Label>
                  <TextInput value={delayText} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDelayText(event.target.value)} />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                </Flex>
              </Box>
              <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <Typography variant="delta" tag="h2">
                    {t('settings.rating')}
                  </Typography>
                  <Flex gap={2}>
                    <Switch
                      checked={settings.ratingInviteEnabled}
                      onCheckedChange={(value: boolean) => setSettings({ ...settings, ratingInviteEnabled: value })}
                    />
                    <Typography>{t('settings.rating.invite')}</Typography>
                  </Flex>
                  <Flex gap={4} wrap="wrap">
                    {(
                      [
                        ['ratingInviteDelayMinutes', 'settings.rating.delay'],
                        ['ratingWindowDays', 'settings.rating.window'],
                        ['ratingEditHours', 'settings.rating.editHours'],
                      ] as const
                    ).map(([key, label]) => (
                      <Box key={key} width="200px">
                        <Field.Root error={errors[key]}>
                          <Field.Label>{t(label)}</Field.Label>
                          <NumberInput
                            value={settings[key]}
                            onValueChange={(next?: number) =>
                              setSettings({ ...settings, [key]: numberOrUndefined(next) ?? settings[key] })
                            }
                          />
                          <Field.Error />
                        </Field.Root>
                      </Box>
                    ))}
                  </Flex>
                  <Box>
                    <Typography variant="sigma">{t('settings.rating.tags')}</Typography>
                    {errors.ratingTags ? <Typography textColor="danger600">{errors.ratingTags}</Typography> : null}
                    {tags.map((tag, index) => (
                      <Flex key={index} gap={2} paddingTop={2} alignItems="flex-end">
                        <Field.Root error={errors[`ratingTags.${index}.code`]}>
                          <Field.Label>{t('settings.reason.code')}</Field.Label>
                          <TextInput value={tag.code} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTags(tags.map((item, i) => (i === index ? { ...item, code: event.target.value } : item)))} />
                        </Field.Root>
                        <Field.Root>
                          <Field.Label>VI</Field.Label>
                          <TextInput value={tag.label.vi ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTags(tags.map((item, i) => (i === index ? { ...item, label: { ...item.label, vi: event.target.value } } : item)))} />
                        </Field.Root>
                        <Field.Root>
                          <Field.Label>EN</Field.Label>
                          <TextInput value={tag.label.en ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTags(tags.map((item, i) => (i === index ? { ...item, label: { ...item.label, en: event.target.value } } : item)))} />
                        </Field.Root>
                        <Button
                          variant={tag.sentiment === 'positive' ? 'success-light' : 'danger-light'}
                          onClick={() => setTags(tags.map((item, i) => (i === index ? { ...item, sentiment: item.sentiment === 'positive' ? 'negative' : 'positive' } : item)))}
                        >
                          {t(`settings.rating.sentiment.${tag.sentiment}`)}
                        </Button>
                        <IconButton label={t('settings.up')} variant="ghost" disabled={index === 0} onClick={() => moveTag(index, -1)}>
                          <ArrowUp />
                        </IconButton>
                        <IconButton label={t('settings.down')} variant="ghost" disabled={index === tags.length - 1} onClick={() => moveTag(index, 1)}>
                          <ArrowDown />
                        </IconButton>
                        <IconButton label={t('create.remove')} variant="ghost" onClick={() => setTags(tags.filter((_, i) => i !== index))}>
                          <Trash />
                        </IconButton>
                      </Flex>
                    ))}
                    <Box paddingTop={2}>
                      <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => setTags([...tags, { code: '', label: { vi: '', en: '' }, sentiment: 'positive' }])}>
                        {t('settings.rating.addTag')}
                      </Button>
                    </Box>
                  </Box>
                </Flex>
              </Box>
              <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
                <AlertRulesBlock t={t} />
              </Box>
            </Flex>
              </Tabs.Content>
              <Tabs.Content value="templates">
                <Box paddingTop={4}>
                  <EmailTemplatesBlock t={t} />
                </Box>
              </Tabs.Content>
              <Tabs.Content value="channels">
                <Box paddingTop={4}>
                  <NotificationChannelsBlock t={t} />
                </Box>
              </Tabs.Content>
            </Tabs.Root>
          )}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default SettingsPage;
