import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
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
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_DATA_REQUESTS } from '../../lib/permissions';

type RequestRow = {
  id: string;
  kind: 'export' | 'erase';
  source: 'customer' | 'staff';
  status: 'received' | 'waiting' | 'done' | 'rejected';
  requestedAt: string;
  doneAt: string | null;
  handledBy: string | null;
  note: string | null;
  customer: { documentId: string | null; phoneMasked: string | null } | null;
};

type ListBody = {
  items: RequestRow[];
  page: number;
  pageSize: number;
  total: number;
  deadlineHours: number;
};

type Tab = 'received' | 'waiting' | 'done' | 'rejected';
const TABS: Tab[] = ['received', 'waiting', 'done', 'rejected'];
const OPEN_STATUSES = new Set(['received', 'waiting']);

const statusTone = (status: string): Record<string, string> =>
  status === 'done'
    ? { textColor: 'success700', backgroundColor: 'success100' }
    : status === 'rejected'
      ? { textColor: 'danger700', backgroundColor: 'danger100' }
      : status === 'waiting'
        ? { textColor: 'warning700', backgroundColor: 'warning100' }
        : {};

/**
 * C3 (Cấu hình → Yêu cầu dữ liệu): the Decree 13 request queue. Staff can file a request by
 * phone (a call-in asks for deletion), process waiting ones (open orders still block the
 * delete — the `data-request-waiting` job retries), or reject with a required reason.
 */
