import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Modal,
  NumberInput,
  Switch,
  Table,
  Tabs,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { fieldErrors, useErrorToast } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type Channel = 'pickup' | 'delivery' | 'dine-in';
const CHANNELS: Channel[] = ['pickup', 'delivery', 'dine-in'];

type Settings = {
  enabled: boolean;
  startsAt: string | null;
  earnPerAmount: number;
  pointValue: number;
  minRedeemPoints: number;
  maxRedeemShare: number;
  expiryMonths: number;
  expiryReminderDays: number;
  downgradeGraceDays: number;
  dailyEarnCap: number;
  channels: Channel[];
  countHistoryForTiers: boolean;
};

type Tier = {
  id: number;
  code: string;
  name: { vi?: string; en?: string };
  minSpend12m: number;
  multiplier: number;
  customerGroupCode: string | null;
  active: boolean;
  customerCount: number;
};

type TierForm = {
  id: number | null;
  code: string;
  nameVi: string;
  nameEn: string;
  minSpend12m: number;
  multiplier: number;
  customerGroupCode: string;
  active: boolean;
};

const EMPTY_TIER: TierForm = {
  id: null,
  code: '',
  nameVi: '',
  nameEn: '',
  minSpend12m: 0,
  multiplier: 100,
  customerGroupCode: '',
  active: true,
};

const numberField = (value: number | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Y1: program settings, with the worked example the owner reads before opening it. */
const ProgramTab = ({ settings, onChange, onSaved }: { settings: Settings; onChange: (next: Settings) => void; onSaved: (next: Settings) => void }) => {
  const t = useT();
  const { put, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toast = useErrorToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recalculating, setRecalculating] = useState(false);

  const example = useMemo(() => {
    const amount = 300000;
    const points = Math.floor(amount / Math.max(1, settings.earnPerAmount));
    return t('loyalty.example', {
      amount: formatMoney(amount),
      points,
      value: formatMoney(points * settings.pointValue),
    });
  }, [settings.earnPerAmount, settings.pointValue, t]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });

  const save = async () => {
    setSaving(true);
    setErrors({});
    const { startsAt: _startsAt, ...body } = settings;
    try {
      const { data } = await put('/ordering/loyalty/settings', body);
      onSaved((data as { settings: Settings }).settings);
      toggleNotification({ type: 'success', message: t('loyalty.saved') });
    } catch (error) {
      setErrors(fieldErrors(error, t));
      toast(error);
    } finally {
      setSaving(false);
    }
  };

  const recalculate = async () => {
    setRecalculating(true);
    try {
      const { data } = await post('/ordering/loyalty/tiers/recalculate', {});
      const result = data as { orders: number; customers: number };
      toggleNotification({ type: 'success', message: t('loyalty.recalc.done', result) });
    } catch (error) {
      toast(error);
    } finally {
      setRecalculating(false);
    }
  };

  const numeric = (key: keyof Settings, label: string, props: { min: number; max?: number; scale?: number }) => {
    const scale = props.scale ?? 1;
    return (
      <Field.Root error={errors[String(key)]}>
        <Field.Label>{label}</Field.Label>
        <NumberInput
          value={Math.round(numberField(settings[key] as number, 0) * scale)}
          min={props.min}
          max={props.max}
          onValueChange={(value?: number) => set(key, ((value ?? props.min) / scale) as never)}
        />
        <Field.Error />
      </Field.Root>
    );
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={5} paddingTop={4}>
      {!settings.enabled ? (
        <Alert closeLabel={t('common.close')} title={t('loyalty.off.title')} variant="warning">
          {t('loyalty.off.body')}
        </Alert>
      ) : null}
      <Alert closeLabel={t('common.close')} title={t('loyalty.title')} variant="default">
        {t('loyalty.legal')}
      </Alert>
      <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
        <Flex direction="column" alignItems="stretch" gap={5}>
          <Flex gap={2}>
            <Switch checked={settings.enabled} onCheckedChange={(value: boolean) => set('enabled', value)} />
            <Typography>{t('loyalty.field.enabled')}</Typography>
          </Flex>
          {settings.startsAt ? (
            <Typography variant="pi" textColor="neutral600">
              {t('loyalty.startsAt', { at: new Date(settings.startsAt).toLocaleDateString('vi-VN') })}
            </Typography>
          ) : null}
          <Flex gap={4} wrap="wrap" alignItems="flex-start">
            {numeric('earnPerAmount', t('loyalty.field.earnPerAmount'), { min: 1 })}
            {numeric('pointValue', t('loyalty.field.pointValue'), { min: 1 })}
            {numeric('minRedeemPoints', t('loyalty.field.minRedeemPoints'), { min: 1 })}
            {numeric('maxRedeemShare', t('loyalty.field.maxRedeemShare'), { min: 1, max: 100, scale: 100 })}
            {numeric('expiryMonths', t('loyalty.field.expiryMonths'), { min: 1, max: 60 })}
            {numeric('expiryReminderDays', t('loyalty.field.expiryReminderDays'), { min: 0, max: 90 })}
            {numeric('downgradeGraceDays', t('loyalty.field.downgradeGraceDays'), { min: 0, max: 365 })}
            {numeric('dailyEarnCap', t('loyalty.field.dailyEarnCap'), { min: 1 })}
          </Flex>
          <Box>
            <Typography variant="delta">{t('loyalty.field.channels')}</Typography>
            <Flex gap={4} paddingTop={2}>
              {CHANNELS.map((channel) => (
                <Checkbox
                  key={channel}
                  checked={settings.channels.includes(channel)}
                  onCheckedChange={(checked: boolean) =>
                    set('channels', checked === true ? [...settings.channels, channel] : settings.channels.filter((item) => item !== channel))
                  }
                >
                  {t(`loyalty.channel.${channel}`)}
                </Checkbox>
              ))}
            </Flex>
          </Box>
          <Checkbox checked={settings.countHistoryForTiers} onCheckedChange={(checked: boolean) => set('countHistoryForTiers', checked === true)}>
            {t('loyalty.field.countHistory')}
          </Checkbox>
          <Typography variant="pi" textColor="neutral600">
            {example}
          </Typography>
          <Flex gap={3} wrap="wrap">
            <Button loading={saving} onClick={() => void save()}>
              {t('loyalty.save')}
            </Button>
            <Button variant="secondary" loading={recalculating} onClick={() => void recalculate()}>
              {t('loyalty.recalc')}
            </Button>
          </Flex>
          <Typography variant="pi" textColor="neutral500">
            {t('loyalty.recalc.hint')}
          </Typography>
        </Flex>
      </Box>
    </Flex>
  );
};

