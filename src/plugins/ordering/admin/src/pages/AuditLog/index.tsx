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
import { Layouts, Page, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link, useLocation } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLocale, useT, type Translate } from '../../lib/i18n';
import { RBAC_AUDIT, RBAC_EXPORT } from '../../lib/permissions';

type Change = { before: unknown; after: unknown };
type Entry = {
  id: number;
  occurredAt: string;
  actorRef: string;
  actorName: string | null;
  action: string;
  actionLabel: string;
  category: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  locationRef: string | null;
  orderId: number | null;
  requestId: string | null;
  changes: Record<string, Change> | null;
};
type ListBody = { range: { from: string; to: string }; page: number; hasNext: boolean; rows: Entry[] };
type Actor = { ref: string; name: string | null };
type BranchOption = { code: string; name?: Record<string, string> };

const CATEGORIES = ['all', 'money', 'order', 'catalog', 'delivery', 'config', 'access', 'ops'] as const;
const ALL = '__all__';
const HIDDEN = '[redacted]';

const categoryTone = (category: string): Record<string, string> =>
  category === 'money'
    ? { textColor: 'warning700', backgroundColor: 'warning100' }
    : category === 'access' || category === 'config'
      ? { textColor: 'primary700', backgroundColor: 'primary100' }
      : {};

const isAmountField = (field: string) => /amount|price|total|due|counted|expected|refund/i.test(field);

