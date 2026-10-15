import { useCallback, useEffect, useState } from 'react';
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
  VisuallyHidden,
} from '@strapi/design-system';
import { Layouts, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link, useParams } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import CustomerLoyalty from '../Loyalty/CustomerLoyalty';

type Customer = {
  id: string;
  name: string | null;
  status: string;
  phoneMasked: string | null;
  emailMasked: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
  averageOrder: number;
  lastOrderAt: string | null;
  marketingConsent: {
    granted?: boolean;
    at?: string;
    source?: string;
    policyVersion?: string;
    history?: Array<{ granted?: boolean; at?: string; source?: string; policyVersion?: string }>;
  } | null;
  staffNote: string | null;
};

type OrderRow = {
  id: number;
  code: string;
  status: string;
  paymentStatus: string;
  total: number;
  placedAt: string;
  locationRef: string;
};

type AddressRow = {
  label: string | null;
  recipientName: string | null;
  phoneMasked: string | null;
  line1: string;
  wardName: string | null;
  provinceName: string | null;
  isDefault: boolean;
};

type RequestRow = {
  id: string;
  kind: string;
  source: string;
  status: string;
  requestedAt: string;
  doneAt: string | null;
  handledBy: string | null;
  note: string | null;
};

type DetailBody = {
  customer: Customer;
  orders: OrderRow[];
  addresses: AddressRow[];
  requests: RequestRow[];
};

type Tab = 'orders' | 'addresses' | 'consent' | 'requests' | 'loyalty';

const statusTone = (status: string): Record<string, string> =>
  status === 'active'
    ? { textColor: 'success700', backgroundColor: 'success100' }
    : status === 'erased'
      ? { textColor: 'danger700', backgroundColor: 'danger100' }
      : {};

/**
 * C2: one customer — masked identity with a logged "Hiện số" reveal, stats, orders, the
 * read-only address book, the consent trail, and the customer's Decree 13 request history.
 * Staff actions: name/note edit, JSON export, and a staff-filed erasure request.
 */
