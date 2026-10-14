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
  Tabs,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Plus, Trash } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useNavigate, useParams } from 'react-router-dom';

import { fieldErrors, useErrorToast } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { DeliveryTab, emptyDelivery, type Delivery } from './DeliveryTab';
import { RestaurantTab, type BranchFee, type DineIn, type Printing } from './RestaurantTab';
import { SpecialHoursEditor, type SpecialHourRow } from './SpecialHoursEditor';

type Range = { start: string; end: string };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type Pickup = {
  enabled: boolean;
  orderTiming: 'asap' | 'scheduled' | 'both';
  paymentTiming: 'prepay' | 'accept-then-pay' | 'pay-on-pickup';
  paymentProviders: string[];
  paymentTimeoutMinutes: number;
  minOrderAmount: number;
  customerCancelBeforeMinutes: number;
  slaMinutes: number;
  autoRejectAfterMinutes: number | null;
  schedule: {
    leadTimeMinutes: number;
    slotLengthMinutes: number;
    capacity: number;
    maxAdvanceDays: number;
    bufferMinutes: number;
    businessDayPolicy: { cutoffLocalTime: string; holidayDates: string[]; specialHours?: SpecialHourRow[] };
    openingHours: { mode: '24_7' | 'daily' | 'weekly'; daily: Range[]; weekly: Record<(typeof DAYS)[number], Range[]> };
  };
};

type Branch = {
  code: string;
  name: Record<string, string>;
  address: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  isActive: boolean;
  onlineOrdering: boolean;
  cashRounding: { enabled: boolean; multiple: number; providerCodes: string[] } | null;
  fees: BranchFee[] | null;
  printing: Printing;
  fulfillment: { pickup: Pickup; delivery: Delivery; dineIn?: DineIn } & Record<string, unknown>;
};

const TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'UTC'];

const emptyBranch = (): Branch => ({
  code: '',
  name: { vi: '', en: '' },
  address: null,
  phone: '',
  email: '',
  timezone: 'Asia/Ho_Chi_Minh',
  isActive: true,
  onlineOrdering: false,
  cashRounding: null,
  fees: null,
  printing: null,
  fulfillment: {
    pickup: {
      enabled: true,
      orderTiming: 'both',
      paymentTiming: 'pay-on-pickup',
      paymentProviders: ['cash'],
      paymentTimeoutMinutes: 15,
      minOrderAmount: 0,
      customerCancelBeforeMinutes: 30,
      slaMinutes: 10,
      autoRejectAfterMinutes: null,
      schedule: {
        leadTimeMinutes: 180,
        slotLengthMinutes: 15,
        capacity: 8,
        maxAdvanceDays: 7,
        bufferMinutes: 0,
        businessDayPolicy: { cutoffLocalTime: '04:00', holidayDates: [], specialHours: [] },
        openingHours: {
          mode: 'daily',
          daily: [{ start: '07:00', end: '22:00' }],
          weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        },
      },
    },
    delivery: emptyDelivery(),
  },
});

/** Ranges editor: several open–close pairs; close earlier than open shows "qua nửa đêm". */
const RangesEditor = ({
  ranges,
  onChange,
  errorPrefix,
  errors,
}: {
  ranges: Range[];
  onChange: (next: Range[]) => void;
  errorPrefix: string;
  errors: Record<string, string>;
}) => {
  const t = useT();
  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {ranges.map((range, index) => (
        <Flex key={index} gap={2} alignItems="center">
          <TextInput
            type="time"
            aria-label={t('branch.open')}
            value={range.start}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(ranges.map((item, i) => (i === index ? { ...item, start: event.target.value } : item)))
            }
          />
          <Typography>–</Typography>
          <TextInput
            type="time"
            aria-label={t('branch.close')}
            value={range.end}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange(ranges.map((item, i) => (i === index ? { ...item, end: event.target.value } : item)))
            }
          />
          {range.end < range.start ? <Typography textColor="neutral600">{t('branch.pastMidnight')}</Typography> : null}
          {errors[`${errorPrefix}.${index}`] ? <Typography textColor="danger600">{errors[`${errorPrefix}.${index}`]}</Typography> : null}
          <IconButton label={t('create.remove')} variant="ghost" onClick={() => onChange(ranges.filter((_, i) => i !== index))}>
            <Trash />
          </IconButton>
        </Flex>
      ))}
      <Box>
        <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => onChange([...ranges, { start: '07:00', end: '22:00' }])}>
          {t('branch.addRange')}
        </Button>
      </Box>
    </Flex>
  );
};