const showValue = (t: Translate, field: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (value === HIDDEN) return t('audit.detail.hidden');
  if (typeof value === 'number' && isAmountField(field)) return `${value.toLocaleString('vi-VN')}đ`;
  if (typeof value === 'string' && /^\d+$/.test(value) && isAmountField(field)) {
    return `${Number(value).toLocaleString('vi-VN')}đ`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** First two changed fields as "field: before → after" (the table summary). */
const summaryOf = (t: Translate, changes: Entry['changes']): string =>
  Object.entries(changes ?? {})
    .slice(0, 2)
    .map(([field, change]) => {
      const before = showValue(t, field, change.before);
      const after = showValue(t, field, change.after);
      return before === '—' ? `${field}: ${after}` : `${field}: ${before} → ${after}`;
    })
    .join(' · ');

const actorOf = (t: Translate, entry: { actorRef: string; actorName: string | null }) =>
  entry.actorRef.startsWith('admin:') ? entry.actorName || entry.actorRef : `${t('audit.system')} · ${entry.actorRef}`;

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** A blob response hides the Strapi error JSON; read `{ code }` back out (same as the order export). */
const blobErrorCode = async (error: unknown): Promise<string | undefined> => {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!(data instanceof Blob)) return undefined;
  try {
    return (JSON.parse(await data.text()) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
};

/**
 * "Lịch sử thay đổi" (O15 A1–A2): filterable, scoped view of the append-only admin change log.
 * Filters live in component state; `?q=` from the order detail link pre-fills the search.
 */
const AuditLogPage = () => {
  const t = useT();
  const locale = useLocale();
  const { search } = useLocation();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const exportRbac = useRBAC(RBAC_EXPORT);
  const canExport = Object.values(exportRbac.allowedActions).some(Boolean);

  const initialQ = useMemo(() => new URLSearchParams(search).get('q') ?? '', [search]);
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(daysBefore(today(), initialQ ? 92 : 6));
  const [actor, setActor] = useState(ALL);
  const [branch, setBranch] = useState(ALL);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [q, setQ] = useState(initialQ);
  const [applied, setApplied] = useState(0);
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [actors, setActors] = useState<Actor[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [detail, setDetail] = useState<{ entry: Entry; related: Entry[] } | null>(null);
  const [exporting, setExporting] = useState(false);

  const params = useCallback(() => {
    const out = new URLSearchParams({ from, to, locale });
    if (actor !== ALL) out.set('actor', actor);
    if (branch !== ALL) out.set('branch', branch);
    if (category !== 'all') out.set('category', category);
    if (q.trim()) out.set('q', q.trim());
    return out;
  }, [actor, branch, category, from, locale, q, to]);

  const load = useCallback(async () => {
    setStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const query = params();
      query.set('page', String(page));
      const { data } = await get(`/ordering/audit-log?${query.toString()}`);
      setBody(data as ListBody);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'scope' : 'error');
      if (httpStatusOf(error) === 400) toastError(error);
    }
    // `applied` re-runs the query when "Lọc" is pressed; typing in a filter alone does not.
  }, [get, page, applied, category]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void get('/ordering/audit-log/actors')
      .then(({ data }) => setActors((data as { actors: Actor[] }).actors ?? []))
      .catch(() => undefined);
    void get('/ordering/orders/branches')
      .then(({ data }) => setBranches((data as { results?: BranchOption[] }).results ?? []))
      .catch(() => undefined);
  }, [get]);

  const openDetail = async (entry: Entry) => {
    try {
      const { data } = await get(`/ordering/audit-log/${entry.id}?locale=${locale}`);
      setDetail(data as { entry: Entry; related: Entry[] });
    } catch (error) {
      toastError(error);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await get(`/ordering/audit-log/export?${params().toString()}`, {
        responseType: 'blob',
      } as never);
      const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
      const name =
        /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))?.[1] ??
        `lich-su-thay-doi-${from}_${to}.csv`;
      const url = URL.createObjectURL(new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const code = await blobErrorCode(error);
      toggleNotification({
        type: 'danger',
        message: (code ? t(`error.${code}`, undefined, '') : '') || t('audit.loadFailed'),
      });
    } finally {
      setExporting(false);
    }
  };

  const rows = body?.rows ?? [];

  return (
    <Page.Protect permissions={RBAC_AUDIT}>
      <Page.Title>{t('audit.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('audit.title')}
          subtitle={t('audit.subtitle')}
          primaryAction={
            canExport ? (
              <Button variant="tertiary" loading={exporting} onClick={() => void exportCsv()}>
                {t('audit.export')}
              </Button>
            ) : undefined
          }
        />
        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex gap={3} wrap="wrap" alignItems="end">
              <Box minWidth="150px">
                <Field.Root>
                  <Field.Label>{t('audit.filter.from')}</Field.Label>
                  <TextInput
                    type="date"
                    value={from}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)}
                  />
                </Field.Root>
              </Box>
              <Box minWidth="150px">
                <Field.Root>
                  <Field.Label>{t('audit.filter.to')}</Field.Label>
                  <TextInput
                    type="date"
                    value={to}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTo(event.target.value)}
                  />
                </Field.Root>
              </Box>
              <Box minWidth="200px">
                <Field.Root>
                  <Field.Label>{t('audit.filter.actor')}</Field.Label>
                  <SingleSelect value={actor} onChange={(value: string | number) => setActor(String(value))}>
                    <SingleSelectOption value={ALL}>{t('audit.filter.actor.all')}</SingleSelectOption>
                    {actors.map((item) => (
                      <SingleSelectOption key={item.ref} value={item.ref}>
                        {item.name ? `${item.name} (${item.ref})` : item.ref}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              {branches.length > 0 ? (
                <Box minWidth="160px">
                  <Field.Root>
                    <Field.Label>{t('audit.filter.branch')}</Field.Label>
                    <SingleSelect value={branch} onChange={(value: string | number) => setBranch(String(value))}>
                      <SingleSelectOption value={ALL}>{t('audit.category.all')}</SingleSelectOption>
                      {branches.map((item) => (
                        <SingleSelectOption key={item.code} value={item.code}>
                          {item.name?.[locale] || item.name?.vi || item.code}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Field.Root>
                </Box>
              ) : null}
              <Box minWidth="240px">
                <Field.Root>
                  <Field.Label>{t('audit.filter.q')}</Field.Label>
                  <TextInput
                    value={q}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value)}
                  />
                </Field.Root>
              </Box>
              <Button
                onClick={() => {
                  setPage(1);
                  setApplied((n) => n + 1);
                }}
              >
                {t('audit.filter.apply')}
              </Button>
            </Flex>
            <Flex gap={2} wrap="wrap">
              {CATEGORIES.map((item) => (
                <Button
                  key={item}
                  size="S"
                  variant={category === item ? 'default' : 'tertiary'}
                  onClick={() => {
                    setCategory(item);
                    setPage(1);
                  }}
                >
                  {t(`audit.category.${item}`)}
                </Button>
              ))}
            </Flex>
            {status === 'loading' && !body ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>{t('common.loading')}</Loader>
              </Flex>
            ) : status === 'scope' ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')} />
            ) : status === 'error' ? (
              <Alert
                variant="danger"
                closeLabel={t('common.close')}
                title={t('common.error.title')}
                action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
              >
                {t('audit.loadFailed')}
              </Alert>
            ) : rows.length === 0 ? (
              <EmptyStateLayout content={t('audit.empty')} />
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <Table colCount={6}>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">{t('audit.col.at')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('audit.col.actor')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('audit.col.action')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('audit.col.entity')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('audit.col.branch')}</Typography></Th>
                      <Th><Typography variant="sigma">{t('audit.col.summary')}</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((entry) => (
                      <Tr key={entry.id} onClick={() => void openDetail(entry)} style={{ cursor: 'pointer' }}>
                        <Td><Typography variant="pi">{formatDateTime(entry.occurredAt)}</Typography></Td>
                        <Td><Typography variant="pi">{actorOf(t, entry)}</Typography></Td>
                        <Td>
                          <Badge {...categoryTone(entry.category)}>{entry.actionLabel}</Badge>
                        </Td>
                        <Td>
                          <Typography variant="pi">{entry.entityLabel ?? `${entry.entityType} #${entry.entityId}`}</Typography>
                        </Td>
                        <Td><Typography variant="pi">{entry.locationRef ?? '—'}</Typography></Td>
                        <Td><Typography variant="pi">{summaryOf(t, entry.changes)}</Typography></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Flex justifyContent="flex-end" gap={2}>
                  <Button size="S" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Button size="S" variant="tertiary" disabled={!body?.hasNext} onClick={() => setPage(page + 1)}>
                    {t('common.next')}
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
            <Modal.Title>{t('audit.detail.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {detail ? (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Box>
                  <Typography fontWeight="bold">{detail.entry.actionLabel}</Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {actorOf(t, detail.entry)} · {formatDateTime(detail.entry.occurredAt)}
                    {detail.entry.locationRef ? ` · ${detail.entry.locationRef}` : ''}
                  </Typography>
                  <Typography variant="pi" tag="p">
                    {detail.entry.entityLabel ?? `${detail.entry.entityType} #${detail.entry.entityId}`}
                    {detail.entry.orderId ? (
                      <>
                        {' · '}
                        <Link to={`/plugins/ordering/orders/${detail.entry.orderId}`}>{t('audit.openOrder')}</Link>
                      </>
                    ) : null}
                  </Typography>
                  {detail.entry.requestId ? (
                    <Typography variant="pi" textColor="neutral500" tag="p">
                      {t('audit.detail.request', { id: detail.entry.requestId })}
                    </Typography>
                  ) : null}
                </Box>
                {Object.keys(detail.entry.changes ?? {}).length === 0 ? (
                  <Typography variant="pi">{t('audit.detail.noChanges')}</Typography>
                ) : (
                  <Table colCount={3}>
                    <Thead>
                      <Tr>
                        <Th><Typography variant="sigma">{t('audit.detail.field')}</Typography></Th>
                        <Th><Typography variant="sigma">{t('audit.detail.before')}</Typography></Th>
                        <Th><Typography variant="sigma">{t('audit.detail.after')}</Typography></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {Object.entries(detail.entry.changes ?? {}).map(([field, change]) => (
                        <Tr key={field}>
                          <Td><Typography variant="pi">{field}</Typography></Td>
                          <Td><Typography variant="pi">{showValue(t, field, change.before)}</Typography></Td>
                          <Td><Typography variant="pi">{showValue(t, field, change.after)}</Typography></Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
                {detail.related.length > 0 ? (
                  <Box>
                    <Typography variant="sigma">{t('audit.detail.related')}</Typography>
                    {detail.related.map((entry) => (
                      <Typography key={entry.id} variant="pi" tag="p">
                        {formatDateTime(entry.occurredAt)} · {entry.actionLabel} · {summaryOf(t, entry.changes)}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
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

export default AuditLogPage;