export const CustomerDetailPage = () => {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const manageRbac = useRBAC(PERMISSIONS.customerManage);
  const eraseRbac = useRBAC(PERMISSIONS.dataRequest);
  const canManage = Object.values(manageRbac.allowedActions).some(Boolean);
  const canErase = Object.values(eraseRbac.allowedActions).some(Boolean);

  const [body, setBody] = useState<DetailBody | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [tab, setTab] = useState<Tab>('orders');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [name, setName] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await get(`/ordering/customers/${id}`);
      const detail = data as DetailBody;
      setBody(detail);
      setName(detail.customer.name ?? '');
      setStaffNote(detail.customer.staffNote ?? '');
      setState('ready');
    } catch (error) {
      setState(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [get, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reveal = async () => {
    try {
      const { data } = await post(`/ordering/customers/${id}/reveal-phone`, {});
      setRevealed((data as { phone: string | null }).phone);
      toggleNotification({ type: 'info', message: t('customers.detail.revealed') });
    } catch (error) {
      toastError(error);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await put(`/ordering/customers/${id}`, { name, staffNote });
      setBody(data as DetailBody);
      setEditOpen(false);
      toggleNotification({ type: 'success', message: t('customers.detail.edit.saved') });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const { data } = await get(`/ordering/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `khach-hang-${id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toggleNotification({ type: 'success', message: t('customers.detail.exportDone') });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const requestErase = async () => {
    setBusy(true);
    try {
      await post('/ordering/data-requests', { customerId: id, kind: 'erase' });
      setEraseOpen(false);
      toggleNotification({ type: 'success', message: t('customers.detail.erase.created') });
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading' && !body) {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (state === 'scope' || state === 'error' || !body) {
    return (
      <Alert
        variant="danger"
        closeLabel={t('common.close')}
        title={state === 'scope' ? t('common.forbidden.title') : t('common.error.title')}
        action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
      >
        {t('customers.detail.loadFailed')}
      </Alert>
    );
  }

  const { customer, orders, addresses, requests } = body;
  const consentTrail = [
    ...(customer.marketingConsent && customer.marketingConsent.granted !== undefined
      ? [customer.marketingConsent]
      : []),
    ...(customer.marketingConsent?.history ?? []),
  ];
  // `orderCount` counts completed orders — the ones the erasure anonymizes.
  const closedOrders = customer.orderCount;

  return (
    <>
      <Layouts.Header
        title={customer.name ?? t('customers.noName')}
        subtitle={[
          customer.phoneMasked ?? '—',
          customer.emailMasked ?? '—',
          `${t('customers.detail.created')}: ${formatDateTime(customer.createdAt)}`,
        ].join(' · ')}
        navigationAction={<Link to="/plugins/ordering/customers">{t('common.back')}</Link>}
        primaryAction={
          <Flex gap={2}>
            {canManage ? (
              <Button variant="tertiary" onClick={() => setEditOpen(true)}>
                {t('customers.detail.edit')}
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="secondary" loading={busy} onClick={() => void download()}>
                {t('customers.detail.export')}
              </Button>
            ) : null}
            {canErase && customer.status !== 'erased' ? (
              <Button variant="danger-light" onClick={() => setEraseOpen(true)}>
                {t('customers.detail.erase')}
              </Button>
            ) : null}
          </Flex>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Flex gap={3} alignItems="center" wrap="wrap">
            <Badge {...statusTone(customer.status)}>
              {t(`customers.status.${customer.status}`)}
            </Badge>
            <Typography variant="pi">
              {customer.phoneMasked ?? '—'}
              {revealed ? ` → ${revealed}` : ''}
            </Typography>
            {canManage && !revealed && customer.phoneMasked ? (
              <Button size="S" variant="tertiary" onClick={() => void reveal()}>
                {t('customers.detail.reveal')}
              </Button>
            ) : null}
            <Typography variant="pi" textColor="neutral600">
              {t('customers.detail.marketing')}:{' '}
              {customer.marketingConsent?.granted === true
                ? t('customers.detail.marketing.yes')
                : t('customers.detail.marketing.no')}
            </Typography>
          </Flex>
          <Grid.Root gap={4}>
            {(
              [
                ['customers.detail.stats.orders', String(customer.orderCount)],
                ['customers.detail.stats.spent', formatMoney(customer.totalSpent)],
                ['customers.detail.stats.average', formatMoney(customer.averageOrder)],
                ['customers.detail.stats.lastOrder', formatDateTime(customer.lastOrderAt)],
              ] as Array<[string, string]>
            ).map(([key, value]) => (
              <Grid.Item key={key} col={3} s={6} xs={12}>
                <Box padding={4} background="neutral0" shadow="tableShadow" borderRadius="4px">
                  <Typography variant="sigma" textColor="neutral600" tag="p">
                    {t(key)}
                  </Typography>
                  <Typography variant="beta" tag="p">
                    {value}
                  </Typography>
                </Box>
              </Grid.Item>
            ))}
          </Grid.Root>
          <Tabs.Root value={tab} onValueChange={(next: string) => setTab(next as Tab)}>
            <Tabs.List>
              {(['orders', 'loyalty', 'addresses', 'consent', 'requests'] as Tab[]).map((item) => (
                <Tabs.Trigger key={item} value={item}>
                  {t(`customers.detail.tab.${item}`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
          {tab === 'orders' ? (
            orders.length === 0 ? (
              <Typography variant="pi">{t('customers.detail.noOrders')}</Typography>
            ) : (
              <Table colCount={6} rowCount={orders.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('customers.detail.col.code')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.status')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.payment')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.total')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.placed')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.branch')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {orders.map((order) => (
                    <Tr key={order.id}>
                      <Td>
                        <Link to={`/plugins/ordering/orders/${order.id}`}>
                          <Typography variant="pi" fontWeight="semiBold">
                            {order.code}
                          </Typography>
                        </Link>
                      </Td>
                      <Td><Typography variant="pi">{order.status}</Typography></Td>
                      <Td><Typography variant="pi">{order.paymentStatus}</Typography></Td>
                      <Td><Typography variant="pi">{formatMoney(order.total)}</Typography></Td>
                      <Td><Typography variant="pi">{formatDateTime(order.placedAt)}</Typography></Td>
                      <Td><Typography variant="pi">{order.locationRef}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )
          ) : null}
          {tab === 'addresses' ? (
            addresses.length === 0 ? (
              <Typography variant="pi">{t('customers.detail.noAddresses')}</Typography>
            ) : (
              <Table colCount={4} rowCount={addresses.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('customers.detail.col.label')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.recipient')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.address')}</Typography></Th>
                    <Th><VisuallyHidden>{t('x4.default')}</VisuallyHidden></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {addresses.map((address, index) => (
                    <Tr key={index}>
                      <Td><Typography variant="pi">{address.label ?? '—'}</Typography></Td>
                      <Td>
                        <Typography variant="pi">
                          {[address.recipientName, address.phoneMasked].filter(Boolean).join(' · ') || '—'}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography variant="pi">
                          {[address.line1, address.wardName, address.provinceName]
                            .filter(Boolean)
                            .join(', ')}
                        </Typography>
                      </Td>
                      <Td>{address.isDefault ? <Badge>{t('customers.detail.defaultAddress')}</Badge> : null}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )
          ) : null}
          {tab === 'consent' ? (
            consentTrail.length === 0 ? (
              <Typography variant="pi">{t('customers.detail.noConsent')}</Typography>
            ) : (
              <Table colCount={4} rowCount={consentTrail.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('customers.detail.col.at')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.granted')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.source')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.version')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {consentTrail.map((entry, index) => (
                    <Tr key={index}>
                      <Td><Typography variant="pi">{formatDateTime(entry.at ?? null)}</Typography></Td>
                      <Td>
                        <Typography variant="pi">
                          {entry.granted === true
                            ? t('customers.detail.marketing.yes')
                            : t('customers.detail.marketing.no')}
                        </Typography>
                      </Td>
                      <Td><Typography variant="pi">{entry.source ?? '—'}</Typography></Td>
                      <Td><Typography variant="pi">{entry.policyVersion ?? '—'}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )
          ) : null}
          {tab === 'loyalty' && id ? <CustomerLoyalty customerId={id} /> : null}
          {tab === 'requests' ? (
            requests.length === 0 ? (
              <Typography variant="pi">{t('customers.detail.noRequests')}</Typography>
            ) : (
              <Table colCount={6} rowCount={requests.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('customers.detail.col.at')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.kind')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('dataRequests.col.source')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.requestStatus')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.detail.col.handledBy')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('dataRequests.col.note')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {requests.map((request) => (
                    <Tr key={request.id}>
                      <Td><Typography variant="pi">{formatDateTime(request.requestedAt)}</Typography></Td>
                      <Td><Typography variant="pi">{t(`dataRequests.kind.${request.kind}`)}</Typography></Td>
                      <Td><Typography variant="pi">{t(`dataRequests.source.${request.source}`)}</Typography></Td>
                      <Td><Badge>{t(`dataRequests.status.${request.status}`)}</Badge></Td>
                      <Td><Typography variant="pi">{request.handledBy ?? '—'}</Typography></Td>
                      <Td><Typography variant="pi">{request.note ?? '—'}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )
          ) : null}
        </Flex>
      </Layouts.Content>
      <Dialog.Root open={editOpen} onOpenChange={(open: boolean) => setEditOpen(open)}>
        <Dialog.Content>
          <Dialog.Header>{t('customers.detail.edit.title')}</Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Field.Root>
                <Field.Label>{t('customers.detail.edit.name')}</Field.Label>
                <TextInput value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('customers.detail.edit.staffNote')}</Field.Label>
                <Textarea
                  value={staffNote}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setStaffNote(e.target.value)}
                />
              </Field.Root>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={eraseOpen} onOpenChange={(open: boolean) => setEraseOpen(open)}>
        <Dialog.Content>
          <Dialog.Header>{t('customers.detail.erase.title')}</Dialog.Header>
          <Dialog.Body>
            <Typography>
              {t('customers.detail.erase.consequences', { count: closedOrders })}
            </Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="danger" loading={busy} onClick={() => void requestErase()}>
                {t('customers.detail.erase.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};