const DataRequestsPage = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [tab, setTab] = useState<Tab>('received');
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [processing, setProcessing] = useState<RequestRow | null>(null);
  const [rejecting, setRejecting] = useState<RequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newKind, setNewKind] = useState<'erase' | 'export'>('erase');
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const query = new URLSearchParams({ status: tab, page: String(page), pageSize: '20' });
      const { data } = await get(`/ordering/data-requests?${query.toString()}`);
      setBody(data as ListBody);
      setState('ready');
    } catch (error) {
      setState(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [get, page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const process = async (row: RequestRow) => {
    setBusy(true);
    try {
      await post(`/ordering/data-requests/${row.id}/process`, {});
      setProcessing(null);
      toggleNotification({ type: 'success', message: t('dataRequests.process.done') });
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await post(`/ordering/data-requests/${rejecting.id}/reject`, { reason: rejectReason });
      setRejecting(null);
      setRejectReason('');
      toggleNotification({ type: 'success', message: t('dataRequests.reject.done') });
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await post('/ordering/data-requests', {
        phone: newPhone,
        kind: newKind,
        ...(newNote.trim() ? { note: newNote.trim() } : {}),
      });
      setCreateOpen(false);
      setNewPhone('');
      setNewNote('');
      toggleNotification({ type: 'success', message: t('dataRequests.create.created') });
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const rows = body?.items ?? [];
  const hasNext = body ? body.page * body.pageSize < body.total : false;

  return (
    <Page.Protect permissions={RBAC_DATA_REQUESTS}>
      <Page.Title>{t('dataRequests.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('dataRequests.title')}
          subtitle={t('dataRequests.subtitle')}
          primaryAction={
            <Button onClick={() => setCreateOpen(true)}>{t('dataRequests.create')}</Button>
          }
        />
        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Tabs.Root
              value={tab}
              onValueChange={(next: string) => {
                setTab(next as Tab);
                setPage(1);
              }}
            >
              <Tabs.List>
                {TABS.map((item) => (
                  <Tabs.Trigger key={item} value={item}>
                    {t(`dataRequests.tab.${item}`)}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
            {state === 'loading' && !body ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>{t('common.loading')}</Loader>
              </Flex>
            ) : state === 'scope' ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')} />
            ) : state === 'error' ? (
              <Alert
                variant="danger"
                closeLabel={t('common.close')}
                title={t('common.error.title')}
                action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
              >
                {t('dataRequests.loadFailed')}
              </Alert>
            ) : rows.length === 0 ? (
              <EmptyStateLayout content={t('dataRequests.empty')} />
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Table colCount={8}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('dataRequests.col.at')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.kind')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.source')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.customer')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.status')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.handledBy')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.due')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('dataRequests.col.actions')}</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => {
                      const dueAt = new Date(
                        new Date(row.requestedAt).getTime() + (body?.deadlineHours ?? 72) * 3_600_000,
                      );
                      const overdue = OPEN_STATUSES.has(row.status) && dueAt.getTime() < Date.now();
                      return (
                        <Tr key={row.id}>
                          <Td><Typography variant="pi">{formatDateTime(row.requestedAt)}</Typography></Td>
                          <Td><Typography variant="pi">{t(`dataRequests.kind.${row.kind}`)}</Typography></Td>
                          <Td><Typography variant="pi">{t(`dataRequests.source.${row.source}`)}</Typography></Td>
                          <Td>
                            {row.customer?.documentId ? (
                              <Link to={`/plugins/ordering/customers/${row.customer.documentId}`}>
                                <Typography variant="pi">{row.customer.phoneMasked ?? '—'}</Typography>
                              </Link>
                            ) : (
                              <Typography variant="pi">{row.customer?.phoneMasked ?? '—'}</Typography>
                            )}
                          </Td>
                          <Td><Badge {...statusTone(row.status)}>{t(`dataRequests.status.${row.status}`)}</Badge></Td>
                          <Td><Typography variant="pi">{row.handledBy ?? '—'}</Typography></Td>
                          <Td>
                            <Typography variant="pi" textColor={overdue ? 'danger600' : undefined}>
                              {OPEN_STATUSES.has(row.status) ? formatDateTime(dueAt.toISOString()) : '—'}
                              {overdue ? ` · ${t('dataRequests.overdue')}` : ''}
                            </Typography>
                          </Td>
                          <Td>
                            {OPEN_STATUSES.has(row.status) && row.kind === 'erase' ? (
                              <Flex gap={2}>
                                <Button size="S" variant="tertiary" onClick={() => setProcessing(row)}>
                                  {t('dataRequests.process')}
                                </Button>
                                <Button
                                  size="S"
                                  variant="danger-light"
                                  onClick={() => {
                                    setRejecting(row);
                                    setRejectReason('');
                                  }}
                                >
                                  {t('dataRequests.reject')}
                                </Button>
                              </Flex>
                            ) : null}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
                <Flex justifyContent="flex-end" gap={2}>
                  <Button size="S" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Button size="S" variant="tertiary" disabled={!hasNext} onClick={() => setPage(page + 1)}>
                    {t('common.next')}
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        </Layouts.Content>
      </Page.Main>
      <Dialog.Root open={processing !== null} onOpenChange={(open: boolean) => !open && setProcessing(null)}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>{t('dataRequests.process.title')}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Typography>{t('dataRequests.process.consequences')}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="danger" loading={busy} onClick={() => processing && void process(processing)}>
                {t('dataRequests.process.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={rejecting !== null} onOpenChange={(open: boolean) => !open && setRejecting(null)}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>{t('dataRequests.reject.title')}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Field.Root required>
              <Field.Label>{t('dataRequests.reject.reason')}</Field.Label>
              <Textarea
                value={rejectReason}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setRejectReason(event.target.value)
                }
              />
            </Field.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button
                variant="danger"
                disabled={rejectReason.trim() === ''}
                loading={busy}
                onClick={() => void reject()}
              >
                {t('dataRequests.reject.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={createOpen} onOpenChange={(open: boolean) => setCreateOpen(open)}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>{t('dataRequests.create.title')}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Field.Root required>
                <Field.Label>{t('dataRequests.create.phone')}</Field.Label>
                <TextInput
                  value={newPhone}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewPhone(event.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('dataRequests.create.kind')}</Field.Label>
                <SingleSelect
                  value={newKind}
                  onChange={(value: string | number) => setNewKind(value as 'erase' | 'export')}
                >
                  <SingleSelectOption value="erase">{t('dataRequests.kind.erase')}</SingleSelectOption>
                  <SingleSelectOption value="export">{t('dataRequests.kind.export')}</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('dataRequests.create.note')}</Field.Label>
                <Textarea
                  value={newNote}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNewNote(event.target.value)}
                />
              </Field.Root>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button disabled={newPhone.trim() === ''} loading={busy} onClick={() => void create()}>
                {t('dataRequests.create.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Page.Protect>
  );
};

export default DataRequestsPage;