/** Y2: tiers table with an edit panel (no dropdowns inside the modal). */
const TiersTab = ({ settings }: { settings: Settings }) => {
  const t = useT();
  const locale = useLocale();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toast = useErrorToast();
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState<TierForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/loyalty/tiers');
      setTiers((data as { items: Tier[] }).items);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      setTiers([]);
      toast(error);
    }
  }, [get, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (tier: Tier) =>
    setForm({
      id: tier.id,
      code: tier.code,
      nameVi: tier.name.vi ?? '',
      nameEn: tier.name.en ?? '',
      minSpend12m: tier.minSpend12m,
      multiplier: tier.multiplier,
      customerGroupCode: tier.customerGroupCode ?? '',
      active: tier.active,
    });

  const save = async () => {
    if (!form) return;
    setErrors({});
    const body = {
      code: form.code,
      name: { vi: form.nameVi, ...(form.nameEn ? { en: form.nameEn } : {}) },
      minSpend12m: form.minSpend12m,
      multiplier: form.multiplier,
      customerGroupCode: form.customerGroupCode.trim() === '' ? null : form.customerGroupCode.trim(),
      active: form.active,
    };
    try {
      if (form.id === null) await post('/ordering/loyalty/tiers', body);
      else await put(`/ordering/loyalty/tiers/${form.id}`, body);
      toggleNotification({ type: 'success', message: t('loyalty.tier.saved') });
      setForm(null);
      await load();
    } catch (error) {
      setErrors(fieldErrors(error, t));
      toast(error);
    }
  };

  const set = <K extends keyof TierForm>(key: K, value: TierForm[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Flex direction="column" alignItems="stretch" gap={4} paddingTop={4}>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="pi" textColor="neutral600">
          {t('loyalty.tiers.note', { days: settings.downgradeGraceDays })}
        </Typography>
        <Button startIcon={<Plus />} onClick={() => setForm({ ...EMPTY_TIER })}>
          {t('loyalty.tiers.new')}
        </Button>
      </Flex>
      {tiers === null ? (
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('common.loading')}</Loader>
        </Flex>
      ) : failed ? (
        <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
          {t('loyalty.loadFailed')}
        </Alert>
      ) : tiers.length === 0 ? (
        <EmptyStateLayout content={t('loyalty.tiers.empty')} />
      ) : (
        <Table colCount={6} rowCount={tiers.length + 1}>
          <Thead>
            <Tr>
              {['name', 'spend', 'multiplier', 'group', 'customers', 'active'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`loyalty.tiers.col.${column}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {tiers.map((tier) => (
              <Tr key={tier.id} onClick={() => edit(tier)} style={{ cursor: 'pointer' }}>
                <Td>
                  <Typography fontWeight="semiBold">{(locale === 'en' && tier.name.en) || tier.name.vi || tier.code}</Typography>
                </Td>
                <Td>
                  <Typography>{formatMoney(tier.minSpend12m)}</Typography>
                </Td>
                <Td>
                  <Typography>×{(tier.multiplier / 100).toLocaleString('vi-VN')}</Typography>
                </Td>
                <Td>
                  <Typography>{tier.customerGroupCode ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{tier.customerCount}</Typography>
                </Td>
                <Td>
                  <Badge>{tier.active ? t('loyalty.tier.active') : '—'}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <Modal.Root open={form !== null} onOpenChange={(next: boolean) => (!next ? setForm(null) : undefined)}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{form?.id === null ? t('loyalty.tier.new') : t('loyalty.tier.edit')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {form ? (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Field.Root required error={errors.code} hint={t('loyalty.tier.codeHint')}>
                  <Field.Label>{t('loyalty.tier.code')}</Field.Label>
                  <TextInput value={form.code} disabled={form.id !== null} onChange={(event: { target: { value: string } }) => set('code', event.target.value)} />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                <Field.Root required error={errors['name.vi']}>
                  <Field.Label>{t('loyalty.tier.nameVi')}</Field.Label>
                  <TextInput value={form.nameVi} onChange={(event: { target: { value: string } }) => set('nameVi', event.target.value)} />
                  <Field.Error />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t('loyalty.tier.nameEn')}</Field.Label>
                  <TextInput value={form.nameEn} onChange={(event: { target: { value: string } }) => set('nameEn', event.target.value)} />
                </Field.Root>
                <Field.Root error={errors.minSpend12m}>
                  <Field.Label>{t('loyalty.tier.minSpend')}</Field.Label>
                  <NumberInput value={form.minSpend12m} min={0} onValueChange={(value?: number) => set('minSpend12m', value ?? 0)} />
                  <Field.Error />
                </Field.Root>
                <Field.Root error={errors.multiplier}>
                  <Field.Label>{t('loyalty.tier.multiplier')}</Field.Label>
                  <NumberInput value={form.multiplier} min={10} max={1000} onValueChange={(value?: number) => set('multiplier', value ?? 100)} />
                  <Field.Error />
                </Field.Root>
                <Field.Root error={errors.customerGroupCode} hint={t('loyalty.tier.groupHint')}>
                  <Field.Label>{t('loyalty.tier.group')}</Field.Label>
                  <TextInput value={form.customerGroupCode} onChange={(event: { target: { value: string } }) => set('customerGroupCode', event.target.value)} />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                <Checkbox checked={form.active} onCheckedChange={(checked: boolean) => set('active', checked === true)}>
                  {t('loyalty.tier.active')}
                </Checkbox>
                {errors.active ? <Typography textColor="danger600">{errors.active}</Typography> : null}
              </Flex>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('loyalty.tier.cancel')}</Button>
            </Modal.Close>
            <Button onClick={() => void save()}>{t('loyalty.save')}</Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </Flex>
  );
};

const LoyaltyPage = () => {
  const t = useT();
  const { get } = useFetchClient();
  const toast = useErrorToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void get('/ordering/loyalty/settings')
      .then(({ data }) => {
        if (!live) return;
        const next = (data as { settings: Settings }).settings;
        setSettings(next);
        setSaved(next);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setFailed(true);
        toast(error);
      });
    return () => {
      live = false;
    };
  }, [get, toast]);

  const dirty = settings !== null && saved !== null && JSON.stringify(settings) !== JSON.stringify(saved);

  return (
    <Page.Protect permissions={PERMISSIONS.loyaltyManage}>
      <Page.Title>{t('loyalty.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header title={t('loyalty.title')} subtitle={dirty ? t('loyalty.unsaved') : undefined} />
        <Layouts.Content>
          {failed ? (
            <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
              {t('loyalty.loadFailed')}
            </Alert>
          ) : settings === null ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : (
            <Tabs.Root defaultValue="program">
              <Tabs.List>
                <Tabs.Trigger value="program">{t('loyalty.tab.program')}</Tabs.Trigger>
                <Tabs.Trigger value="tiers">{t('loyalty.tab.tiers')}</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="program">
                <ProgramTab
                  settings={settings}
                  onChange={setSettings}
                  onSaved={(next) => {
                    setSettings(next);
                    setSaved(next);
                  }}
                />
              </Tabs.Content>
              <Tabs.Content value="tiers">
                <TiersTab settings={saved ?? settings} />
              </Tabs.Content>
            </Tabs.Root>
          )}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default LoyaltyPage;
