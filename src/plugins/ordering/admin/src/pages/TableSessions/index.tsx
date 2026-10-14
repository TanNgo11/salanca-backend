import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Loader,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useSearchParams } from 'react-router-dom';

import { formatMoney, formatTime, minutesSince } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { adminBase } from '../../lib/print';
import { RBAC_TABLES } from '../../lib/permissions';

type SessionOrder = {
  id: number;
  code: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  due: number;
  groupStatus: string | null;
  placedAt: string;
};

type SessionItem = {
  id: number;
  status: string;
  locationRef: string;
  openedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  businessDate: string;
  staleOpen: boolean;
  table: { id: number; code: string; name: string; area: string | null } | null;
  orderCount: number;
  awaitingAcceptance: number;
  total: number;
  captured: number;
  due: number;
  orders: SessionOrder[];
};

type TableItem = {
  id: number;
  code: string;
  name: string;
  area: string | null;
  locationRef: string;
  active: boolean;
};

const httpStatusOf = (error: unknown): number | null =>
  (error as { response?: { status?: number } })?.response?.status ?? null;

const errorBodyOf = (error: unknown): { code?: string; details?: { orders?: string[] } } | null =>
  (error as { response?: { data?: { error?: { code?: string; details?: { orders?: string[] } } } } })
    ?.response?.data?.error ?? null;

/**
 * N7 (`/plugins/ordering/table-sessions`, `table.manage`): the live floor — grey cards for
 * free tables, serving cards for open sessions (orange border while an order awaits
 * acceptance, red when the session outlived its business day). The card opens the session
 * panel with its orders and "Thanh toán & đóng bàn" — cash or a witnessed counter transfer.
 */
