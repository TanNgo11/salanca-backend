import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  NumberInput,
  Switch,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { useErrorToast } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type Kind = 'override' | 'adjust';
type Channel = 'pickup' | 'delivery' | 'dine-in' | 'staff';
type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type ListRow = {
  id: number;
  name: { vi: string; en?: string };
  kind: Kind;
  rules: {
    channels?: Channel[];
    locationRefs?: string[];
    customerGroups?: string[];
    weekdays?: Day[];
    timeRanges?: Array<{ start: string; end: string }>;
  };
  adjust: { type: 'percent' | 'amount'; value: number; target: { kind: 'all' | 'categories' | 'products'; refs: string[] } } | null;
  lines: Array<{ variantId: string; amount: number }>;
  priority: number;
  active: boolean;
  validFrom?: string | null;
  validTo?: string | null;
};

type Options = {
  branches: Array<{ code: string; name: string }>;
  categories: Array<{ ref: string; title: string }>;
  variants: Array<{ variantId: string; productId: string; title: string; productTitle: string; baseAmount: number | null }>;
  groups: Array<{ code: string; name: string }>;
};

const CHANNELS: Channel[] = ['pickup', 'delivery', 'dine-in', 'staff'];
const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const emptyForm = (): ListRow => ({
  id: 0,
  name: { vi: '' },
  kind: 'override',
  rules: { channels: [], locationRefs: [], customerGroups: [], weekdays: [], timeRanges: [] },
  adjust: { type: 'percent', value: 10, target: { kind: 'all', refs: [] } },
  lines: [],
  priority: 0,
  active: true,
});

const toggle = (values: string[] | undefined, value: string): string[] => {
  const current = values ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
};

