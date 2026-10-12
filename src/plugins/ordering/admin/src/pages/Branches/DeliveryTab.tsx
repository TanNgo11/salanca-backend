import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

import { useErrorToast } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { foldDiacritics } from '../../../../shared/text/fold';

type Range = { start: string; end: string };
type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type Schedule = {
  leadTimeMinutes: number;
  slotLengthMinutes: number;
  capacity: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  businessDayPolicy: { cutoffLocalTime: string; holidayDates: string[] };
  openingHours: { mode: '24_7' | 'daily' | 'weekly'; daily: Range[]; weekly: Record<Day, Range[]> };
};

export type FeeRule = {
  when: 'any' | 'subtotal-gte' | 'subtotal-lt';
  subtotal?: number;
  fee: number | 'unavailable';
};

export type DeliveryZone = {
  code: string;
  label: string;
  priority: number;
  match: { kind: 'commune'; communeCodes: string[] };
  rules: FeeRule[];
  minOrderAmount: number;
  extraLeadTimeMinutes: number;
};

export type Delivery = {
  enabled: boolean;
  orderTiming: 'asap' | 'scheduled' | 'both';
  paymentTiming: 'prepay' | 'accept-then-pay' | 'pay-on-pickup';
  paymentProviders: string[];
  paymentTimeoutMinutes: number;
  minOrderAmount: number;
  customerCancelBeforeMinutes: number;
  slaMinutes: number;
  schedule: Schedule;
  zones: DeliveryZone[];
};

type CashRounding = { enabled: boolean; multiple: number; providerCodes: string[] } | null;

type Province = { code: string; name: string };
type Commune = { code: string; name: string; provinceCode: string; provinceName: string };
type CatalogBody = { available: boolean; message: string | null; provinces: Province[]; communes: Commune[] };
type Quote =
  | { available: true; fee: number; extraLeadTimeMinutes: number; freeFrom: number | null; zoneCode: string }
  | { available: false; reason: 'outside' | 'unavailable' | 'below-minimum'; minOrderAmount?: number };

const WHENS = ['any', 'subtotal-gte', 'subtotal-lt'] as const;
const money = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;

const emptySchedule = (): Schedule => ({
  leadTimeMinutes: 180,
  slotLengthMinutes: 15,
  capacity: 8,
  maxAdvanceDays: 7,
  bufferMinutes: 0,
  businessDayPolicy: { cutoffLocalTime: '04:00', holidayDates: [] },
  openingHours: {
    mode: 'daily',
    daily: [{ start: '07:00', end: '22:00' }],
    weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  },
});

export const emptyDelivery = (): Delivery => ({
  enabled: false,
  orderTiming: 'both',
  paymentTiming: 'pay-on-pickup',
  paymentProviders: ['cash'],
  paymentTimeoutMinutes: 15,
  minOrderAmount: 0,
  customerCancelBeforeMinutes: 30,
  slaMinutes: 10,
  schedule: emptySchedule(),
  zones: [],
});

const nextCode = (zones: DeliveryZone[]): string => {
  const used = new Set(zones.map((zone) => zone.code));
  let n = zones.length + 1;
  while (used.has(`z${n}`)) n += 1;
  return `z${n}`;
};

const blankZone = (zones: DeliveryZone[]): DeliveryZone => ({
  code: nextCode(zones),
  label: '',
  priority: Math.max(0, ...zones.map((zone) => zone.priority), 0) + 10,
  match: { kind: 'commune', communeCodes: [] },
  rules: [{ when: 'any', fee: 15_000 }],
  minOrderAmount: 0,
  extraLeadTimeMinutes: 0,
});

const feeText = (fee: FeeRule['fee'], t: ReturnType<typeof useT>) =>
  fee === 'unavailable' ? t('delivery.summary.unavailable') : fee === 0 ? t('delivery.summary.free') : money(fee);

/**
 * "Giao tận nơi" tab inside Chi nhánh (screens D1). The zone editor is an inline panel:
 * a Modal with a new dropdown froze the Admin in O3. Fee tiers are buttons, not a select.
 */
