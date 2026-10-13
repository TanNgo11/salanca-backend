import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Table as DsTable,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useSearchParams } from 'react-router-dom';

import { useT } from '../../lib/i18n';
import { RBAC_TABLES } from '../../lib/permissions';

type TableItem = {
  id: number;
  locationRef: string;
  code: string;
  name: string;
  area: string | null;
  seats: number | null;
  active: boolean;
  qrUrl: string | null;
};

const httpStatusOf = (error: unknown): number | null =>
  (error as { response?: { status?: number } })?.response?.status ?? null;

const errorCodeOf = (error: unknown): string | null =>
  (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code ??
  null;

/** Download the admin QR SVG as a file (staff sticks it on the table). */
const downloadQr = async (get: (url: string) => Promise<{ data: unknown }>, table: TableItem) => {
  const { data } = await get(`/ordering/tables/${table.id}/qr.svg`);
  const blob = new Blob([String(data)], { type: 'image/svg+xml' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `table-${table.code}.svg`;
  link.click();
  URL.revokeObjectURL(link.href);
};

/**
 * N6 (`/plugins/ordering/tables`, `table.manage`): the branch's floor plan — create one table
 * or a B1…Bn range, toggle active, download/print the QR card, rotate the secret. Rotating
 * kills the old link instantly; the printed card just stops resolving.
 */
const TablesPage = () => {
  const t = useT();
  const { get, post, put } = useFetchClient();
  const rbac = useRBAC(RBAC_TABLES);
  const [params, setParams] = useSearchParams();
  const allowed = !rbac.isLoading && Object.values(rbac.allowedActions).some(Boolean);

  const [items, setItems] = useState<TableItem[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rotate, setRotate] = useState<TableItem | null>(null);
  const [busy, setBusy] = useState(false);
  const branch = params.get('branch') ?? '';

  const [form, setForm] = useState({ code: '', name: '', area: '', seats: '' });
  const [bulk, setBulk] = useState({ prefix: 'B', from: '1', to: '10', area: '', seats: '' });

  const load = useCallback(async () => {
    try {
      const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
      const { data } = await get(`/ordering/tables${qs}`);
      setItems((data as { items: TableItem[] }).items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [branch, get]);

  useEffect(() => {
    void load();
  }, [load]);

  const branches = useMemo(
    () => [...new Set((items ?? []).map((item) => item.locationRef))].sort(),
    [items],
  );
  const shown = useMemo(
    () => (items ?? []).filter((item) => !branch || item.locationRef === branch),
    [branch, items],
  );

  const setBranch = (code: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (code) next.set('branch', code);
      else next.delete('branch');
      return next;
    });

  const createOne = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/ordering/tables', {
        locationRef: branch || branches[0],
        code: form.code,
        name: form.name,
        area: form.area || null,
        seats: form.seats === '' ? null : Number(form.seats),
      });
      setAddOpen(false);
      setForm({ code: '', name: '', area: '', seats: '' });
      setNotice(t('tables.saved'));
      await load();
    } catch (err) {
      setError(t(`error.${errorCodeOf(err) ?? 'TABLE_NOT_FOUND'}`));
    } finally {
      setBusy(false);
    }
  };

  const createBulk = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await post('/ordering/tables', {
        locationRef: branch || branches[0],
        bulk: {
          prefix: bulk.prefix,
          from: Number(bulk.from),
          to: Number(bulk.to),
          area: bulk.area || null,
          seats: bulk.seats === '' ? null : Number(bulk.seats),
        },
      });
      setBulkOpen(false);
      setNotice(t('tables.saved'));
      setItems((items ?? []).concat((data as { items: TableItem[] }).items));
      await load();
    } catch (err) {
      setError(t(`error.${errorCodeOf(err) ?? 'TABLE_NOT_FOUND'}`));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (table: TableItem) => {
    await put(`/ordering/tables/${table.id}`, { active: !table.active });
    await load();
  };

  const printCard = async (table: TableItem) => {
    const { data } = await get(`/ordering/tables/${table.id}/qr.svg`);
    const svg = String(data);
    const doc = `<!doctype html><html><head><title>${table.code}</title>
      <style>@page{size:A6;margin:8mm}body{font-family:sans-serif;text-align:center}svg{width:80mm;height:80mm}h1{font-size:32px;margin:6mm 0 2mm}p{margin:2mm}</style>
      </head><body>${svg}<h1>${table.name} (${table.code})</h1><p>${t('tables.cardHint')}</p>
      <script>window.onload=()=>{window.print();}</script></body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
  };

  const confirmRotate = async () => {
    if (!rotate) return;
    setBusy(true);
    try {
      await post(`/ordering/tables/${rotate.id}/rotate-qr`, {});
      setNotice(t('tables.rotated'));
      setRotate(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!allowed && !rbac.isLoading) {
    return (
      <Layouts.Content>
        <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
          {t('common.forbidden.body')}
        </Alert>
      </Layouts.Content>
    );
  }

  const targetBranch = branch || branches[0] || '';

  return (
    <>
      <Layouts.Header
        title={t('tables.title')}
        subtitle={t('tables.subtitle', { branch: branch || t('common.all') })}
        primaryAction={
          <Flex gap={2}>
            <Button variant="tertiary" disabled={!targetBranch} onClick={() => setBulkOpen(true)}>
              {t('tables.addMany')}
            </Button>
            <Button disabled={!targetBranch} onClick={() => setAddOpen(true)}>
              {t('tables.new')}
            </Button>
          </Flex>
        }
      />
      <Layouts.Content>
        {notice ? (
          <Alert variant="success" closeLabel={t('common.close')} onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : null}
        <Flex gap={3} alignItems="flex-end" paddingBottom={4}>
          <Field.Root>
            <Field.Label>{t('orders.filter.branch')}</Field.Label>
            <SingleSelect value={branch} onChange={(value: string | number) => setBranch(String(value))}>
              <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
              {branches.map((code) => (
                <SingleSelectOption key={code} value={code}>
                  {code}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Flex>
        {status === 'error' ? (
          <Alert variant="danger" closeLabel={t('common.close')}>
            {t('tables.loadFailed')}
          </Alert>
        ) : shown === null ? (
          <Loader />
        ) : shown.length === 0 ? (
          <Typography variant="pi" textColor="neutral500">
            {t('tables.empty')}
          </Typography>
        ) : (
          <DsTable colCount={7} rowCount={shown.length}>
            <Thead>
              <Tr>
                <Th>{t('tables.code')}</Th>
                <Th>{t('tables.name')}</Th>
                <Th>{t('tables.zone')}</Th>
                <Th>{t('tables.seats')}</Th>
                <Th>{t('orders.filter.branch')}</Th>
                <Th>{t('tables.active')}</Th>
                <Th>{t('tables.qr')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {shown.map((table) => (
                <Tr key={table.id}>
                  <Td>
                    <Badge>{table.code}</Badge>
                  </Td>
                  <Td>
                    <Typography>{table.name}</Typography>
                  </Td>
                  <Td>
                    <Typography>{table.area ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{table.seats ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{table.locationRef}</Typography>
                  </Td>
                  <Td>
                    <Switch
                      checked={table.active}
                      onCheckedChange={() => void toggleActive(table)}
                      visibleLabels
                    />
                  </Td>
                  <Td>
                    <Flex gap={2}>
                      <Button size="S" variant="tertiary" onClick={() => void downloadQr(get, table)}>
                        {t('tables.downloadQr')}
                      </Button>
                      <Button size="S" variant="tertiary" onClick={() => void printCard(table)}>
                        {t('tables.printCard')}
                      </Button>
                      <Button size="S" variant="tertiary" onClick={() => setRotate(table)}>
                        {t('tables.rotate')}
                      </Button>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </DsTable>
        )}
      </Layouts.Content>

      <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
        <Dialog.Content>
          <Dialog.Header>{t('tables.new')}</Dialog.Header>
          <Dialog.Body>
            {error ? (
              <Alert variant="danger" closeLabel={t('common.close')} onClose={() => setError(null)}>
                {error}
              </Alert>
            ) : null}
            <Flex direction="column" gap={3} alignItems="stretch">
              <Field.Root>
                <Field.Label>{t('tables.code')}</Field.Label>
                <TextInput
                  value={form.code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, code: e.target.value })
                  }
                  placeholder="B5"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('tables.name')}</Field.Label>
                <TextInput
                  value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Bàn 5"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('tables.zone')}</Field.Label>
                <TextInput
                  value={form.area}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, area: e.target.value })
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('tables.seats')}</Field.Label>
                <TextInput
                  value={form.seats}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, seats: e.target.value })
                  }
                  placeholder="4"
                />
              </Field.Root>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy} disabled={!form.code.trim() || !form.name.trim()} onClick={() => void createOne()}>
                {t('common.save')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={bulkOpen} onOpenChange={setBulkOpen}>
        <Dialog.Content>
          <Dialog.Header>{t('tables.addMany')}</Dialog.Header>
          <Dialog.Body>
            {error ? (
              <Alert variant="danger" closeLabel={t('common.close')} onClose={() => setError(null)}>
                {error}
              </Alert>
            ) : null}
            <Flex direction="column" gap={3} alignItems="stretch">
              <Flex gap={3}>
                <Field.Root>
                  <Field.Label>{t('tables.prefix')}</Field.Label>
                  <TextInput
                    value={bulk.prefix}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setBulk({ ...bulk, prefix: e.target.value })
                    }
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t('tables.from')}</Field.Label>
                  <TextInput
                    value={bulk.from}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setBulk({ ...bulk, from: e.target.value })
                    }
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t('tables.to')}</Field.Label>
                  <TextInput
                    value={bulk.to}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setBulk({ ...bulk, to: e.target.value })
                    }
                  />
                </Field.Root>
              </Flex>
              <Field.Root>
                <Field.Label>{t('tables.zone')}</Field.Label>
                <TextInput
                  value={bulk.area}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBulk({ ...bulk, area: e.target.value })
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('tables.seats')}</Field.Label>
                <TextInput
                  value={bulk.seats}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBulk({ ...bulk, seats: e.target.value })
                  }
                />
              </Field.Root>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy} onClick={() => void createBulk()}>
                {t('common.save')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={rotate !== null} onOpenChange={() => setRotate(null)}>
        <Dialog.Content>
          <Dialog.Header>{t('tables.rotateTitle')}</Dialog.Header>
          <Dialog.Body>
            <Typography>{t('tables.rotateBody', { code: rotate?.code ?? '' })}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="danger" loading={busy} onClick={() => void confirmRotate()}>
                {t('tables.rotate')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default TablesPage;