const TableSessionsPage = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const rbac = useRBAC(RBAC_TABLES);
  const [params, setParams] = useSearchParams();
  const allowed = !rbac.isLoading && Object.values(rbac.allowedActions).some(Boolean);

  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [tables, setTables] = useState<TableItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<SessionItem | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [method, setMethod] = useState<'cash' | 'transfer-at-counter'>('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocking, setBlocking] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const branch = params.get('branch') ?? '';
  const showClosed = params.get('status') === 'closed';

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ status: showClosed ? 'closed' : 'open' });
      if (branch) qs.set('branch', branch);
      const [{ data: sessionData }, { data: tableData }] = await Promise.all([
        get(`/ordering/table-sessions?${qs}`),
        get(`/ordering/tables${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`),
      ]);
      setSessions((sessionData as { items: SessionItem[] }).items);
      setTables((tableData as { items: TableItem[] }).items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [branch, get, showClosed]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const branches = useMemo(
    () =>
      [...new Set([
        ...(sessions ?? []).map((row) => row.locationRef),
        ...(tables ?? []).map((row) => row.locationRef),
      ])].sort(),
    [sessions, tables],
  );

  const busyTableIds = useMemo(
    () => new Set((sessions ?? []).filter((row) => row.status === 'open').map((row) => row.table?.id)),
    [sessions],
  );
  const freeTables = useMemo(
    () =>
      (tables ?? []).filter(
        (table) => table.active && !busyTableIds.has(table.id) && (!branch || table.locationRef === branch),
      ),
    [branch, busyTableIds, tables],
  );

  const setBranch = (code: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (code) next.set('branch', code);
      else next.delete('branch');
      return next;
    });

  const printSession = (session: SessionItem) => {
    window.open(
      `${adminBase()}/plugins/ordering/print/session/${session.id}?doc=receipt&autoprint=1`,
      '_blank',
      'noopener',
    );
  };

  const close = async () => {
    if (!selected) return;
    setBusy(true);
    setBlocking(null);
    try {
      await post(`/ordering/table-sessions/${selected.id}/close`, {
        method,
        ...(method === 'transfer-at-counter' && reference.trim() ? { reference: reference.trim() } : {}),
      });
      setCloseOpen(false);
      setSelected(null);
      setNotice(t('tables.session.closed'));
      await load();
    } catch (error) {
      const body = errorBodyOf(error);
      if (httpStatusOf(error) === 409 && body?.code === 'TABLE_SESSION_UNFINISHED') {
        setBlocking(body.details?.orders ?? []);
      } else {
        setBlocking([]);
      }
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

  return (
    <>
      <Layouts.Header
        title={t('sessions.title')}
        subtitle={t('sessions.subtitle', { branch: branch || t('common.all') })}
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
          <Field.Root>
            <Field.Label>{t('sessions.filter.status')}</Field.Label>
            <SingleSelect
              value={showClosed ? 'closed' : 'open'}
              onChange={(value: string | number) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  if (value === 'closed') next.set('status', 'closed');
                  else next.delete('status');
                  return next;
                })
              }
            >
              <SingleSelectOption value="open">{t('sessions.open')}</SingleSelectOption>
              <SingleSelectOption value="closed">{t('sessions.closed')}</SingleSelectOption>
            </SingleSelect>
          </Field.Root>
        </Flex>
        {failed ? (
          <Alert variant="danger" closeLabel={t('common.close')}>
            {t('tables.loadFailed')}
          </Alert>
        ) : sessions === null ? (
          <Loader />
        ) : (
          <Grid.Root gap={4}>
            {sessions.map((session) => (
              <Grid.Item key={session.id} col={4} s={6} xs={12}>
                <button
                  type="button"
                  className="session-card"
                  onClick={() => setSelected(session)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 12,
                    border: `2px solid ${
                      session.staleOpen ? '#d02b20' : session.awaitingAcceptance > 0 ? '#d9822b' : '#dcdce4'
                    }`,
                    background: session.staleOpen ? '#fdf0ef' : '#ffffff',
                    padding: 14,
                  }}
                >
                  <Flex justifyContent="space-between" alignItems="flex-start">
                    <Typography variant="beta">
                      {session.table ? `${session.table.name} · ${session.table.code}` : `#${session.id}`}
                    </Typography>
                    <Badge>{t('sessions.open')}</Badge>
                  </Flex>
                  {session.table?.area ? (
                    <Typography variant="pi" textColor="neutral500">
                      {session.table.area}
                    </Typography>
                  ) : null}
                  <Typography variant="pi" textColor="neutral600">
                    {t('tables.session.openedAt', { time: formatTime(session.openedAt) })} ·{' '}
                    {t('tables.session.orders', { count: session.orderCount })}
                  </Typography>
                  <Flex justifyContent="space-between" paddingTop={2}>
                    <Typography fontWeight="semiBold">
                      {t('tables.session.total', { amount: formatMoney(session.total) })}
                    </Typography>
                    {session.due > 0 ? (
                      <Typography textColor="danger600" fontWeight="semiBold">
                        {t('tables.session.unpaid', { amount: formatMoney(session.due) })}
                      </Typography>
                    ) : null}
                  </Flex>
                  {session.awaitingAcceptance > 0 ? (
                    <Typography variant="pi" textColor="warning700">
                      {t('sessions.awaiting', { count: session.awaitingAcceptance })}
                    </Typography>
                  ) : null}
                  {session.staleOpen ? (
                    <Typography variant="pi" textColor="danger600" fontWeight="bold">
                      {t('sessions.stale')}
                    </Typography>
                  ) : null}
                </button>
              </Grid.Item>
            ))}
            {!showClosed
              ? freeTables.map((table) => (
                  <Grid.Item key={`free-${table.id}`} col={4} s={6} xs={12}>
                    <Box
                      borderRadius="12px"
                      borderStyle="dashed"
                      borderWidth="2px"
                      borderColor="neutral300"
                      background="neutral100"
                      padding={4}
                    >
                      <Flex justifyContent="space-between" alignItems="flex-start">
                        <Typography variant="beta" textColor="neutral500">
                          {table.name} · {table.code}
                        </Typography>
                        <Badge>{t('tables.session.none')}</Badge>
                      </Flex>
                      {table.area ? (
                        <Typography variant="pi" textColor="neutral400">
                          {table.area}
                        </Typography>
                      ) : null}
                    </Box>
                  </Grid.Item>
                ))
              : null}
            {sessions.length === 0 && freeTables.length === 0 ? (
              <Typography variant="pi" textColor="neutral500">
                {t('sessions.empty')}
              </Typography>
            ) : null}
          </Grid.Root>
        )}
      </Layouts.Content>

      <Dialog.Root open={selected !== null} onOpenChange={() => setSelected(null)}>
        <Dialog.Content>
          <Dialog.Header>
            {selected?.table ? `${selected.table.name} · ${selected.table.code}` : `#${selected?.id}`}
          </Dialog.Header>
          <Dialog.Body>
            {selected ? (
              <Flex direction="column" gap={3} alignItems="stretch">
                <Typography variant="pi" textColor="neutral600">
                  {t('tables.session.openedAt', { time: formatTime(selected.openedAt) })}
                  {' · '}
                  {minutesSince(selected.openedAt)}
                  {t('sessions.minutesAgo')}
                </Typography>
                {(selected.orders ?? []).map((order) => (
                  <Flex key={order.id} justifyContent="space-between" alignItems="center">
                    <Flex gap={2} alignItems="center">
                      <Typography fontWeight="semiBold">#{order.code}</Typography>
                      <Badge>{order.groupStatus ?? order.status}</Badge>
                    </Flex>
                    <Flex gap={3}>
                      <Typography>{formatMoney(order.totalAmount)}</Typography>
                      {order.due > 0 ? (
                        <Typography textColor="danger600">{formatMoney(order.due)}</Typography>
                      ) : null}
                    </Flex>
                  </Flex>
                ))}
                <Flex justifyContent="space-between" paddingTop={3} style={{ borderTop: '1px solid #dcdce4' }}>
                  <Typography fontWeight="bold">{t('detail.total')}</Typography>
                  <Typography fontWeight="bold">{formatMoney(selected.total)}</Typography>
                </Flex>
                <Flex justifyContent="space-between">
                  <Typography>{t('sessions.paid')}</Typography>
                  <Typography>{formatMoney(selected.captured)}</Typography>
                </Flex>
                <Flex justifyContent="space-between">
                  <Typography fontWeight="semiBold">{t('detail.due')}</Typography>
                  <Typography fontWeight="semiBold" textColor={selected.due > 0 ? 'danger600' : 'success600'}>
                    {formatMoney(selected.due)}
                  </Typography>
                </Flex>
              </Flex>
            ) : null}
          </Dialog.Body>
          <Dialog.Footer>
            <Flex gap={2} justifyContent="flex-end" width="100%">
              <Button variant="tertiary" onClick={() => selected && printSession(selected)}>
                {t('sessions.printBill')}
              </Button>
              {selected?.status === 'open' ? (
                <Button onClick={() => { setBlocking(null); setCloseOpen(true); }}>
                  {t('tables.session.close')}
                </Button>
              ) : null}
            </Flex>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={closeOpen} onOpenChange={setCloseOpen}>
        <Dialog.Content>
          <Dialog.Header>{t('sessions.closeTitle')}</Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" gap={3} alignItems="stretch">
              {blocking ? (
                <Alert variant="danger" closeLabel={t('common.close')} onClose={() => setBlocking(null)}>
                  {blocking.length > 0
                    ? t('sessions.blocking', { orders: blocking.join(', ') })
                    : t('sessions.closeFailed')}
                </Alert>
              ) : null}
              {selected ? (
                <Typography>
                  {t('sessions.closeBody', { amount: formatMoney(selected.due) })}
                </Typography>
              ) : null}
              <Field.Root>
                <Field.Label>{t('session.method')}</Field.Label>
                <SingleSelect
                  value={method}
                  onChange={(value: string | number) =>
                    setMethod(value === 'transfer-at-counter' ? 'transfer-at-counter' : 'cash')
                  }
                >
                  <SingleSelectOption value="cash">{t('sessions.cash')}</SingleSelectOption>
                  <SingleSelectOption value="transfer-at-counter">
                    {t('sessions.transfer')}
                  </SingleSelectOption>
                </SingleSelect>
              </Field.Root>
              {method === 'transfer-at-counter' ? (
                <Field.Root>
                  <Field.Label>{t('sessions.reference')}</Field.Label>
                  <TextInput
                    value={reference}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReference(e.target.value)}
                    placeholder={t('sessions.referenceHint')}
                  />
                </Field.Root>
              ) : null}
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy} onClick={() => void close()}>
                {t('sessions.confirmClose')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default TableSessionsPage;