export const DeliveryTab = ({
  branchCode,
  delivery,
  providers,
  cashRounding,
  errors,
  onChange,
  onRounding,
  numberField,
}: {
  branchCode?: string;
  delivery: Delivery;
  providers: string[];
  cashRounding: CashRounding;
  errors: Record<string, string>;
  onChange: (next: Delivery) => void;
  onRounding: (next: CashRounding) => void;
  numberField: (label: string, value: number, onChange: (value: number) => void, path: string, hint?: string) => React.ReactNode;
}) => {
  const t = useT();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const [catalog, setCatalog] = useState<CatalogBody | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [province, setProvince] = useState('');
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DeliveryZone | null>(null);
  const [draftError, setDraftError] = useState<'label' | 'commune' | null>(null);
  const [quoteCode, setQuoteCode] = useState('');
  const [quoteSubtotal, setQuoteSubtotal] = useState(200_000);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading');
    try {
      const { data } = await get('/ordering/admin-units');
      const body = data as CatalogBody;
      setCatalog(body);
      setCatalogStatus('ready');
    } catch {
      setCatalogStatus('error');
    }
  }, [get]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadCommunes = async (code: string) => {
    setProvince(code);
    setQuery('');
    if (!code) {
      setCommunes([]);
      return;
    }
    try {
      const { data } = await get(`/ordering/admin-units?province=${encodeURIComponent(code)}&limit=2000`);
      const rows = (data as CatalogBody).communes ?? [];
      setCommunes(rows);
      setNames((current) => {
        const next = { ...current };
        for (const row of rows) next[row.code] = row.name;
        return next;
      });
    } catch (error) {
      toastError(error);
    }
  };

  const schedule = delivery.schedule ?? emptySchedule();
  const setDelivery = (next: Partial<Delivery>) => onChange({ ...delivery, ...next });
  const setSchedule = (next: Partial<Schedule>) => setDelivery({ schedule: { ...schedule, ...next } });
  const err = (path: string) => errors[path];
  const ordered = [...delivery.zones].sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));

  const summarize = (rules: FeeRule[]) =>
    rules
      .map((rule) => {
        const fee = feeText(rule.fee, t);
        if (rule.when === 'any') return t('delivery.summary.any', { fee });
        if (rule.when === 'subtotal-lt') return t('delivery.summary.lt', { amount: money(rule.subtotal ?? 0), fee });
        return t('delivery.summary.gte', { amount: money(rule.subtotal ?? 0), fee });
      })
      .join(' · ');

  const move = (index: number, direction: -1 | 1) => {
    const next = [...ordered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setDelivery({ zones: next.map((zone, i) => ({ ...zone, priority: (next.length - i) * 10 })) });
  };

  const commitDraft = () => {
    if (!draft) return;
    if (draft.label.trim() === '') {
      setDraftError('label');
      return;
    }
    if (draft.match.communeCodes.length === 0) {
      setDraftError('commune');
      return;
    }
    const current = delivery.zones.find((zone) => zone.code === draft.code);
    const saved = { ...draft, label: draft.label.trim(), priority: current?.priority ?? draft.priority };
    const zones = current
      ? delivery.zones.map((zone) => (zone.code === draft.code ? saved : zone))
      : [...delivery.zones, saved];
    setDelivery({ zones });
    setDraft(null);
    setDraftError(null);
  };

  const runQuote = async () => {
    if (!branchCode) return;
    setQuoting(true);
    setQuote(null);
    const zones = draft && draft.match.communeCodes.length > 0 ? [...delivery.zones.filter((zone) => zone.code !== draft.code), draft] : delivery.zones;
    try {
      const { data } = await post(`/ordering/branches/${branchCode}/delivery-quote`, {
        communeCode: quoteCode,
        subtotal: quoteSubtotal,
        zones,
      });
      setQuote(data as Quote);
    } catch (error) {
      toastError(error);
    } finally {
      setQuoting(false);
    }
  };

  const folded = foldDiacritics(query);
  const visible = communes
    .filter((row) => !folded || foldDiacritics(row.name).includes(folded) || row.code.toLowerCase().includes(folded))
    .slice(0, 40);
  const takenElsewhere = new Set(
    delivery.zones.filter((zone) => zone.code !== draft?.code).flatMap((zone) => zone.match.communeCodes),
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Grid.Root gap={4}>
        <Grid.Item col={12}>
          <Flex gap={2}>
            <Switch checked={delivery.enabled} onCheckedChange={(value: boolean) => setDelivery({ enabled: value })} />
            <Typography>{t('delivery.enabled')}</Typography>
          </Flex>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Field.Root>
            <Field.Label>{t('branch.pickup.orderTiming')}</Field.Label>
            <SingleSelect value={delivery.orderTiming} onChange={(value: string | number) => setDelivery({ orderTiming: String(value) as Delivery['orderTiming'] })}>
              {(['asap', 'scheduled', 'both'] as const).map((item) => (
                <SingleSelectOption key={item} value={item}>
                  {t(`branch.timing.${item}`)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.lead'), schedule.leadTimeMinutes, (value) => setSchedule({ leadTimeMinutes: value }), 'fulfillment.delivery.schedule.leadTimeMinutes', t('branch.pickup.leadHint'))}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.slot'), schedule.slotLengthMinutes, (value) => setSchedule({ slotLengthMinutes: value }), 'fulfillment.delivery.schedule.slotLengthMinutes')}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.capacity'), schedule.capacity, (value) => setSchedule({ capacity: value }), 'fulfillment.delivery.schedule.capacity')}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.advance'), schedule.maxAdvanceDays, (value) => setSchedule({ maxAdvanceDays: value }), 'fulfillment.delivery.schedule.maxAdvanceDays')}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.minOrder'), delivery.minOrderAmount, (value) => setDelivery({ minOrderAmount: value }), 'fulfillment.delivery.minOrderAmount')}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.cancelBefore'), delivery.customerCancelBeforeMinutes, (value) => setDelivery({ customerCancelBeforeMinutes: value }), 'fulfillment.delivery.customerCancelBeforeMinutes', t('branch.pickup.cancelHint'))}
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Field.Root error={err('fulfillment.delivery.paymentTiming')}>
            <Field.Label>{t('branch.pickup.paymentTiming')}</Field.Label>
            <SingleSelect value={delivery.paymentTiming} onChange={(value: string | number) => setDelivery({ paymentTiming: String(value) as Delivery['paymentTiming'] })}>
              {(['prepay', 'accept-then-pay', 'pay-on-pickup'] as const).map((item) => (
                <SingleSelectOption key={item} value={item}>
                  {t(`branch.paymentTiming.${item}`)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Field.Root error={err('fulfillment.delivery.paymentProviders')}>
            <Field.Label>{t('branch.pickup.methods')}</Field.Label>
            {providers.map((provider) => (
              <Checkbox
                key={provider}
                checked={delivery.paymentProviders.includes(provider)}
                onCheckedChange={(value: boolean) =>
                  setDelivery({
                    paymentProviders: value
                      ? [...delivery.paymentProviders, provider]
                      : delivery.paymentProviders.filter((item) => item !== provider),
                  })
                }
              >
                {t(`method.${provider}`, undefined, provider)}
              </Checkbox>
            ))}
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Field.Root>
            <Field.Label>{t('branch.pickup.rounding')}</Field.Label>
            <SingleSelect
              value={cashRounding?.enabled ? String(cashRounding.multiple) : '0'}
              onChange={(value: string | number) =>
                onRounding(Number(value) > 0 ? { enabled: true, multiple: Number(value), providerCodes: ['cash'] } : null)
              }
            >
              <SingleSelectOption value="0">{t('branch.rounding.none')}</SingleSelectOption>
              <SingleSelectOption value="1000">1.000đ</SingleSelectOption>
            </SingleSelect>
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          {numberField(t('branch.pickup.sla'), delivery.slaMinutes, (value) => setDelivery({ slaMinutes: value }), 'fulfillment.delivery.slaMinutes')}
        </Grid.Item>
      </Grid.Root>

      {catalogStatus === 'error' ? (
        <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger" action={<Button onClick={() => void loadCatalog()}>{t('common.retry')}</Button>}>
          {t('delivery.catalogLoadFailed')}
        </Alert>
      ) : null}
      {catalog && !catalog.available ? (
        <Alert closeLabel={t('common.close')} title={t('delivery.zones')} variant="warning">
          {t('delivery.catalogMissing')}
          {catalog.message ? ` ${catalog.message}` : ''}
        </Alert>
      ) : null}
      {err('fulfillment.delivery.zones') ? (
        <Typography textColor="danger600">{err('fulfillment.delivery.zones')}</Typography>
      ) : null}

      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="delta">{t('delivery.zones')}</Typography>
        <Button size="S" variant="tertiary" startIcon={<Plus />} disabled={draft !== null} onClick={() => { setDraft(blankZone(delivery.zones)); setDraftError(null); }}>
          {t('delivery.zones.add')}
        </Button>
      </Flex>
      {ordered.length === 0 && !draft ? <Typography textColor="neutral600">{t('delivery.zones.empty')}</Typography> : null}
      {ordered.map((zone, index) => (
        <Box key={zone.code} padding={4} background="neutral100" hasRadius>
          <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography fontWeight="bold">{zone.label}</Typography>
              <Typography textColor="neutral600">
                {t('delivery.zone.priority', { priority: zone.priority })} · {t('delivery.zone.communeCount', { count: zone.match.communeCodes.length })}
              </Typography>
              <Typography>{summarize(zone.rules)}</Typography>
            </Flex>
            <Flex gap={1}>
              <Button size="S" variant="tertiary" disabled={index === 0} onClick={() => move(index, -1)}>{t('delivery.zone.up')}</Button>
              <Button size="S" variant="tertiary" disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>{t('delivery.zone.down')}</Button>
              <Button size="S" variant="secondary" onClick={() => { setDraft({ ...zone, match: { ...zone.match, communeCodes: [...zone.match.communeCodes] }, rules: zone.rules.map((rule) => ({ ...rule })) }); setDraftError(null); }}>{t('delivery.zone.edit')}</Button>
              <Button size="S" variant="danger-light" onClick={() => { setDelivery({ zones: delivery.zones.filter((item) => item.code !== zone.code) }); if (draft?.code === zone.code) setDraft(null); }}>{t('delivery.zone.delete')}</Button>
            </Flex>
          </Flex>
        </Box>
      ))}

      {draft ? (
        <Box padding={4} background="neutral0" hasRadius borderColor="neutral200">
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root required error={draftError === 'label' ? t('delivery.zone.needLabel') : undefined}>
              <Field.Label>{t('delivery.zone.label')}</Field.Label>
              <TextInput value={draft.label} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, label: event.target.value })} />
              <Field.Error />
            </Field.Root>
            <Field.Root error={draftError === 'commune' ? t('delivery.zone.needCommune') : undefined}>
              <Field.Label>{t('delivery.zone.province')}</Field.Label>
              {catalogStatus === 'loading' ? <Loader>{t('common.loading')}</Loader> : (
                <SingleSelect value={province} onChange={(value: string | number) => void loadCommunes(String(value))} placeholder={t('delivery.zone.pickProvince')}>
                  {(catalog?.provinces ?? []).map((item) => (
                    <SingleSelectOption key={item.code} value={item.code}>{item.name}</SingleSelectOption>
                  ))}
                </SingleSelect>
              )}
              <Field.Error />
            </Field.Root>
            <TextInput aria-label={t('delivery.zone.search')} placeholder={t('delivery.zone.search')} value={query} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} />
            <Typography textColor="neutral600">{t('delivery.zone.searchHint')}</Typography>
            <Box style={{ maxHeight: 240, overflow: 'auto' }}>
              {visible.length === 0 ? <Typography textColor="neutral600">{t('delivery.zone.none')}</Typography> : null}
              {visible.map((row) => {
                const checked = draft.match.communeCodes.includes(row.code);
                return (
                  <Flex key={row.code} gap={2}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value: boolean) => {
                        const communeCodes = value
                          ? [...draft.match.communeCodes, row.code]
                          : draft.match.communeCodes.filter((code) => code !== row.code);
                        setDraft({ ...draft, match: { kind: 'commune', communeCodes } });
                        setNames((current) => ({ ...current, [row.code]: row.name }));
                      }}
                    >
                      {row.name}
                    </Checkbox>
                    {takenElsewhere.has(row.code) ? <Typography textColor="warning600">{t('delivery.zone.overlap', { name: row.name })}</Typography> : null}
                  </Flex>
                );
              })}
            </Box>
            <Flex gap={2} wrap="wrap">
              {draft.match.communeCodes.map((code) => (
                <Button key={code} size="S" variant="tertiary" endIcon={<Trash />} onClick={() => setDraft({ ...draft, match: { kind: 'commune', communeCodes: draft.match.communeCodes.filter((item) => item !== code) } })}>
                  {names[code] ?? code}
                </Button>
              ))}
            </Flex>
            {draft.rules.map((rule, index) => (
              <Flex key={index} gap={2} alignItems="flex-end" wrap="wrap">
                {WHENS.map((when) => (
                  <Button
                    key={when}
                    size="S"
                    variant={rule.when === when ? 'default' : 'tertiary'}
                    onClick={() => {
                      const rules = draft.rules.map((item, i) => (i === index ? { ...item, when, subtotal: when === 'any' ? undefined : item.subtotal ?? 0 } : item));
                      setDraft({ ...draft, rules });
                    }}
                  >
                    {t(`delivery.when.${when}`)}
                  </Button>
                ))}
                {rule.when !== 'any' ? (
                  <Box style={{ width: 140 }}>
                    <Field.Root>
                      <Field.Label>{t('delivery.rule.amount')}</Field.Label>
                      <NumberInput value={rule.subtotal ?? 0} onValueChange={(value?: number) => setDraft({ ...draft, rules: draft.rules.map((item, i) => (i === index ? { ...item, subtotal: value ?? 0 } : item)) })} />
                    </Field.Root>
                  </Box>
                ) : null}
                <Checkbox
                  checked={rule.fee === 'unavailable'}
                  onCheckedChange={(value: boolean) =>
                    setDraft({ ...draft, rules: draft.rules.map((item, i) => (i === index ? { ...item, fee: value ? 'unavailable' : 0 } : item)) })
                  }
                >
                  {t('delivery.rule.unavailable')}
                </Checkbox>
                {rule.fee !== 'unavailable' ? (
                  <Box style={{ width: 140 }}>
                    <Field.Root>
                      <Field.Label>{t('delivery.rule.fee')}</Field.Label>
                      <NumberInput value={rule.fee} onValueChange={(value?: number) => setDraft({ ...draft, rules: draft.rules.map((item, i) => (i === index ? { ...item, fee: value ?? 0 } : item)) })} />
                    </Field.Root>
                  </Box>
                ) : null}
                <IconButton label={t('delivery.rule.remove')} variant="ghost" disabled={draft.rules.length === 1} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}>
                  <Trash />
                </IconButton>
              </Flex>
            ))}
            <Box>
              <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => setDraft({ ...draft, rules: [...draft.rules, { when: 'any', fee: 0 }] })}>
                {t('delivery.rule.add')}
              </Button>
            </Box>
            <Grid.Root gap={4}>
              <Grid.Item col={6} s={12}>
                <Field.Root>
                  <Field.Label>{t('delivery.zone.min')}</Field.Label>
                  <NumberInput value={draft.minOrderAmount} onValueChange={(value?: number) => setDraft({ ...draft, minOrderAmount: value ?? 0 })} />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={6} s={12}>
                <Field.Root>
                  <Field.Label>{t('delivery.zone.extra')}</Field.Label>
                  <NumberInput value={draft.extraLeadTimeMinutes} onValueChange={(value?: number) => setDraft({ ...draft, extraLeadTimeMinutes: value ?? 0 })} />
                </Field.Root>
              </Grid.Item>
            </Grid.Root>
            <Flex gap={2}>
              <Button onClick={commitDraft}>{t('delivery.zone.done')}</Button>
              <Button variant="tertiary" onClick={() => { setDraft(null); setDraftError(null); }}>{t('delivery.zone.cancel')}</Button>
            </Flex>
          </Flex>
        </Box>
      ) : null}

      <Box padding={4} background="neutral100" hasRadius>
        <Flex direction="column" alignItems="stretch" gap={3}>
          <Typography variant="delta">{t('delivery.quote.title')}</Typography>
          {branchCode ? (
            <>
              <Flex gap={2} wrap="wrap" alignItems="flex-end">
                <Box style={{ width: 180 }}>
                  <Field.Root>
                    <Field.Label>{t('delivery.quote.commune')}</Field.Label>
                    <TextInput value={quoteCode} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuoteCode(event.target.value)} />
                  </Field.Root>
                </Box>
                <Box style={{ width: 180 }}>
                  <Field.Root>
                    <Field.Label>{t('delivery.quote.subtotal')}</Field.Label>
                    <NumberInput value={quoteSubtotal} onValueChange={(value?: number) => setQuoteSubtotal(value ?? 0)} />
                  </Field.Root>
                </Box>
                <Button loading={quoting} onClick={() => void runQuote()}>{t('delivery.quote.run')}</Button>
              </Flex>
              {quote?.available === false && quote.reason === 'outside' ? <Typography>{t('delivery.quote.outside')}</Typography> : null}
              {quote?.available === false && quote.reason === 'unavailable' ? <Typography>{t('delivery.quote.unavailable')}</Typography> : null}
              {quote?.available === false && quote.reason === 'below-minimum' ? <Typography>{t('delivery.quote.below', { amount: money(quote.minOrderAmount ?? 0) })}</Typography> : null}
              {quote?.available === true ? (
                <Typography>
                  {t('delivery.quote.ok', { fee: money(quote.fee), extra: quote.extraLeadTimeMinutes })}
                  {quote.freeFrom !== null ? ` ${t('delivery.quote.freeFrom', { more: money(quote.freeFrom - quoteSubtotal) })}` : ''}
                </Typography>
              ) : null}
            </>
          ) : (
            <Typography textColor="neutral600">{t('delivery.quote.afterSave')}</Typography>
          )}
        </Flex>
      </Box>
    </Flex>
  );
};
