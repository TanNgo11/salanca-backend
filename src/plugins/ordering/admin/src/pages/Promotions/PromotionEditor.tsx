import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Searchbar,
  Switch,
  Table,
  Tabs,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Download, Plus, Trash } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fieldErrors, httpStatusOf, useErrorToast } from '../../lib/api';
import { formatBusinessDate, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_EXPORT } from '../../lib/permissions';
import { conditionText, discountText, type PromotionRow } from './index';

type Targets = {
  products: Array<{ ref: string; title: string }>;
  categories: Array<{ ref: string; title: string }>;
  branches: Array<{ code: string; name: string }>;
};

type Stats = { orders: number; discountTotal: number; revenue: number; reserved: number };

type CodeRow = {
  id: number;
  code: string;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  batch: string | null;
  createdAt: string | null;
};

type Redemption = {
  id: number;
  orderId: number;
  orderCode: string;
  businessDate: string;
  locationRef: string;
  code: string | null;
  discountAmount: number;
  status: 'reserved' | 'applied' | 'released';
};

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DISCOUNT_TYPES = ['percent', 'amount', 'free-delivery', 'delivery-amount'] as const;
const TARGET_KINDS = ['order', 'products', 'categories'] as const;

type Form = {
  kind: 'code' | 'auto';
  nameVi: string;
  nameEn: string;
  internalNote: string;
  discountType: (typeof DISCOUNT_TYPES)[number];
  value?: number;
  maxDiscount?: number;
  targetKind: (typeof TARGET_KINDS)[number];
  refs: string[];
  minSubtotal?: number;
  allBranches: boolean;
  locationRefs: string[];
  receiveKinds: Array<'pickup' | 'delivery'>;
  firstOrderOnly: boolean;
  customerGroups: string;
  startsAt: string;
  endsAt: string;
  weekdays: string[];
  timeRanges: Array<{ start: string; end: string }>;
  usageLimit?: number;
  perCustomerLimit?: number;
  stackable: boolean;
  priority?: number;
  code: string;
};

/** `datetime-local` value in the browser's zone ↔ ISO instant. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromLocalInput = (value: string): string | null => (value ? new Date(value).toISOString() : null);

/** O16: comma/space separated O14 group codes -> unique list (the server checks the shape). */
const groupCodes = (value: string): string[] => [...new Set(value.split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean))];

const blank = (): Form => ({
  kind: 'code',
  nameVi: '',
  nameEn: '',
  internalNote: '',
  discountType: 'percent',
  value: undefined,
  maxDiscount: undefined,
  targetKind: 'order',
  refs: [],
  minSubtotal: 0,
  allBranches: true,
  locationRefs: [],
  receiveKinds: ['pickup', 'delivery'],
  firstOrderOnly: false,
  customerGroups: '',
  startsAt: toLocalInput(new Date().toISOString()),
  endsAt: '',
  weekdays: [],
  timeRanges: [],
  usageLimit: undefined,
  perCustomerLimit: undefined,
  stackable: false,
  priority: 0,
  code: '',
});

const formOf = (row: PromotionRow): Form => ({
  kind: row.kind,
  nameVi: row.name.vi,
  nameEn: row.name.en ?? '',
  internalNote: row.internalNote ?? '',
  discountType: row.discountType,
  value: row.value ?? undefined,
  maxDiscount: row.maxDiscount ?? undefined,
  targetKind: row.target.kind,
  refs: row.target.refs,
  minSubtotal: row.minSubtotal,
  allBranches: !row.locationRefs || row.locationRefs.length === 0,
  locationRefs: row.locationRefs ?? [],
  receiveKinds: row.receiveKinds,
  firstOrderOnly: row.firstOrderOnly,
  customerGroups: (row.customerGroups ?? []).join(', '),
  startsAt: toLocalInput(row.startsAt),
  endsAt: toLocalInput(row.endsAt),
  weekdays: row.weekdays,
  timeRanges: row.timeRanges,
  usageLimit: row.usageLimit ?? undefined,
  perCustomerLimit: row.perCustomerLimit ?? undefined,
  stackable: row.stackable,
  priority: row.priority,
  code: '',
});