const List = () => {
  const t = useT();
  const locale = useLocale();
  const { get, post } = useFetchClient();
  const toast = useErrorToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data } = await get('/ordering/price-lists');
      setRows((data as { items: ListRow[] }).items);
    } catch (error) {
      setFailed(true);
      setRows([]);
      toast(error);
    }
  }, [get, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: ListRow, active: boolean) => {
    try {
      await post(`/ordering/price-lists/${row.id}/active`, { active });
      await load();
    } catch (error) {
      toast(error);
    }
  };

  return (
    <>
      <Layouts.Header
        title={t('price.title')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('price.new')}
          </Button>
        }
      />
      <Layouts.Content>
        {rows === null ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t('common.loading')}</Loader>
          </Flex>
        ) : failed ? (
          <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
            {t('price.loadFailed')}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyStateLayout content={t('price.empty')} />
        ) : (
          <Table colCount={5} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['name', 'kind', 'when', 'priority', 'active'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`price.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const name = (locale === 'en' && row.name.en) || row.name.vi;
                const when = [
                  ...(row.rules.channels ?? []),
                  ...(row.rules.weekdays ?? []),
                  ...(row.rules.timeRanges ?? []).map((range) => `${range.start}–${range.end}`),
                ].join(' · ');
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link to={String(row.id)}>{name}</Link>
                    </Td>
                    <Td>
                      <Typography>{t(`price.kind.${row.kind}`)}</Typography>
                    </Td>
                    <Td>
                      <Typography>{when || t('price.any')}</Typography>
                    </Td>
                    <Td>
                      <Typography>{row.priority}</Typography>
                    </Td>
                    <Td>
                      <Switch
                        checked={row.active}
                        aria-label={t('price.col.active')}
                        onCheckedChange={(value: boolean) => void setActive(row, value)}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Layouts.Content>
    </>
  );
};

const Editor = () => {
  const t = useT();
  const { id } = useParams();
  const creating = !id;
  const { get, post, put } = useFetchClient();
  const toast = useErrorToast();
  const { toggleNotification } = useNotification();
  const navigate = useNavigate();
  const [form, setForm] = useState<ListRow>(emptyForm);
  const [options, setOptions] = useState<Options | null>(null);
  const [preview, setPreview] = useState<{ amount: number | null; winner: { name?: string; kind?: string } | null } | null>(null);
  const [probe, setProbe] = useState({ variantId: '', channel: '', locationRef: '', customerGroup: '', at: '' });

  useEffect(() => {
    let live = true;
    void get('/ordering/price-lists/options?locale=vi').then(({ data }) => {
      if (live) setOptions(data as Options);
    });
    if (id) {
      void get(`/ordering/price-lists/${id}`)
        .then(({ data }) => {
          if (live) setForm((data as { item: ListRow }).item);
        })
        .catch(toast);
    }
    return () => {
      live = false;
    };
  }, [get, id, toast]);

  const rules = form.rules ?? {};
  const range = rules.timeRanges?.[0] ?? { start: '', end: '' };
  const save = async () => {
    const body = {
      name: { vi: form.name.vi, ...(form.name.en ? { en: form.name.en } : {}) },
      kind: form.kind,
      rules: {
        channels: rules.channels ?? [],
        locationRefs: rules.locationRefs ?? [],
        customerGroups: rules.customerGroups ?? [],
        weekdays: rules.weekdays ?? [],
        timeRanges: range.start && range.end ? [{ start: range.start, end: range.end }] : [],
      },
      lines: form.kind === 'override' ? form.lines : [],
      adjust: form.kind === 'adjust' ? form.adjust : null,
      priority: form.priority,
      active: form.active,
      ...(form.validFrom ? { validFrom: form.validFrom } : {}),
      ...(form.validTo ? { validTo: form.validTo } : {}),
    };
    try {
      if (creating) await post('/ordering/price-lists', body);
      else await put(`/ordering/price-lists/${id}`, body);
      toggleNotification({ type: 'success', message: t('price.saved') });
      navigate('..');
    } catch (error) {
      toast(error);
    }
  };

  const runPreview = async () => {
    try {
      const { data } = await post('/ordering/price-preview', {
        variantId: probe.variantId,
        ...(probe.channel ? { channel: probe.channel } : {}),
        ...(probe.locationRef ? { locationRef: probe.locationRef } : {}),
        ...(probe.customerGroup ? { customerGroup: probe.customerGroup } : {}),
        ...(probe.at ? { at: new Date(probe.at).toISOString() } : {}),
      });
      setPreview(data as { amount: number | null; winner: { name?: string; kind?: string } | null });
    } catch (error) {
      toast(error);
    }
  };

  return (
    <>
      <Layouts.Header
        title={creating ? t('price.new') : form.name.vi || t('price.title')}
        navigationAction={
          <Link to="..">
            <ArrowLeft />
          </Link>
        }
        subtitle={t('price.back')}
        primaryAction={<Button onClick={() => void save()}>{t('price.save')}</Button>}
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Field.Root required>
            <Field.Label>{t('price.field.nameVi')}</Field.Label>
            <TextInput
              value={form.name.vi}
              onChange={(event: { target: { value: string } }) => setForm({ ...form, name: { ...form.name, vi: event.target.value } })}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('price.field.nameEn')}</Field.Label>
            <TextInput
              value={form.name.en ?? ''}
              onChange={(event: { target: { value: string } }) => setForm({ ...form, name: { ...form.name, en: event.target.value } })}
            />
          </Field.Root>
          <Flex gap={4}>
            <Button variant={form.kind === 'override' ? 'default' : 'tertiary'} onClick={() => setForm({ ...form, kind: 'override' })}>
              {t('price.kind.override')}
            </Button>
            <Button variant={form.kind === 'adjust' ? 'default' : 'tertiary'} onClick={() => setForm({ ...form, kind: 'adjust' })}>
              {t('price.kind.adjust')}
            </Button>
          </Flex>
          <Field.Root>
            <Field.Label>{t('price.field.priority')}</Field.Label>
            <NumberInput
              value={form.priority}
              min={0}
              max={1000}
              onValueChange={(value?: number) => setForm({ ...form, priority: value ?? 0 })}
            />
          </Field.Root>
          <Checkbox checked={form.active} onCheckedChange={(checked: boolean) => setForm({ ...form, active: checked === true })}>
            {t('price.field.active')}
          </Checkbox>
          <Typography variant="sigma">{t('price.field.channels')}</Typography>
          <Flex gap={4} wrap="wrap">
            {CHANNELS.map((channel) => (
              <Checkbox
                key={channel}
                checked={(rules.channels ?? []).includes(channel)}
                onCheckedChange={() => setForm({ ...form, rules: { ...rules, channels: toggle(rules.channels, channel) as Channel[] } })}
              >
                {t(`price.channel.${channel}`)}
              </Checkbox>
            ))}
          </Flex>
          <Typography variant="sigma">{t('price.field.branches')}</Typography>
          <Flex gap={4} wrap="wrap">
            {(options?.branches ?? []).map((branch) => (
              <Checkbox
                key={branch.code}
                checked={(rules.locationRefs ?? []).includes(branch.code)}
                onCheckedChange={() => setForm({ ...form, rules: { ...rules, locationRefs: toggle(rules.locationRefs, branch.code) } })}
              >
                {branch.name}
              </Checkbox>
            ))}
          </Flex>
          <Typography variant="sigma">{t('price.field.groups')}</Typography>
          <Flex gap={4} wrap="wrap">
            {(options?.groups ?? []).map((group) => (
              <Checkbox
                key={group.code}
                checked={(rules.customerGroups ?? []).includes(group.code)}
                onCheckedChange={() =>
                  setForm({ ...form, rules: { ...rules, customerGroups: toggle(rules.customerGroups, group.code) } })
                }
              >
                {group.name}
              </Checkbox>
            ))}
          </Flex>
          <Typography variant="sigma">{t('price.field.days')}</Typography>
          <Flex gap={3} wrap="wrap">
            {DAYS.map((day) => (
              <Checkbox
                key={day}
                checked={(rules.weekdays ?? []).includes(day)}
                onCheckedChange={() => setForm({ ...form, rules: { ...rules, weekdays: toggle(rules.weekdays, day) as Day[] } })}
              >
                {t(`day.${day}`)}
              </Checkbox>
            ))}
          </Flex>
          <Flex gap={4}>
            <Field.Root>
              <Field.Label>{t('price.field.fromTime')}</Field.Label>
              <TextInput
                value={range.start}
                placeholder="14:00"
                onChange={(event: { target: { value: string } }) =>
                  setForm({ ...form, rules: { ...rules, timeRanges: [{ start: event.target.value, end: range.end }] } })
                }
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('price.field.toTime')}</Field.Label>
              <TextInput
                value={range.end}
                placeholder="17:00"
                onChange={(event: { target: { value: string } }) =>
                  setForm({ ...form, rules: { ...rules, timeRanges: [{ start: range.start, end: event.target.value }] } })
                }
              />
            </Field.Root>
          </Flex>
          {form.kind === 'override' ? (
            <Box>
              <Typography variant="sigma">{t('price.field.lines')}</Typography>
              {form.lines.map((line, index) => (
                <Flex key={`${line.variantId}-${index}`} gap={2} paddingTop={2}>
                  <TextInput
                    value={line.variantId}
                    onChange={(event: { target: { value: string } }) => {
                      const lines = [...form.lines];
                      lines[index] = { ...line, variantId: event.target.value };
                      setForm({ ...form, lines });
                    }}
                  />
                  <NumberInput
                    value={line.amount}
                    min={0}
                    onValueChange={(value?: number) => {
                      const lines = [...form.lines];
                      lines[index] = { ...line, amount: value ?? 0 };
                      setForm({ ...form, lines });
                    }}
                  />
                </Flex>
              ))}
              <Box paddingTop={2}>
                <Button
                  variant="tertiary"
                  onClick={() => setForm({ ...form, lines: [...form.lines, { variantId: options?.variants[0]?.variantId ?? '', amount: 0 }] })}
                >
                  {t('price.field.addLine')}
                </Button>
              </Box>
            </Box>
          ) : (
            <Flex gap={4}>
              <Button
                variant={form.adjust?.type === 'percent' ? 'default' : 'tertiary'}
                onClick={() => setForm({ ...form, adjust: { ...(form.adjust ?? { value: 10, target: { kind: 'all', refs: [] } }), type: 'percent' } })}
              >
                {t('price.adjust.percent')}
              </Button>
              <Button
                variant={form.adjust?.type === 'amount' ? 'default' : 'tertiary'}
                onClick={() => setForm({ ...form, adjust: { ...(form.adjust ?? { value: 1000, target: { kind: 'all', refs: [] } }), type: 'amount' } })}
              >
                {t('price.adjust.amount')}
              </Button>
              <NumberInput
                value={form.adjust?.value ?? 0}
                min={1}
                onValueChange={(value?: number) =>
                  setForm({
                    ...form,
                    adjust: {
                      type: form.adjust?.type ?? 'percent',
                      value: value ?? 1,
                      target: form.adjust?.target ?? { kind: 'all', refs: [] },
                    },
                  })
                }
              />
            </Flex>
          )}
          <Box paddingTop={4}>
            <Typography variant="delta">{t('price.preview.title')}</Typography>
            <Flex gap={2} paddingTop={2}>
              <TextInput
                aria-label={t('price.preview.variant')}
                placeholder={t('price.preview.variant')}
                value={probe.variantId}
                onChange={(event: { target: { value: string } }) => setProbe({ ...probe, variantId: event.target.value })}
              />
              <TextInput
                aria-label={t('price.preview.channel')}
                placeholder={t('price.preview.channel')}
                value={probe.channel}
                onChange={(event: { target: { value: string } }) => setProbe({ ...probe, channel: event.target.value })}
              />
              <TextInput
                aria-label={t('price.preview.branch')}
                placeholder={t('price.preview.branch')}
                value={probe.locationRef}
                onChange={(event: { target: { value: string } }) => setProbe({ ...probe, locationRef: event.target.value })}
              />
              <TextInput
                aria-label={t('price.preview.group')}
                placeholder={t('price.preview.group')}
                value={probe.customerGroup}
                onChange={(event: { target: { value: string } }) => setProbe({ ...probe, customerGroup: event.target.value })}
              />
              <Button onClick={() => void runPreview()}>{t('price.preview.run')}</Button>
            </Flex>
            {preview ? (
              <Typography>
                {preview.amount == null ? t('price.preview.none') : formatMoney(preview.amount)}
                {' · '}
                {preview.winner?.name || t('price.preview.base')}
              </Typography>
            ) : null}
          </Box>
        </Flex>
      </Layouts.Content>
    </>
  );
};

const PriceListsPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.price}>
      <Page.Title>{t('price.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<List />} />
          <Route path="new" element={<Editor />} />
          <Route path=":id" element={<Editor />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default PriceListsPage;