/**
 * "Chi nhánh" editor (screens S7; TastyIgniter collectionsettings / workinghour). One PATCH saves
 * the whole page; validation issues land under their field by path.
 */
export const BranchEditor = () => {
  const t = useT();
  const navigate = useNavigate();
  const { code } = useParams();
  const creating = code === undefined;
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [branch, setBranch] = useState<Branch | null>(creating ? emptyBranch() : null);
  const [providers, setProviders] = useState<string[]>(['cash']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(creating ? 'ready' : 'loading');
  const [saving, setSaving] = useState(false);
  const [holiday, setHoliday] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: item }, { data: list }] = await Promise.all([get(`/ordering/branches/${code}`), get('/ordering/branches')]);
      setBranch((item as { item: Branch }).item);
      setProviders((list as { paymentProviders: string[] }).paymentProviders);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [code, get]);

  useEffect(() => {
    if (!creating) void load();
  }, [creating, load]);

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status === 'error' || !branch) {
    return (
      <Layouts.Content>
        <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')} action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}>
          {t('branch.loadFailed')}
        </Alert>
      </Layouts.Content>
    );
  }

  const pickup = branch.fulfillment.pickup;
  const schedule = pickup.schedule;
  const setPickup = (next: Partial<Pickup>) =>
    setBranch({ ...branch, fulfillment: { ...branch.fulfillment, pickup: { ...pickup, ...next } } });
  const setSchedule = (next: Partial<Pickup['schedule']>) => setPickup({ schedule: { ...schedule, ...next } });
  const err = (path: string) => errors[path];
  const numberField = (label: string, value: number, onChange: (value: number) => void, path: string, hint?: string) => (
    <Field.Root error={err(path)} hint={hint}>
      <Field.Label>{label}</Field.Label>
      <NumberInput value={value} onValueChange={(next?: number) => onChange(next ?? 0)} />
      <Field.Hint />
      <Field.Error />
    </Field.Root>
  );

  const save = async () => {
    setSaving(true);
    setErrors({});
    const payload = {
      ...(creating ? { code: branch.code } : {}),
      name: branch.name,
      phone: branch.phone || null,
      email: branch.email || null,
      timezone: branch.timezone,
      isActive: branch.isActive,
      onlineOrdering: branch.onlineOrdering,
      cashRounding: branch.cashRounding,
      fees: branch.fees,
      printing: branch.printing,
      fulfillment: {
        pickup,
        delivery: branch.fulfillment.delivery ?? emptyDelivery(),
        ...(branch.fulfillment.dineIn ? { dineIn: branch.fulfillment.dineIn } : {}),
      },
    };
    try {
      const { data } = creating ? await post('/ordering/branches', payload) : await put(`/ordering/branches/${code}`, payload);
      setBranch((data as { item: Branch }).item);
      toggleNotification({ type: 'success', message: t('branch.saved') });
      if (creating) navigate(`../${branch.code}`);
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) toastError(error);
      else toggleNotification({ type: 'danger', message: t('branch.fixErrors') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={creating ? t('branch.new') : branch.name.vi || branch.code}
        subtitle={t('branch.newOrdersOnly')}
        primaryAction={
          <Button loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />
      <Layouts.Content>
        <Tabs.Root defaultValue="info">
          <Tabs.List aria-label={t('branch.title')}>
            <Tabs.Trigger value="info">{t('branch.tab.info')}</Tabs.Trigger>
            <Tabs.Trigger value="hours">{t('branch.tab.hours')}</Tabs.Trigger>
            <Tabs.Trigger value="pickup">{t('branch.tab.pickup')}</Tabs.Trigger>
            <Tabs.Trigger value="delivery">{t('branch.tab.delivery')}</Tabs.Trigger>
            <Tabs.Trigger value="restaurant">{t('branch.tab.restaurant')}</Tabs.Trigger>
          </Tabs.List>
          <Box background="neutral0" padding={6} hasRadius shadow="tableShadow" marginTop={4}>
            <Tabs.Content value="info">
              <Grid.Root gap={4}>
                <Grid.Item col={4} s={12}>
                  <Field.Root required error={err('code')} hint={creating ? t('branch.codeHint') : t('branch.codeLocked')}>
                    <Field.Label>{t('branch.code')}</Field.Label>
                    <TextInput disabled={!creating} value={branch.code} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBranch({ ...branch, code: event.target.value })} />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root required error={err('name')}>
                    <Field.Label>{t('branch.nameVi')}</Field.Label>
                    <TextInput value={branch.name.vi ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBranch({ ...branch, name: { ...branch.name, vi: event.target.value } })} />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root>
                    <Field.Label>{t('branch.nameEn')}</Field.Label>
                    <TextInput value={branch.name.en ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBranch({ ...branch, name: { ...branch.name, en: event.target.value } })} />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root error={err('phone')}>
                    <Field.Label>{t('branch.phone')}</Field.Label>
                    <TextInput value={branch.phone ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBranch({ ...branch, phone: event.target.value })} />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root error={err('email')} hint={t('branch.emailHint')}>
                    <Field.Label>{t('branch.email')}</Field.Label>
                    <TextInput type="email" value={branch.email ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBranch({ ...branch, email: event.target.value })} />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root error={err('timezone')}>
                    <Field.Label>{t('branch.timezone')}</Field.Label>
                    <SingleSelect value={branch.timezone} onChange={(value: string | number) => setBranch({ ...branch, timezone: String(value) })}>
                      {TIMEZONES.map((zone) => (
                        <SingleSelectOption key={zone} value={zone}>
                          {zone}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root error={err('fulfillment.pickup.schedule.businessDayPolicy.cutoffLocalTime')} hint={t('branch.cutoffHint')}>
                    <Field.Label>{t('branch.cutoff')}</Field.Label>
                    <TextInput
                      type="time"
                      value={schedule.businessDayPolicy.cutoffLocalTime}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setSchedule({ businessDayPolicy: { ...schedule.businessDayPolicy, cutoffLocalTime: event.target.value } })
                      }
                    />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Flex gap={2} paddingTop={6}>
                    <Switch checked={branch.onlineOrdering} onCheckedChange={(value: boolean) => setBranch({ ...branch, onlineOrdering: value })} />
                    <Typography>{t('branch.onlineOrdering')}</Typography>
                  </Flex>
                </Grid.Item>
              </Grid.Root>
            </Tabs.Content>

            <Tabs.Content value="hours">
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Field.Root>
                  <Field.Label>{t('branch.hoursMode')}</Field.Label>
                  <SingleSelect
                    value={schedule.openingHours.mode}
                    onChange={(value: string | number) =>
                      setSchedule({ openingHours: { ...schedule.openingHours, mode: String(value) as Pickup['schedule']['openingHours']['mode'] } })
                    }
                  >
                    <SingleSelectOption value="24_7">{t('branch.hours.24_7')}</SingleSelectOption>
                    <SingleSelectOption value="daily">{t('branch.hours.daily')}</SingleSelectOption>
                    <SingleSelectOption value="weekly">{t('branch.hours.weekly')}</SingleSelectOption>
                  </SingleSelect>
                </Field.Root>
                {schedule.openingHours.mode === 'daily' ? (
                  <RangesEditor
                    ranges={schedule.openingHours.daily}
                    errors={errors}
                    errorPrefix="fulfillment.pickup.schedule.openingHours.daily"
                    onChange={(daily) => setSchedule({ openingHours: { ...schedule.openingHours, daily } })}
                  />
                ) : null}
                {schedule.openingHours.mode === 'weekly'
                  ? DAYS.map((day) => (
                      <Flex key={day} gap={4} alignItems="flex-start">
                        <Box minWidth="80px" paddingTop={2}>
                          <Typography fontWeight="bold">{t(`day.${day}`)}</Typography>
                        </Box>
                        <RangesEditor
                          ranges={schedule.openingHours.weekly[day] ?? []}
                          errors={errors}
                          errorPrefix={`fulfillment.pickup.schedule.openingHours.weekly.${day}`}
                          onChange={(ranges) =>
                            setSchedule({ openingHours: { ...schedule.openingHours, weekly: { ...schedule.openingHours.weekly, [day]: ranges } } })
                          }
                        />
                      </Flex>
                    ))
                  : null}
                <Field.Root>
                  <Field.Label>{t('branch.holidays')}</Field.Label>
                  <Flex gap={2}>
                    <TextInput type="date" value={holiday} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHoliday(event.target.value)} />
                    <Button
                      variant="secondary"
                      disabled={!holiday}
                      onClick={() => {
                        setSchedule({
                          businessDayPolicy: {
                            ...schedule.businessDayPolicy,
                            holidayDates: [...new Set([...schedule.businessDayPolicy.holidayDates, holiday])].sort(),
                          },
                        });
                        setHoliday('');
                      }}
                    >
                      {t('branch.addHoliday')}
                    </Button>
                  </Flex>
                </Field.Root>
                <Flex gap={2} wrap="wrap">
                  {schedule.businessDayPolicy.holidayDates.map((date) => (
                    <Button
                      key={date}
                      size="S"
                      variant="tertiary"
                      endIcon={<Trash />}
                      onClick={() =>
                        setSchedule({
                          businessDayPolicy: {
                            ...schedule.businessDayPolicy,
                            holidayDates: schedule.businessDayPolicy.holidayDates.filter((item) => item !== date),
                          },
                        })
                      }
                    >
                      {date}
                    </Button>
                  ))}
                </Flex>
                <SpecialHoursEditor
                  rows={schedule.businessDayPolicy.specialHours ?? []}
                  timezone={branch.timezone}
                  errorPrefix="fulfillment.pickup.schedule.businessDayPolicy.specialHours"
                  errors={errors}
                  copyLabel={t('branch.special.copyToDelivery')}
                  onChange={(specialHours) =>
                    setSchedule({ businessDayPolicy: { ...schedule.businessDayPolicy, specialHours } })
                  }
                  onCopy={() => {
                    const delivery = branch.fulfillment.delivery ?? emptyDelivery();
                    const specialHours = (schedule.businessDayPolicy.specialHours ?? []).map((row) => ({
                      ...row,
                      ranges: row.ranges.map((range) => ({ ...range })),
                    }));
                    setBranch({
                      ...branch,
                      fulfillment: {
                        ...branch.fulfillment,
                        delivery: {
                          ...delivery,
                          schedule: {
                            ...delivery.schedule,
                            businessDayPolicy: { ...delivery.schedule.businessDayPolicy, specialHours },
                          },
                        },
                      },
                    });
                  }}
                />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="pickup">
              <Grid.Root gap={4}>
                <Grid.Item col={12}>
                  <Flex gap={2}>
                    <Switch checked={pickup.enabled} onCheckedChange={(value: boolean) => setPickup({ enabled: value })} />
                    <Typography>{t('branch.pickup.enabled')}</Typography>
                  </Flex>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root>
                    <Field.Label>{t('branch.pickup.orderTiming')}</Field.Label>
                    <SingleSelect value={pickup.orderTiming} onChange={(value: string | number) => setPickup({ orderTiming: String(value) as Pickup['orderTiming'] })}>
                      {(['asap', 'scheduled', 'both'] as const).map((item) => (
                        <SingleSelectOption key={item} value={item}>
                          {t(`branch.timing.${item}`)}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.lead'), schedule.leadTimeMinutes, (value) => setSchedule({ leadTimeMinutes: value }), 'fulfillment.pickup.schedule.leadTimeMinutes', t('branch.pickup.leadHint'))}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.slot'), schedule.slotLengthMinutes, (value) => setSchedule({ slotLengthMinutes: value }), 'fulfillment.pickup.schedule.slotLengthMinutes')}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.capacity'), schedule.capacity, (value) => setSchedule({ capacity: value }), 'fulfillment.pickup.schedule.capacity')}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.advance'), schedule.maxAdvanceDays, (value) => setSchedule({ maxAdvanceDays: value }), 'fulfillment.pickup.schedule.maxAdvanceDays')}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.minOrder'), pickup.minOrderAmount, (value) => setPickup({ minOrderAmount: value }), 'fulfillment.pickup.minOrderAmount')}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.cancelBefore'), pickup.customerCancelBeforeMinutes, (value) => setPickup({ customerCancelBeforeMinutes: value }), 'fulfillment.pickup.customerCancelBeforeMinutes', t('branch.pickup.cancelHint'))}
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  <Field.Root error={err('fulfillment.pickup.paymentTiming')}>
                    <Field.Label>{t('branch.pickup.paymentTiming')}</Field.Label>
                    <SingleSelect value={pickup.paymentTiming} onChange={(value: string | number) => setPickup({ paymentTiming: String(value) as Pickup['paymentTiming'] })}>
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
                  <Field.Root error={err('fulfillment.pickup.paymentProviders')}>
                    <Field.Label>{t('branch.pickup.methods')}</Field.Label>
                    {providers.map((provider) => (
                      <Checkbox
                        key={provider}
                        checked={pickup.paymentProviders.includes(provider)}
                        onCheckedChange={(value: boolean) =>
                          setPickup({
                            paymentProviders: value
                              ? [...pickup.paymentProviders, provider]
                              : pickup.paymentProviders.filter((item) => item !== provider),
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
                      value={branch.cashRounding?.enabled ? String(branch.cashRounding.multiple) : '0'}
                      onChange={(value: string | number) =>
                        setBranch({
                          ...branch,
                          cashRounding: Number(value) > 0 ? { enabled: true, multiple: Number(value), providerCodes: ['cash'] } : null,
                        })
                      }
                    >
                      <SingleSelectOption value="0">{t('branch.rounding.none')}</SingleSelectOption>
                      <SingleSelectOption value="1000">1.000đ</SingleSelectOption>
                    </SingleSelect>
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={4} s={12}>
                  {numberField(t('branch.pickup.sla'), pickup.slaMinutes, (value) => setPickup({ slaMinutes: value }), 'fulfillment.pickup.slaMinutes')}
                </Grid.Item>
              </Grid.Root>
            </Tabs.Content>
            <Tabs.Content value="delivery">
              <DeliveryTab
                branchCode={creating ? undefined : code}
                delivery={branch.fulfillment.delivery ?? emptyDelivery()}
                timezone={branch.timezone}
                providers={providers}
                cashRounding={branch.cashRounding}
                errors={errors}
                onChange={(next) => setBranch({ ...branch, fulfillment: { ...branch.fulfillment, delivery: next } })}
                onRounding={(next) => setBranch({ ...branch, cashRounding: next })}
                onCopySpecialToPickup={() => {
                  const specialHours = (branch.fulfillment.delivery?.schedule?.businessDayPolicy?.specialHours ?? []).map(
                    (row) => ({ ...row, ranges: row.ranges.map((range) => ({ ...range })) }),
                  );
                  setSchedule({ businessDayPolicy: { ...schedule.businessDayPolicy, specialHours } });
                }}
                numberField={numberField}
              />
            </Tabs.Content>
            <Tabs.Content value="restaurant">
              <RestaurantTab
                fees={branch.fees ?? []}
                printing={branch.printing}
                pickupAutoReject={pickup.autoRejectAfterMinutes}
                deliveryAutoReject={(branch.fulfillment.delivery ?? emptyDelivery()).autoRejectAfterMinutes}
                dineIn={
                  branch.fulfillment.dineIn ?? {
                    enabled: false,
                    sessionPayment: 'at-close' as const,
                    autoRejectAfterMinutes: null,
                  }
                }
                onFees={(fees) => setBranch({ ...branch, fees })}
                onPrinting={(printing) => setBranch({ ...branch, printing })}
                onPickupAutoReject={(autoRejectAfterMinutes) => setPickup({ autoRejectAfterMinutes })}
                onDeliveryAutoReject={(autoRejectAfterMinutes) =>
                  setBranch({
                    ...branch,
                    fulfillment: {
                      ...branch.fulfillment,
                      delivery: { ...(branch.fulfillment.delivery ?? emptyDelivery()), autoRejectAfterMinutes },
                    },
                  })
                }
                onDineIn={(dineIn) =>
                  setBranch({ ...branch, fulfillment: { ...branch.fulfillment, dineIn } })
                }
              />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
        <Box paddingTop={4}>
          <Alert variant="default" closeLabel={t('common.close')} title={t('branch.newOrdersOnly')}>
            {t('branch.newOrdersOnly.body')}
          </Alert>
        </Box>
      </Layouts.Content>
    </>
  );
};
