import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Table,
  Tabs,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { RBAC_ALERTS } from '../../lib/permissions';

type AlertRow = {
  id: number;
  alertCode: string;
  dedupeKey: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  aggregateRef: string | null;
  locationRef: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  recipients: string[];
};

type ListBody = { rows: AlertRow[]; total: number; page: number; pageSize: number };

type Tab = 'open' | 'acknowledged' | 'resolved';

const TABS: Tab[] = ['open', 'acknowledged', 'resolved'];
const PAGE_SIZE = 25;

const severityTone = (severity: AlertRow['severity']): Record<string, string> =>
  severity === 'critical'
    ? { textColor: 'danger700', backgroundColor: 'danger100' }
    : severity === 'warning'
      ? { textColor: 'warning700', backgroundColor: 'warning100' }
      : {};

const recipientLabel = (t: Translate, recipient: string): string =>
  t(`alert.recipient.${recipient}`, undefined, recipient);

/**
 * "Cảnh báo" (screens V2): three status tabs over `GET /ordering/alerts`, scoped server-side to
 * the rules whose recipients the staff member holds. "Đã biết" posts the acknowledge route.
 */
const AlertsPage = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [tab, setTab] = useState<Tab>('open');
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await get(`/ordering/alerts?status=${tab}&page=${page}&pageSize=${PAGE_SIZE}`);
      setBody(data as ListBody);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [get, page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (row: AlertRow) => {
    setBusy(row.id);
    try {
      await post(`/ordering/alerts/${row.id}/acknowledge`);
      toggleNotification({ type: 'success', message: t('alerts.ack.done') });
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(null);
    }
  };

  const rows = body?.rows ?? [];
  const pages = body ? Math.max(1, Math.ceil(body.total / body.pageSize)) : 1;
  const colCount = tab === 'open' ? 7 : 6;

  return (
    <Page.Protect permissions={RBAC_ALERTS}>
      <Page.Title>{t('alerts.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
        <Layouts.Content>
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
                  {t(`alerts.tab.${item}`)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <Box paddingTop={4}>
            {status === 'loading' && !body ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>{t('common.loading')}</Loader>
              </Flex>
            ) : status === 'scope' ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
                {t('common.forbidden.body')}
              </Alert>
            ) : status === 'error' ? (
              <Alert
                variant="danger"
                closeLabel={t('common.close')}
                title={t('common.error.title')}
                action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
              >
                {t('alerts.loadFailed')}
              </Alert>
            ) : rows.length === 0 ? (
              <EmptyStateLayout content={t(`alerts.empty.${tab}`)} />
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Table colCount={colCount} rowCount={rows.length + 1}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('alerts.col.level')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('alerts.col.content')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('alerts.col.count')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('alerts.col.seen')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('alerts.col.recipients')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('alerts.col.status')}</Typography></Th>
                      {tab === 'open' ? (
                        <Th><Typography variant="sigma">{t('orders.col.actions')}</Typography></Th>
                      ) : null}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>
                          <Badge {...severityTone(row.severity)}>{t(`alert.severity.${row.severity}`)}</Badge>
                        </Td>
                        <Td>
                          <Typography>{t(`alert.code.${row.alertCode}`, undefined, row.alertCode)}</Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {row.aggregateRef ?? row.dedupeKey}
                            {row.locationRef ? ` · ${t('alerts.branch', { ref: row.locationRef })}` : ''}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{row.count}</Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">
                            {formatDateTime(row.firstSeenAt)} · {formatDateTime(row.lastSeenAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">
                            {row.recipients.map((item) => recipientLabel(t, item)).join(', ')}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{t(`alert.status.${row.status}`)}</Typography>
                          {row.status === 'acknowledged' && row.acknowledgedBy ? (
                            <Typography variant="pi" textColor="neutral600">
                              {t('alerts.ack.by', {
                                by: row.acknowledgedBy,
                                at: formatDateTime(row.acknowledgedAt),
                              })}
                            </Typography>
                          ) : null}
                        </Td>
                        {tab === 'open' ? (
                          <Td>
                            <Button
                              size="S"
                              variant="tertiary"
                              loading={busy === row.id}
                              disabled={busy !== null}
                              onClick={() => void acknowledge(row)}
                            >
                              {t('alerts.action.ack')}
                            </Button>
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Flex justifyContent="space-between" alignItems="center">
                  <Typography variant="pi" textColor="neutral600">
                    {t('alerts.page', { page: body?.page ?? 1, pages })}
                  </Typography>
                  <Flex gap={2}>
                    <Button size="S" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      {t('common.previous')}
                    </Button>
                    <Button
                      size="S"
                      variant="tertiary"
                      disabled={!body || page >= pages}
                      onClick={() => setPage(page + 1)}
                    >
                      {t('common.next')}
                    </Button>
                  </Flex>
                </Flex>
              </Flex>
            )}
          </Box>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default AlertsPage;
