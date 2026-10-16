import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { RBAC_NOTIFICATION_LOG, RBAC_NOTIFICATION_LOG_DETAILS } from '../../lib/permissions';

type Channel = 'zalo' | 'sms' | 'email';
type LogStatus = 'pending' | 'sent' | 'failed' | 'skipped';

type Row = {
  id: number;
  createdAt: string;
  template: string;
  templateLabel: string;
  channel: Channel;
  recipientRole: 'staff' | 'customer' | null;
  orderId: number | null;
  orderCode: string | null;
  status: LogStatus;
  attempts: number;
  sentAt: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
};
type Detail = Row & { messageLocale: string | null };
type ListBody = {
  range: { from: string; to: string; timezone: string };
  page: number;
  hasNext: boolean;
  rows: Row[];
};
type Summary = {
  timezone: string;
  last24h: { sent: number; failed: number; skipped: number; pending: number };
  paid: { sentToday: number; dailyLimit: number };
  mode: 'live' | 'allowlist';
  branchesWithoutEmail: Array<{ code: string; name: Record<string, string> }>;
};
type Technical = { id: number; lastError: string | null; providerMessageId: string | null; costEstimate: number | null };

const ALL = '__all__';
const CHANNELS: Channel[] = ['zalo', 'sms', 'email'];
const STATUSES: LogStatus[] = ['sent', 'failed', 'skipped', 'pending'];
const ROLES: Array<'staff' | 'customer'> = ['staff', 'customer'];

const statusTone = (status: LogStatus): Record<string, string> =>
  status === 'sent'
    ? { textColor: 'success700', backgroundColor: 'success100' }
    : status === 'failed'
      ? { textColor: 'danger700', backgroundColor: 'danger100' }
      : status === 'skipped'
        ? { textColor: 'warning700', backgroundColor: 'warning100' }
        : {};

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const vnd = (value: number) => `${value.toLocaleString('vi-VN')}đ`;

/**
 * "Lịch sử gửi" (R1b, read-only): one row per delivery attempt with its outcome and reason.
 * The list never shows the recipient address (only the hash is stored); the technical failure tail
 * lives behind its own `notification-log.details` permission and is fetched on demand.
 */
