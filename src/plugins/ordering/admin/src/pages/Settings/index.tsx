import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Plus, Trash } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { fieldErrors, useErrorToast } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import type { InboxSettings } from '../../lib/types';

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
          )}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default SettingsPage;
