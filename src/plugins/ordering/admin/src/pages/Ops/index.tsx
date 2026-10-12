import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
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
import { Link } from 'react-router-dom';

import { useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type WebhookRow = {
  providerCode: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  state: 'ok' | 'slow' | 'failing';
};

type JobRow = {
  name: string;
  cron: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: string | null;
  locked: boolean;
  runnable: boolean;
};

type FailedRow = {
  id: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  orderCode: string | null;
  attempts: number;
  failedAt: string | null;
  lastError: string | null;
};

type StatusBody = {
  now: string;
  outbox: {
    pending: number;
    oldestAvailableAt: string | null;
    oldestAgeMinutes: number;
    failed: number;
    thresholdMinutes: number;
    stuck: boolean;
  };
  webhooks: WebhookRow[];
  reconciliation: { lastSuccessAt: string | null; nextRunAt: string | null; enabled: boolean };
  alerts: { open: number; critical: number };
  jobs: JobRow[];
  failedOutbox: FailedRow[];
};

const REFRESH_MS = 30_000;

const cardBox = {
  background: 'neutral0',
  hasRadius: true,
  padding: 4,
  shadow: 'tableShadow',
  style: { flex: '1 1 220px', minWidth: 220 },
} as const;

const durationLabel = (t: Translate, ms: number | null): string => {
  if (ms === null) return '—';
  if (ms >= 1000) return t('ops.duration.s', { s: (ms / 1000).toFixed(1) });
  return t('ops.duration.ms', { ms });
};

const webhookTone = (state: WebhookRow['state']): Record<string, string> =>
  state === 'failing'
    ? { textColor: 'danger700', backgroundColor: 'danger100' }
    : state === 'slow'
      ? { textColor: 'warning700', backgroundColor: 'warning100' }
      : { textColor: 'success700', backgroundColor: 'success100' };

/**
 * "Tình trạng vận hành" (screens V1): status cards, the scheduled-job table with a "Chạy ngay"
 * action, and a failed-outbox tab with per-row retry. Polls every 30 s; every write goes through
 * `useNotification` + reload.
 */
const OpsPage = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [body, setBody] = useState<StatusBody | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<'jobs' | 'failed'>('jobs');
  const [running, setRunning] = useState<JobRow | null>(null);
  const [busy, setBusy] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/ops/status');
      setBody(data as StatusBody);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const runJob = async () => {
    if (!running) return;
    setBusy(running.name);
    try {
      const { data } = await post(`/ordering/ops/jobs/${running.name}/run`);
      const result = (data as { result?: { ran?: boolean } }).result;
      if (result && result.ran === false) {
        toggleNotification({ type: 'warning', message: t('ops.run.locked') });
      } else {
        toggleNotification({ type: 'success', message: t('ops.run.done', { name: running.name }) });
      }
      setRunning(null);
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(null);
    }
  };

  const retry = async (row: FailedRow) => {
    setBusy(row.id);
    try {
      await post(`/ordering/ops/outbox/${row.id}/retry`);
      toggleNotification({ type: 'success', message: t('ops.failed.retried') });
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(null);
    }
  };

  const outbox = body?.outbox;
  const failedRows = body?.failedOutbox ?? [];

  return (
    <Page.Protect permissions={PERMISSIONS.ops}>
      <Page.Title>{t('ops.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('ops.title')}
          subtitle={t('ops.subtitle')}
          primaryAction={
            <Button variant="secondary" onClick={() => void load()}>
              {t('ops.refresh')}
            </Button>
          }
        />
        <Layouts.Content>
          {status === 'loading' && !body ? (
            <Flex justifyContent="center" padding={10}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={t('common.error.title')}
              action={
                <Button onClick={() => void load()}>{t('common.retry')}</Button>
              }
            >
              {t('ops.loadFailed')}
            </Alert>
          ) : body ? (
            <Flex direction="column" alignItems="stretch" gap={5}>
              <Flex gap={4} wrap="wrap" alignItems="stretch">
                <Box {...cardBox}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ops.card.outbox')}
                  </Typography>
                  <Box paddingTop={2}>
                    <Typography variant="alpha" textColor={outbox?.stuck ? 'danger600' : undefined}>
                      {t('ops.card.outbox.pending', { count: outbox?.pending ?? 0 })}
                    </Typography>
                  </Box>
                  <Typography variant="pi" textColor={outbox?.stuck ? 'danger600' : 'neutral600'}>
                    {t('ops.card.outbox.oldest', { minutes: Math.round(outbox?.oldestAgeMinutes ?? 0) })}
                    {outbox && outbox.failed > 0 ? ` · ${t('ops.card.outbox.failed', { count: outbox.failed })}` : ''}
                  </Typography>
                </Box>
                <Box {...cardBox}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ops.card.webhook')}
                  </Typography>
                  {body.webhooks.length === 0 ? (
                    <Typography variant="pi" textColor="neutral600">
                      {t('ops.card.webhook.empty')}
                    </Typography>
                  ) : (
                    body.webhooks.map((row) => (
                      <Flex key={row.providerCode} gap={2} paddingTop={2} alignItems="center">
                        <Badge {...webhookTone(row.state)}>{t(`ops.webhook.${row.state}`)}</Badge>
                        <Typography variant="pi">
                          {row.providerCode}
                        </Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {row.lastSuccessAt
                            ? t('ops.webhook.lastSuccess', { at: formatDateTime(row.lastSuccessAt) })
                            : t('ops.webhook.never')}
                        </Typography>
                      </Flex>
                    ))
                  )}
                </Box>
                <Box {...cardBox}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ops.card.reconciliation')}
                  </Typography>
                  {body.reconciliation.enabled ? (
                    <Box paddingTop={2}>
                      <Typography variant="pi" textColor="neutral600">
                        {body.reconciliation.lastSuccessAt
                          ? t('ops.reconciliation.last', { at: formatDateTime(body.reconciliation.lastSuccessAt) })
                          : t('ops.reconciliation.never')}
                      </Typography>
                      <br />
                      <Typography variant="pi" textColor="neutral600">
                        {body.reconciliation.nextRunAt
                          ? t('ops.reconciliation.next', { at: formatDateTime(body.reconciliation.nextRunAt) })
                          : '—'}
                      </Typography>
                    </Box>
                  ) : (
                    <Box paddingTop={2}>
                      <Badge>{t('ops.reconciliation.disabled')}</Badge>
                    </Box>
                  )}
                </Box>
                <Box {...cardBox}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ops.card.alerts')}
                  </Typography>
                  <Box paddingTop={2}>
                    <Typography variant="alpha">
                      {body.alerts.open}
                    </Typography>
                  </Box>
                  <Typography variant="pi" textColor={body.alerts.critical > 0 ? 'danger600' : 'neutral600'}>
                    {t('ops.card.alerts.critical', { count: body.alerts.critical })}
                  </Typography>
                  <Box paddingTop={2}>
                    <Link to="/plugins/ordering/alerts">{t('ops.card.alerts.view')}</Link>
                  </Box>
                </Box>
              </Flex>

              <Tabs.Root value={tab} onValueChange={(next: string) => setTab(next as 'jobs' | 'failed')}>
                <Tabs.List>
                  <Tabs.Trigger value="jobs">{t('ops.tab.jobs')}</Tabs.Trigger>
                  <Tabs.Trigger value="failed">
                    {t('ops.tab.failed')}
                    {failedRows.length > 0 ? ` (${failedRows.length})` : ''}
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs.Root>

              {tab === 'jobs' ? (
                <Table colCount={6}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('ops.job.col.name')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.job.col.lastRun')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.job.col.result')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.job.col.duration')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.job.col.next')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('orders.col.actions')}</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {body.jobs.map((job) => (
                      <Tr key={job.name}>
                        <Td>
                          <Typography>{t(`ops.job.${job.name}`, undefined, job.name)}</Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {job.cron}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{formatDateTime(job.lastRunAt)}</Typography>
                        </Td>
                        <Td>
                          {job.locked ? (
                            <Badge>{t('ops.job.locked')}</Badge>
                          ) : job.lastError ? (
                            <Flex direction="column" alignItems="start" gap={1}>
                              <Badge textColor="danger700" backgroundColor="danger100">
                                {t('ops.job.error')}
                              </Badge>
                              <Typography variant="pi" textColor="neutral600">
                                {job.lastError}
                              </Typography>
                            </Flex>
                          ) : job.lastSuccessAt ? (
                            <Badge textColor="success700" backgroundColor="success100">
                              {t('ops.job.ok')}
                            </Badge>
                          ) : (
                            <Badge>{t('ops.job.never')}</Badge>
                          )}
                        </Td>
                        <Td>
                          <Typography variant="pi">{durationLabel(t, job.lastDurationMs)}</Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{formatDateTime(job.nextRunAt)}</Typography>
                        </Td>
                        <Td>
                          <Button
                            size="S"
                            variant="tertiary"
                            disabled={!job.runnable || busy !== null}
                            onClick={() => setRunning(job)}
                          >
                            {t('ops.job.run')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : failedRows.length === 0 ? (
                <EmptyStateLayout content={t('ops.failed.empty')} />
              ) : (
                <Table colCount={5}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('ops.failed.col.type')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.failed.col.order')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.failed.col.attempts')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('ops.failed.col.error')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('orders.col.actions')}</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {failedRows.map((row) => (
                      <Tr key={row.id}>
                        <Td>
                          <Typography>{row.type}</Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {row.aggregateType}:{row.aggregateId} · {formatDateTime(row.failedAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{row.orderCode ?? '—'}</Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{row.attempts}</Typography>
                        </Td>
                        <Td>
                          <Typography variant="pi">{row.lastError ?? '—'}</Typography>
                        </Td>
                        <Td>
                          <Button
                            size="S"
                            variant="tertiary"
                            loading={busy === row.id}
                            disabled={busy !== null}
                            onClick={() => void retry(row)}
                          >
                            {t('ops.failed.retry')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Flex>
          ) : null}
        </Layouts.Content>
      </Page.Main>
      <Dialog.Root open={running !== null} onOpenChange={(open: boolean) => !open && setRunning(null)}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>{t('ops.job.run.title')}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Typography>{t('ops.job.run.confirm', { name: running?.name ?? '' })}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary" disabled={busy !== null}>
                {t('common.cancel')}
              </Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy !== null} onClick={() => void runJob()}>
                {t('ops.job.run')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Page.Protect>
  );
};

export default OpsPage;