const NotificationLogPage = () => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const detailsRbac = useRBAC(RBAC_NOTIFICATION_LOG_DETAILS);
  const canDetails = !detailsRbac.isLoading && Object.values(detailsRbac.allowedActions).some(Boolean);

  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(daysBefore(today(), 6));
  const [status, setStatus] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [template, setTemplate] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState(0);
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [technical, setTechnical] = useState<Technical | null>(null);

  const params = useCallback(() => {
    const out = new URLSearchParams({ from, to, locale });
    if (status !== ALL) out.set('status', status);
    if (channel !== ALL) out.set('channel', channel);
    if (template !== ALL) out.set('template', template);
    if (role !== ALL) out.set('role', role);
    if (q.trim()) out.set('q', q.trim());
    return out;
  }, [channel, from, locale, q, role, status, template, to]);

  const load = useCallback(async () => {
    setState((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const query = params();
      query.set('page', String(page));
      const { data } = await get(`/ordering/notification-log?${query.toString()}`);
      setBody(data as ListBody);
      setState('ready');
    } catch (error) {
      setState(httpStatusOf(error) === 403 ? 'scope' : 'error');
      if (httpStatusOf(error) === 400) toastError(error);
    }
  }, [get, page, applied, params, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void get('/ordering/notification-log/summary')
      .then(({ data }) => setSummary(data as Summary))
      .catch(() => undefined);
  }, [get, applied]);

  const templateOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of body?.rows ?? []) seen.set(row.template, row.templateLabel);
    return [...seen.entries()];
  }, [body]);

  const openDetail = async (row: Row) => {
    setTechnical(null);
    try {
      const { data } = await get(`/ordering/notification-log/${row.id}?locale=${locale}`);
      setDetail(data as Detail);
    } catch (error) {
      toastError(error);
    }
  };

  const loadTechnical = async () => {
    if (!detail) return;
    try {
      const { data } = await get(`/ordering/notification-log/${detail.id}/technical`);
      setTechnical(data as Technical);
    } catch (error) {
      toastError(error);
    }
  };

  const rows = body?.rows ?? [];

  return (
    <Page.Protect permissions={RBAC_NOTIFICATION_LOG}>
      <Page.Title>{t('nlog.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header title={t('nlog.title')} subtitle={t('nlog.subtitle', { timezone: summary?.timezone ?? '' })} />
        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {summary && summary.branchesWithoutEmail.length > 0 ? (
              <Alert
                variant="warning"
                closeLabel={t('common.close')}
                title={t('nlog.warn.noEmail', {
                  branches: summary.branchesWithoutEmail
                    .map((branch) => branch.name?.[locale] || branch.name?.vi || branch.code)
                    .join(', '),
                })}
              >
                <Typography variant="pi" tag="p">
                  <Link to="/plugins/ordering/branches">{t('nlog.warn.noEmail.link')}</Link>
                </Typography>
              </Alert>
            ) : null}
            {summary?.mode === 'allowlist' ? (
              <Alert variant="warning" closeLabel={t('common.close')} title={t('notify.mode.title')}>
                {t('nlog.info.allowlist')}
              </Alert>
            ) : null}
            {summary ? (
              <Flex gap={3} wrap="wrap">
                <Badge>{`${t('nlog.stat.sent24h')}: ${summary.last24h.sent}`}</Badge>
                <Badge {...(summary.last24h.failed > 0 ? { textColor: 'danger700', backgroundColor: 'danger100' } : {})}>
                  {`${t('nlog.stat.failed24h')}: ${summary.last24h.failed}`}
                </Badge>
                <Badge>{`${t('nlog.stat.skipped24h')}: ${summary.last24h.skipped}`}</Badge>
                <Badge>{`${t('nlog.stat.budget')}: ${summary.paid.sentToday} / ${summary.paid.dailyLimit}`}</Badge>
              </Flex>
            ) : null}
            <Flex gap={3} wrap="wrap" alignItems="end">
              <Box minWidth="150px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.from')}</Field.Label>
                  <TextInput type="date" value={from} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)} />
                </Field.Root>
              </Box>
              <Box minWidth="150px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.to')}</Field.Label>
                  <TextInput type="date" value={to} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTo(event.target.value)} />
                </Field.Root>
              </Box>
              <Box minWidth="160px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.status')}</Field.Label>
                  <SingleSelect value={status} onChange={(value: string | number) => setStatus(String(value))}>
                    <SingleSelectOption value={ALL}>{t('nlog.filter.all')}</SingleSelectOption>
                    {STATUSES.map((item) => (
                      <SingleSelectOption key={item} value={item}>
                        {t(`nlog.status.${item}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="140px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.channel')}</Field.Label>
                  <SingleSelect value={channel} onChange={(value: string | number) => setChannel(String(value))}>
                    <SingleSelectOption value={ALL}>{t('nlog.filter.all')}</SingleSelectOption>
                    {CHANNELS.map((item) => (
                      <SingleSelectOption key={item} value={item}>
                        {t(`nlog.channel.${item}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="200px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.template')}</Field.Label>
                  <SingleSelect value={template} onChange={(value: string | number) => setTemplate(String(value))}>
                    <SingleSelectOption value={ALL}>{t('nlog.filter.all')}</SingleSelectOption>
                    {templateOptions.map(([code, label]) => (
                      <SingleSelectOption key={code} value={code}>
                        {label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="140px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.role')}</Field.Label>
                  <SingleSelect value={role} onChange={(value: string | number) => setRole(String(value))}>
                    <SingleSelectOption value={ALL}>{t('nlog.filter.all')}</SingleSelectOption>
                    {ROLES.map((item) => (
                      <SingleSelectOption key={item} value={item}>
                        {t(`nlog.role.${item}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="180px">
                <Field.Root>
                  <Field.Label>{t('nlog.filter.q')}</Field.Label>
                  <TextInput value={q} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value)} />
                </Field.Root>
              </Box>
              <Button
                onClick={() => {
                  setPage(1);
                  setApplied((n) => n + 1);
                }}
              >
                {t('nlog.filter.apply')}
              </Button>
            </Flex>
            {state === 'loading' && !body ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>{t('common.loading')}</Loader>
              </Flex>
            ) : state === 'scope' ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
                {t('common.forbidden.body')}
              </Alert>
            ) : state === 'error' ? (
              <Alert
                variant="danger"
                closeLabel={t('common.close')}
                title={t('common.error.title')}
                action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
              >
                {t('nlog.loadFailed')}
              </Alert>
            ) : rows.length === 0 ? (
              <EmptyStateLayout content={t('nlog.empty')} />
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Table colCount={9} rowCount={rows.length + 1}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('nlog.col.at')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.template')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.channel')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.role')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.order')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.status')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.reason')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.attempts')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('nlog.col.action')}</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td><Typography variant="pi">{formatDateTime(row.createdAt)}</Typography></Td>
                        <Td><Typography variant="pi">{row.templateLabel}</Typography></Td>
                        <Td><Badge>{t(`nlog.channel.${row.channel}`)}</Badge></Td>
                        <Td>
                          <Typography variant="pi">
                            {row.recipientRole ? t(`nlog.role.${row.recipientRole}`) : '—'}
                          </Typography>
                        </Td>
                        <Td>
                          {row.orderId ? (
                            <Link to={`/plugins/ordering/orders/${row.orderId}`}>{row.orderCode ?? row.orderId}</Link>
                          ) : (
                            <Typography variant="pi">—</Typography>
                          )}
                        </Td>
                        <Td><Badge {...statusTone(row.status)}>{t(`nlog.status.${row.status}`)}</Badge></Td>
                        <Td>
                          <Typography variant="pi">{row.status === 'skipped' ? row.reasonLabel ?? row.reasonCode ?? '—' : '—'}</Typography>
                        </Td>
                        <Td><Typography variant="pi">{row.attempts}</Typography></Td>
                        <Td>
                          <Button size="S" variant="tertiary" onClick={() => void openDetail(row)}>
                            {t('nlog.col.action')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Flex justifyContent="flex-end" gap={2}>
                  <Button size="S" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('nlog.page.prev')}
                  </Button>
                  <Button size="S" variant="tertiary" disabled={!body?.hasNext} onClick={() => setPage(page + 1)}>
                    {t('nlog.page.next')}
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        </Layouts.Content>
      </Page.Main>
      <Modal.Root open={detail !== null} onOpenChange={(next: boolean) => (!next ? setDetail(null) : undefined)}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('nlog.detail.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {detail ? (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Box>
                  <Typography fontWeight="bold">{detail.templateLabel}</Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {formatDateTime(detail.createdAt)} · {t(`nlog.channel.${detail.channel}`)} ·{' '}
                    {t(`nlog.status.${detail.status}`)}
                  </Typography>
                  <Typography variant="pi" tag="p">
                    {detail.recipientRole ? t(`nlog.role.${detail.recipientRole}`) : '—'} · {t('nlog.col.attempts')}:{' '}
                    {detail.attempts}
                    {detail.sentAt ? ` · ${formatDateTime(detail.sentAt)}` : ''}
                  </Typography>
                  {detail.orderId ? (
                    <Typography variant="pi" tag="p">
                      <Link to={`/plugins/ordering/orders/${detail.orderId}`}>
                        {detail.orderCode ?? t('nlog.detail.openOrder')}
                      </Link>
                    </Typography>
                  ) : null}
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t('nlog.detail.messageLocale')}: {detail.messageLocale ?? '—'}
                  </Typography>
                </Box>
                {detail.status === 'skipped' ? (
                  <Typography variant="pi">
                    {t('nlog.detail.reason')}: {detail.reasonLabel ?? detail.reasonCode ?? '—'}
                  </Typography>
                ) : null}
                {canDetails ? (
                  technical ? (
                    <Box>
                      <Typography variant="sigma">{t('nlog.detail.error')}</Typography>
                      <Typography variant="pi" tag="p" style={{ fontFamily: 'monospace' }}>
                        {technical.lastError ?? '—'}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600" tag="p">
                        {t('nlog.detail.providerId')}: {technical.providerMessageId ?? '—'}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600" tag="p">
                        {t('nlog.detail.cost')}: {technical.costEstimate === null ? '—' : vnd(technical.costEstimate)}
                      </Typography>
                    </Box>
                  ) : (
                    <Button size="S" variant="secondary" onClick={() => void loadTechnical()}>
                      {t('nlog.detail.technical')}
                    </Button>
                  )
                ) : (
                  <Typography variant="pi" textColor="neutral600">
                    {t('nlog.detail.noPermission')}
                  </Typography>
                )}
              </Flex>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={() => setDetail(null)}>
              {t('common.close')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </Page.Protect>
  );
};

export default NotificationLogPage;