/** Lowercase, no Vietnamese tone marks — the picker search ignores diacritics (like the O5 commune list). */
const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

const toggle = <T,>(list: T[], item: T): T[] =>
  list.includes(item) ? list.filter((value) => value !== item) : [...list, item];

/** Two-or-more choice "cards" as toggle buttons (no dropdown — screens K2). */
const Choice = <T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
  disabled?: boolean;
}) => (
  <Flex gap={2} wrap="wrap">
    {options.map((option) => (
      <Button
        key={option}
        variant={option === value ? 'default' : 'tertiary'}
        disabled={disabled && option !== value}
        onClick={() => onChange(option)}
      >
        {label(option)}
      </Button>
    ))}
  </Flex>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
    <Typography variant="delta" tag="h2">
      {title}
    </Typography>
    <Box paddingTop={4}>{children}</Box>
  </Box>
);

const CodesTab = ({ promotionId }: { promotionId: number }) => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const exportRbac = useRBAC(RBAC_EXPORT);
  const canExport = !exportRbac.isLoading && Object.values(exportRbac.allowedActions).some(Boolean);
  const [rows, setRows] = useState<CodeRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState<'none' | 'one' | 'many'>('none');
  const [one, setOne] = useState<{ code: string; usageLimit?: number }>({ code: '' });
  const [many, setMany] = useState<{ count?: number; prefix: string; length?: number; usageLimit?: number; batch: string }>({
    count: 100,
    prefix: '',
    length: 10,
    usageLimit: 1,
    batch: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), ...(q.trim() ? { q: q.trim() } : {}) });
      const { data } = await get(`/ordering/promotions/${promotionId}/codes?${query.toString()}`);
      const body = data as { items: CodeRow[]; pagination: { total: number } };
      setRows(body.items);
      setTotal(body.pagination.total);
    } catch (error) {
      toastError(error);
    }
  }, [get, page, promotionId, q, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body =
        panel === 'one'
          ? { code: one.code, usageLimit: one.usageLimit ?? null }
          : {
              generate: {
                count: many.count,
                prefix: many.prefix,
                length: many.length,
                usageLimit: many.usageLimit ?? null,
                batch: many.batch,
              },
            };
      const { data } = await post(`/ordering/promotions/${promotionId}/codes`, body);
      const result = data as { generated: number; batch: string | null };
      toggleNotification({
        type: 'success',
        message: result.batch
          ? t('promo.codes.generatedBatch', { count: result.generated, batch: result.batch })
          : t('promo.codes.generated', { count: result.generated }),
      });
      setPanel('none');
      setOne({ code: '' });
      void load();
    } catch (error) {
      const fields = fieldErrors(error, t);
      setErrors(fields);
      if (Object.keys(fields).length === 0) toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row: CodeRow, active: boolean) => {
    try {
      await post(`/ordering/promotion-codes/${row.id}/active`, { active });
      void load();
    } catch (error) {
      toastError(error);
    }
  };

  const exportCsv = async () => {
    try {
      const { data } = await get(`/ordering/promotions/${promotionId}/codes/export`, { responseType: 'blob' } as never);
      const blob = data instanceof Blob ? data : new Blob([data as string], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ma-khuyen-mai-${promotionId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex justifyContent="space-between" gap={2} wrap="wrap">
        <Box style={{ minWidth: 240 }}>
          <Searchbar
            name="code-q"
            value={q}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setPage(1);
              setQ(event.target.value);
            }}
            onClear={() => setQ('')}
            clearLabel={t('common.clear')}
            placeholder={t('promo.codes.search')}
          >
            {t('promo.codes.search')}
          </Searchbar>
        </Box>
        <Flex gap={2}>
          <Button variant="secondary" startIcon={<Plus />} onClick={() => setPanel(panel === 'one' ? 'none' : 'one')}>
            {t('promo.codes.addOne')}
          </Button>
          <Button variant="secondary" onClick={() => setPanel(panel === 'many' ? 'none' : 'many')}>
            {t('promo.codes.generate')}
          </Button>
          {canExport ? (
            <Button variant="tertiary" startIcon={<Download />} onClick={() => void exportCsv()}>
              {t('promo.codes.export')}
            </Button>
          ) : null}
        </Flex>
      </Flex>
      {panel !== 'none' ? (
        <Box background="neutral100" padding={4} hasRadius>
          <Grid.Root gap={4}>
            {panel === 'one' ? (
              <>
                <Grid.Item col={6} s={12}>
                  <Field.Root required error={errors.code}>
                    <Field.Label>{t('promo.codes.code')}</Field.Label>
                    <TextInput
                      value={one.code}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setOne({ ...one, code: event.target.value.toUpperCase() })
                      }
                    />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} s={12}>
                  <Field.Root error={errors.usageLimit} hint={t('promo.codes.limitHint')}>
                    <Field.Label>{t('promo.codes.limit')}</Field.Label>
                    <NumberInput
                      value={one.usageLimit}
                      onValueChange={(value?: number) => setOne({ ...one, usageLimit: value })}
                    />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </>
            ) : (
              <>
                <Grid.Item col={3} s={6}>
                  <Field.Root required error={errors['generate.count']} hint={t('promo.codes.countHint')}>
                    <Field.Label>{t('promo.codes.count')}</Field.Label>
                    <NumberInput value={many.count} onValueChange={(value?: number) => setMany({ ...many, count: value })} />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={3} s={6}>
                  <Field.Root error={errors['generate.prefix']}>
                    <Field.Label>{t('promo.codes.prefix')}</Field.Label>
                    <TextInput
                      value={many.prefix}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setMany({ ...many, prefix: event.target.value.toUpperCase() })
                      }
                    />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={2} s={6}>
                  <Field.Root error={errors['generate.length']} hint="8–16">
                    <Field.Label>{t('promo.codes.length')}</Field.Label>
                    <NumberInput value={many.length} onValueChange={(value?: number) => setMany({ ...many, length: value })} />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={2} s={6}>
                  <Field.Root error={errors['generate.usageLimit']}>
                    <Field.Label>{t('promo.codes.perCode')}</Field.Label>
                    <NumberInput value={many.usageLimit} onValueChange={(value?: number) => setMany({ ...many, usageLimit: value })} />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={2} s={6}>
                  <Field.Root>
                    <Field.Label>{t('promo.codes.batch')}</Field.Label>
                    <TextInput
                      value={many.batch}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMany({ ...many, batch: event.target.value })}
                    />
                  </Field.Root>
                </Grid.Item>
              </>
            )}
          </Grid.Root>
          <Flex justifyContent="flex-end" paddingTop={4}>
            <Button loading={busy} onClick={() => void submit()}>
              {panel === 'one' ? t('promo.codes.addOne') : t('promo.codes.generate')}
            </Button>
          </Flex>
        </Box>
      ) : null}
      {!rows ? (
        <Flex justifyContent="center" padding={6}>
          <Loader>{t('common.loading')}</Loader>
        </Flex>
      ) : rows.length === 0 ? (
        <Typography textColor="neutral600">{t('promo.codes.empty')}</Typography>
      ) : (
        <>
          <Table colCount={5} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['code', 'used', 'batch', 'active', 'created'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`promo.codes.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Typography style={{ fontFamily: 'monospace' }}>{row.code}</Typography>
                  </Td>
                  <Td>
                    <Typography>{`${row.usedCount} / ${row.usageLimit ?? '∞'}`}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.batch ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Switch
                      checked={row.active}
                      aria-label={t('promo.codes.col.active')}
                      onCheckedChange={(value: boolean) => void setActive(row, value)}
                    />
                  </Td>
                  <Td>
                    <Typography>{row.createdAt ? formatBusinessDate(row.createdAt.slice(0, 10)) : '—'}</Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <Flex justifyContent="space-between">
            <Typography variant="pi" textColor="neutral600">
              {t('promo.codes.total', { count: total })}
            </Typography>
            <Flex gap={2}>
              <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('common.previous')}
              </Button>
              <Button variant="tertiary" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>
                {t('common.next')}
              </Button>
            </Flex>
          </Flex>
        </>
      )}
    </Flex>
  );
};

const StatsTab = ({ promotionId, stats }: { promotionId: number; stats: Stats }) => {
  const t = useT();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const [rows, setRows] = useState<Redemption[] | null>(null);

  useEffect(() => {
    void get(`/ordering/promotions/${promotionId}/redemptions`)
      .then(({ data }) => setRows((data as { items: Redemption[] }).items))
      .catch((error: unknown) => toastError(error));
  }, [get, promotionId, toastError]);

  const cards: Array<[string, string]> = [
    [t('promo.stats.orders'), String(stats.orders)],
    [t('promo.stats.discount'), formatMoney(stats.discountTotal)],
    [t('promo.stats.revenue'), formatMoney(stats.revenue)],
    [t('promo.stats.reserved'), String(stats.reserved)],
  ];
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Grid.Root gap={4}>
        {cards.map(([label, value]) => (
          <Grid.Item key={label} col={3} s={6}>
            <Box background="neutral100" padding={4} hasRadius width="100%">
              <Typography variant="sigma" textColor="neutral600">
                {label}
              </Typography>
              <Typography variant="beta" tag="p">
                {value}
              </Typography>
            </Box>
          </Grid.Item>
        ))}
      </Grid.Root>
      {!rows ? (
        <Loader>{t('common.loading')}</Loader>
      ) : rows.length === 0 ? (
        <Typography textColor="neutral600">{t('promo.stats.empty')}</Typography>
      ) : (
        <Table colCount={6} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              {['order', 'date', 'branch', 'code', 'amount', 'status'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`promo.stats.col.${column}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Link to={`/plugins/ordering/orders/${row.orderId}`}>{row.orderCode}</Link>
                </Td>
                <Td>
                  <Typography>{formatBusinessDate(row.businessDate)}</Typography>
                </Td>
                <Td>
                  <Typography>{row.locationRef}</Typography>
                </Td>
                <Td>
                  <Typography>{row.code ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{formatMoney(-row.discountAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{t(`promo.redemption.${row.status}`)}</Typography>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Flex>
  );
};

/** K2 create/edit (+ K3 codes, K4 stats tabs once saved). */
export const PromotionEditor = () => {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const creating = id === undefined;
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [form, setForm] = useState<Form>(blank);
  const [saved, setSaved] = useState<PromotionRow | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pickerQ, setPickerQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: targetData }, detail] = await Promise.all([
        get('/ordering/promotions/targets'),
        creating ? Promise.resolve(null) : get(`/ordering/promotions/${id}`),
      ]);
      setTargets(targetData as Targets);
      if (detail) {
        const body = detail.data as { promotion: PromotionRow; stats: Stats };
        setSaved(body.promotion);
        setStats(body.stats);
        setForm(formOf(body.promotion));
      }
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      if (httpStatusOf(error) !== 404) toastError(error);
    }
  }, [creating, get, id, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const payload = (active: boolean) => ({
    name: { vi: form.nameVi, ...(form.nameEn.trim() ? { en: form.nameEn } : {}) },
    internalNote: form.internalNote.trim() || null,
    kind: form.kind,
    discountType: form.discountType,
    value: form.discountType === 'free-delivery' ? null : (form.value ?? null),
    maxDiscount: form.discountType === 'percent' ? (form.maxDiscount ?? null) : null,
    target: { kind: form.targetKind, refs: form.targetKind === 'order' ? [] : form.refs },
    minSubtotal: form.minSubtotal ?? 0,
    locationRefs: form.allBranches ? null : form.locationRefs,
    receiveKinds: form.receiveKinds,
    startsAt: fromLocalInput(form.startsAt) ?? new Date().toISOString(),
    endsAt: fromLocalInput(form.endsAt),
    weekdays: form.weekdays,
    timeRanges: form.timeRanges,
    firstOrderOnly: form.firstOrderOnly,
    customerGroups: groupCodes(form.customerGroups),
    usageLimit: form.usageLimit ?? null,
    perCustomerLimit: form.perCustomerLimit ?? null,
    stackable: form.stackable,
    priority: form.priority ?? 0,
    active,
    ...(creating && form.kind === 'code' && form.code.trim() ? { code: form.code.trim() } : {}),
  });

  const save = async (active: boolean) => {
    setSaving(true);
    setErrors({});
    try {
      const { data } = creating
        ? await post('/ordering/promotions', payload(active))
        : await put(`/ordering/promotions/${id}`, payload(active));
      const body = data as { promotion: PromotionRow; stats: Stats };
      toggleNotification({ type: 'success', message: t('promo.saved') });
      if (creating) {
        navigate(`../${body.promotion.id}`, { replace: true });
      } else {
        setSaved(body.promotion);
        setStats(body.stats);
      }
    } catch (error) {
      const fields = fieldErrors(error, t);
      setErrors(fields);
      if (Object.keys(fields).length === 0) toastError(error);
    } finally {
      setSaving(false);
    }
  };

  const pickerList = useMemo(() => {
    if (!targets || form.targetKind === 'order') return [];
    const list = form.targetKind === 'products' ? targets.products : targets.categories;
    const needle = fold(pickerQ.trim());
    return needle ? list.filter((item) => fold(item.title).includes(needle)) : list;
  }, [form.targetKind, pickerQ, targets]);

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status === 'error' || !targets) {
    return (
      <Layouts.Content>
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={t('common.error.title')}
          action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
        >
          {t('promo.loadFailed')}
        </Alert>
      </Layouts.Content>
    );
  }

  const summaryRow = {
    discountType: form.discountType,
    value: form.value ?? null,
    maxDiscount: form.maxDiscount ?? null,
    minSubtotal: form.minSubtotal ?? 0,
    locationRefs: form.allBranches ? null : form.locationRefs,
    receiveKinds: form.receiveKinds,
    firstOrderOnly: form.firstOrderOnly,
  };
  const period = `${form.startsAt ? form.startsAt.replace('T', ' ') : '…'} – ${form.endsAt ? form.endsAt.replace('T', ' ') : '…'}`;
  const summary = t('promo.summary', {
    discount: discountText(summaryRow, t),
    conditions: conditionText(summaryRow, t),
    period,
  });

  const settings = (
    <Grid.Root gap={4}>
      <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
        <Flex direction="column" alignItems="stretch" gap={4} width="100%">
          {saved && saved.usedCount > 0 ? (
            <Alert variant="default" closeLabel={t('common.close')} title={t('promo.usedNotice.title')}>
              {t('promo.usedNotice')}
            </Alert>
          ) : null}
          <Section title={t('promo.section.kind')}>
            <Choice
              options={['code', 'auto'] as const}
              value={form.kind}
              onChange={(value) => set('kind', value)}
              label={(value) => t(`promo.kind.${value}`)}
              disabled={!creating}
            />
          </Section>
          <Section title={t('promo.section.name')}>
            <Grid.Root gap={4}>
              <Grid.Item col={6} s={12}>
                <Field.Root required error={errors['name.vi'] ?? errors.name}>
                  <Field.Label>{t('promo.field.nameVi')}</Field.Label>
                  <TextInput value={form.nameVi} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('nameVi', event.target.value)} />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={6} s={12}>
                <Field.Root>
                  <Field.Label>{t('promo.field.nameEn')}</Field.Label>
                  <TextInput value={form.nameEn} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('nameEn', event.target.value)} />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={12}>
                <Field.Root>
                  <Field.Label>{t('promo.field.note')}</Field.Label>
                  <Textarea value={form.internalNote} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => set('internalNote', event.target.value)} />
                </Field.Root>
              </Grid.Item>
            </Grid.Root>
          </Section>
          <Section title={t('promo.section.discount')}>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Choice
                options={DISCOUNT_TYPES}
                value={form.discountType}
                onChange={(value) => set('discountType', value)}
                label={(value) => t(`promo.type.${value}`)}
              />
              {form.discountType !== 'free-delivery' ? (
                <Grid.Root gap={4}>
                  <Grid.Item col={6} s={12}>
                    <Field.Root required error={errors.value} hint={form.discountType === 'percent' ? '1–100 %' : t('promo.field.vnd')}>
                      <Field.Label>{t('promo.field.value')}</Field.Label>
                      <NumberInput value={form.value} onValueChange={(value?: number) => set('value', value)} />
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Grid.Item>
                  {form.discountType === 'percent' ? (
                    <Grid.Item col={6} s={12}>
                      <Field.Root error={errors.maxDiscount}>
                        <Field.Label>{t('promo.field.maxDiscount')}</Field.Label>
                        <NumberInput value={form.maxDiscount} onValueChange={(value?: number) => set('maxDiscount', value)} />
                        <Field.Error />
                      </Field.Root>
                    </Grid.Item>
                  ) : null}
                </Grid.Root>
              ) : null}
              {form.discountType === 'percent' || form.discountType === 'amount' ? (
                <Field.Root error={errors['target.refs']}>
                  <Field.Label>{t('promo.field.target')}</Field.Label>
                  <Choice
                    options={TARGET_KINDS}
                    value={form.targetKind}
                    onChange={(value) => {
                      set('targetKind', value);
                      set('refs', []);
                    }}
                    label={(value) => t(`promo.target.${value}`)}
                  />
                  {form.targetKind !== 'order' ? (
                    <Box paddingTop={3}>
                      <Searchbar
                        name="picker"
                        value={pickerQ}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPickerQ(event.target.value)}
                        onClear={() => setPickerQ('')}
                        clearLabel={t('common.clear')}
                        placeholder={t('promo.picker.search')}
                      >
                        {t('promo.picker.search')}
                      </Searchbar>
                      <Box paddingTop={2} style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {pickerList.map((item) => (
                          <Flex key={item.ref} gap={2} paddingTop={1}>
                            <Checkbox
                              checked={form.refs.includes(item.ref)}
                              onCheckedChange={() => set('refs', toggle(form.refs, item.ref))}
                              aria-label={item.title}
                            />
                            <Typography>{item.title}</Typography>
                          </Flex>
                        ))}
                      </Box>
                      <Typography variant="pi" textColor="neutral600">
                        {t('promo.picker.selected', { count: form.refs.length })}
                      </Typography>
                    </Box>
                  ) : null}
                  <Field.Error />
                </Field.Root>
              ) : null}
            </Flex>
          </Section>
          <Section title={t('promo.section.conditions')}>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Field.Root error={errors.minSubtotal}>
                <Field.Label>{t('promo.field.minSubtotal')}</Field.Label>
                <NumberInput value={form.minSubtotal} onValueChange={(value?: number) => set('minSubtotal', value)} />
                <Field.Error />
              </Field.Root>
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="pi" fontWeight="bold">
                  {t('promo.field.branches')}
                </Typography>
                <Flex gap={2}>
                  <Checkbox checked={form.allBranches} onCheckedChange={(value: boolean) => set('allBranches', value)} aria-label={t('promo.field.allBranches')} />
                  <Typography>{t('promo.field.allBranches')}</Typography>
                </Flex>
                {!form.allBranches
                  ? targets.branches.map((branch) => (
                      <Flex key={branch.code} gap={2} paddingLeft={6}>
                        <Checkbox
                          checked={form.locationRefs.includes(branch.code)}
                          onCheckedChange={() => set('locationRefs', toggle(form.locationRefs, branch.code))}
                          aria-label={branch.name}
                        />
                        <Typography>{`${branch.name} (${branch.code})`}</Typography>
                      </Flex>
                    ))
                  : null}
              </Flex>
              <Field.Root error={errors.receiveKinds}>
                <Field.Label>{t('promo.field.receive')}</Field.Label>
                <Flex gap={4}>
                  {(['pickup', 'delivery'] as const).map((kind) => (
                    <Flex key={kind} gap={2}>
                      <Checkbox
                        checked={form.receiveKinds.includes(kind)}
                        onCheckedChange={() => set('receiveKinds', toggle(form.receiveKinds, kind))}
                        aria-label={t(`promo.receive.${kind}`)}
                      />
                      <Typography>{t(`promo.receive.${kind}`)}</Typography>
                    </Flex>
                  ))}
                </Flex>
                <Field.Error />
              </Field.Root>
              <Flex gap={2}>
                <Checkbox checked={form.firstOrderOnly} onCheckedChange={(value: boolean) => set('firstOrderOnly', value)} aria-label={t('promo.field.firstOrder')} />
                <Typography>{t('promo.field.firstOrder')}</Typography>
              </Flex>
              <Field.Root error={errors.customerGroups} hint={t('promo.field.customerGroupsHint')}>
                <Field.Label>{t('promo.field.customerGroups')}</Field.Label>
                <TextInput value={form.customerGroups} onChange={(event: { target: { value: string } }) => set('customerGroups', event.target.value)} />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
            </Flex>
          </Section>
          <Section title={t('promo.section.time')}>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Grid.Root gap={4}>
                <Grid.Item col={6} s={12}>
                  <Field.Root required error={errors.startsAt}>
                    <Field.Label>{t('promo.field.startsAt')}</Field.Label>
                    <TextInput type="datetime-local" value={form.startsAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('startsAt', event.target.value)} />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
                <Grid.Item col={6} s={12}>
                  <Field.Root error={errors.endsAt}>
                    <Field.Label>{t('promo.field.endsAt')}</Field.Label>
                    <TextInput type="datetime-local" value={form.endsAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('endsAt', event.target.value)} />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </Grid.Root>
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="pi" fontWeight="bold">
                  {t('promo.field.weekdays')}
                </Typography>
                <Flex gap={2} wrap="wrap">
                  {WEEKDAYS.map((day) => (
                    <Button
                      key={day}
                      size="S"
                      variant={form.weekdays.includes(day) ? 'default' : 'tertiary'}
                      onClick={() => set('weekdays', toggle(form.weekdays, day))}
                    >
                      {t(`day.${day}`)}
                    </Button>
                  ))}
                </Flex>
                <Typography variant="pi" textColor="neutral600">
                  {t('promo.field.weekdaysHint')}
                </Typography>
              </Flex>
              <Field.Root error={errors.timeRanges}>
                <Field.Label>{t('promo.field.timeRanges')}</Field.Label>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  {form.timeRanges.map((range, index) => (
                    <Flex key={index} gap={2}>
                      <TextInput
                        type="time"
                        aria-label={t('promo.field.from')}
                        value={range.start}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          set('timeRanges', form.timeRanges.map((item, i) => (i === index ? { ...item, start: event.target.value } : item)))
                        }
                      />
                      <TextInput
                        type="time"
                        aria-label={t('promo.field.to')}
                        value={range.end}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          set('timeRanges', form.timeRanges.map((item, i) => (i === index ? { ...item, end: event.target.value } : item)))
                        }
                      />
                      <IconButton label={t('promo.field.removeRange')} variant="ghost" onClick={() => set('timeRanges', form.timeRanges.filter((_, i) => i !== index))}>
                        <Trash />
                      </IconButton>
                    </Flex>
                  ))}
                  {form.timeRanges.length < 3 ? (
                    <Box>
                      <Button size="S" variant="tertiary" startIcon={<Plus />} onClick={() => set('timeRanges', [...form.timeRanges, { start: '14:00', end: '17:00' }])}>
                        {t('promo.field.addRange')}
                      </Button>
                    </Box>
                  ) : null}
                </Flex>
                <Field.Error />
              </Field.Root>
            </Flex>
          </Section>
          <Section title={t('promo.section.limits')}>
            <Grid.Root gap={4}>
              <Grid.Item col={4} s={12}>
                <Field.Root error={errors.usageLimit} hint={t('promo.field.unlimited')}>
                  <Field.Label>{t('promo.field.usageLimit')}</Field.Label>
                  <NumberInput value={form.usageLimit} onValueChange={(value?: number) => set('usageLimit', value)} />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={4} s={12}>
                <Field.Root error={errors.perCustomerLimit}>
                  <Field.Label>{t('promo.field.perCustomer')}</Field.Label>
                  <NumberInput value={form.perCustomerLimit} onValueChange={(value?: number) => set('perCustomerLimit', value)} />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={4} s={12}>
                <Field.Root error={errors.priority}>
                  <Field.Label>{t('promo.field.priority')}</Field.Label>
                  <NumberInput value={form.priority} onValueChange={(value?: number) => set('priority', value)} />
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={12}>
                <Flex gap={2}>
                  <Checkbox checked={form.stackable} onCheckedChange={(value: boolean) => set('stackable', value)} aria-label={t('promo.field.stackable')} />
                  <Typography>{t('promo.field.stackable')}</Typography>
                </Flex>
              </Grid.Item>
            </Grid.Root>
          </Section>
          {creating && form.kind === 'code' ? (
            <Section title={t('promo.section.code')}>
              <Field.Root error={errors.code} hint={t('promo.field.codeHint')}>
                <Field.Label>{t('promo.codes.code')}</Field.Label>
                <TextInput value={form.code} onChange={(event: React.ChangeEvent<HTMLInputElement>) => set('code', event.target.value.toUpperCase())} />
                <Field.Hint />
                <Field.Error />
              </Field.Root>
            </Section>
          ) : null}
        </Flex>
      </Grid.Item>
      <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
        <Box background="primary100" padding={5} hasRadius style={{ position: 'sticky', top: 16 }} width="100%">
          <Typography variant="sigma" textColor="primary700">
            {t('promo.summary.title')}
          </Typography>
          <Box paddingTop={2}>
            <Typography>{summary}</Typography>
          </Box>
        </Box>
      </Grid.Item>
    </Grid.Root>
  );

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={creating ? t('promo.new') : saved?.name.vi ?? t('promo.edit')}
        primaryAction={
          creating ? (
            <Flex gap={2}>
              <Button variant="secondary" loading={saving} onClick={() => void save(false)}>
                {t('promo.saveDraft')}
              </Button>
              <Button loading={saving} onClick={() => void save(true)}>
                {t('promo.saveActive')}
              </Button>
            </Flex>
          ) : (
            <Button loading={saving} onClick={() => void save(saved?.active ?? true)}>
              {t('common.save')}
            </Button>
          )
        }
      />
      <Layouts.Content>
        {creating || !saved || !stats ? (
          settings
        ) : (
          <Tabs.Root defaultValue="settings">
            <Tabs.List aria-label={t('promo.title')}>
              <Tabs.Trigger value="settings">{t('promo.tab.settings')}</Tabs.Trigger>
              {saved.kind === 'code' ? <Tabs.Trigger value="codes">{t('promo.tab.codes')}</Tabs.Trigger> : null}
              <Tabs.Trigger value="stats">{t('promo.tab.stats')}</Tabs.Trigger>
            </Tabs.List>
            <Box marginTop={4}>
              <Tabs.Content value="settings">{settings}</Tabs.Content>
              {saved.kind === 'code' ? (
                <Tabs.Content value="codes">
                  <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
                    <CodesTab promotionId={saved.id} />
                  </Box>
                </Tabs.Content>
              ) : null}
              <Tabs.Content value="stats">
                <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
                  <StatsTab promotionId={saved.id} stats={stats} />
                </Box>
              </Tabs.Content>
            </Box>
          </Tabs.Root>
        )}
      </Layouts.Content>
    </>
  );
};
