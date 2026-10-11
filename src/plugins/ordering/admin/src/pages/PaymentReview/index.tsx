import { useCallback, useEffect, useState } from 'react';
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
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tooltip,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { apiErrorOf, httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type Suggested = {
  id: number;
  code: string;
  due: number | null;
  locationRef: string;
  status: string | null;
};

type ReviewRow = {
  id: number;
  receivedAt: string;
  amount: number;
  content: string | null;
  accountMasked: string | null;
  locationRefs: 'all' | string[] | null;
  providerTransactionId: string;
  reviewStatus: string;
  reviewReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  suggestedOrder: Suggested | null;
  canReopen: boolean;
  staffReason: string | null;
};

type ListBody = {
  results: ReviewRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts: { open: number; resolved: number };
};

type ActionName = 'assign' | 'refund-due' | 'reopen' | 'ignore';

const REASONS = [
  'no-code',
  'order-not-found',
  'underpaid',
  'overpaid',
  'order-closed',
  'already-paid',
  'account-mismatch',
  'review-all',
] as const;

const reasonLabel = (t: Translate, reason: string | null): string => {
  switch (reason) {
    case 'no-code':
      return t('review.reason.no-code');
    case 'order-not-found':
      return t('review.reason.order-not-found');
    case 'underpaid':
      return t('review.reason.underpaid');
    case 'overpaid':
      return t('review.reason.overpaid');
    case 'order-closed':
      return t('review.reason.order-closed');
    case 'already-paid':
      return t('review.reason.already-paid');
    case 'account-mismatch':
      return t('review.reason.account-mismatch');
    case 'review-all':
      return t('review.reason.review-all');
    default:
      return reason ?? '—';
  }
};

const outcomeLabel = (t: Translate, status: string): string => {
  switch (status) {
    case 'matched-manually':
      return t('review.outcome.matched-manually');
    case 'refund-due':
      return t('review.outcome.refund-due');
    case 'ignored':
      return t('review.outcome.ignored');
    default:
      return status;
  }
};

const locationLabel = (t: Translate, refs: ReviewRow['locationRefs']): string => {
  if (refs === 'all') return t('review.account.all');
  if (!refs || refs.length === 0) return t('review.account.unknown');
  return refs.join(', ');
};

const clip = (value: string | null): string => {
  if (!value) return '—';
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
};

const previewText = (t: Translate, amount: number, due: number): string => {
  if (amount < due) {
    return t('review.preview.short', { amount: formatMoney(amount), remain: formatMoney(due - amount) });
  }
  if (amount > due) return t('review.preview.over', { extra: formatMoney(amount - due) });
  return t('review.preview.exact', { amount: formatMoney(amount) });
};

const ReviewDialog = ({ row, onClose, onDone }: { row: ReviewRow; onClose: () => void; onDone: () => void }) => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [action, setAction] = useState<ActionName>(row.canReopen ? 'reopen' : 'assign');
  const [picked, setPicked] = useState<Suggested | null>(row.suggestedOrder);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Suggested[]>([]);
  const [searched, setSearched] = useState(false);
  const [reason, setReason] = useState('');
  const [amountText, setAmountText] = useState(String(row.amount));
  const [saving, setSaving] = useState(false);

  const search = async () => {
    setSearched(true);
    try {
      const { data } = await get(`/ordering/payment-reviews/orders?q=${encodeURIComponent(query.trim())}`);
      setFound((data as { results: Suggested[] }).results);
    } catch (error) {
      toastError(error);
    }
  };

  const amount = Number(amountText);
  const needsOrder = action === 'assign' || action === 'reopen';
  const amountOk = Number.isSafeInteger(amount) && amount > 0 && amount <= row.amount;
  const blocked =
    saving ||
    reason.trim().length < 5 ||
    (needsOrder && !picked) ||
    (action === 'reopen' && !row.canReopen) ||
    (action === 'refund-due' && !amountOk);

  const submit = async () => {
    setSaving(true);
    const note = reason.trim();
    const path =
      action === 'assign'
        ? `/ordering/payment-reviews/${row.id}/assign`
        : action === 'refund-due'
          ? `/ordering/payment-reviews/${row.id}/refund-due`
          : action === 'reopen'
            ? `/ordering/payment-reviews/${row.id}/reopen`
            : `/ordering/payment-reviews/${row.id}/ignore`;
    const body =
      action === 'refund-due'
        ? { amount, reason: note }
        : needsOrder
          ? { orderId: picked?.id, reason: note }
          : { reason: note };
    try {
      await post(path, body);
      toggleNotification({ type: 'success', message: t('review.saved') });
      onDone();
    } catch (error) {
      toastError(error);
      if (apiErrorOf(error).code === 'REVIEW_ALREADY_RESOLVED') onDone();
    } finally {
      setSaving(false);
    }
  };

  const choices: Array<[ActionName, string]> = [
    ['assign', t('review.action.assign')],
    ['refund-due', t('review.action.refundDue')],
    ['reopen', t('review.action.reopen')],
    ['ignore', t('review.action.ignore')],
  ];

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open && !saving ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{formatMoney(row.amount)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex direction="column" alignItems="stretch" gap={1}>
              <Typography>{row.content || '—'}</Typography>
              <Typography variant="pi" textColor="neutral600">
                {formatDateTime(row.receivedAt)} · {row.providerTransactionId} · {reasonLabel(t, row.reviewReason)}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {row.accountMasked ?? '—'} · {locationLabel(t, row.locationRefs)}
              </Typography>
            </Flex>
            <Flex gap={2} wrap="wrap">
              {choices.map(([name, label]) => (
                <Button
                  key={name}
                  size="S"
                  variant={action === name ? 'default' : 'tertiary'}
                  onClick={() => setAction(name)}
                >
                  {label}
                </Button>
              ))}
            </Flex>
            {needsOrder ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Field.Root>
                  <Field.Label>{t('review.field.order')}</Field.Label>
                  <Flex gap={2}>
                    <Box minWidth="220px" grow={1}>
                      <TextInput
                        name="order-search"
                        placeholder={t('review.field.search')}
                        value={query}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                      />
                    </Box>
                    <Button variant="secondary" onClick={() => void search()}>
                      {t('review.search.go')}
                    </Button>
                  </Flex>
                </Field.Root>
                <Flex gap={2} wrap="wrap">
                  {row.suggestedOrder ? (
                    <Button
                      size="S"
                      variant={picked?.id === row.suggestedOrder.id ? 'default' : 'secondary'}
                      onClick={() => setPicked(row.suggestedOrder)}
                    >
                      {row.suggestedOrder.code} · {t('review.due', { amount: formatMoney(row.suggestedOrder.due ?? 0) })}
                    </Button>
                  ) : null}
                  {found.map((item) =>
                    item.id === row.suggestedOrder?.id ? null : (
                      <Button
                        key={item.id}
                        size="S"
                        variant={picked?.id === item.id ? 'default' : 'secondary'}
                        onClick={() => setPicked(item)}
                      >
                        {item.code} · {t('review.due', { amount: formatMoney(item.due ?? 0) })}
                      </Button>
                    ),
                  )}
                </Flex>
                {searched && found.length === 0 ? (
                  <Typography variant="pi" textColor="neutral600">
                    {t('review.search.empty')}
                  </Typography>
                ) : null}
                {action === 'assign' && picked && picked.due !== null ? (
                  <Typography>{previewText(t, row.amount, picked.due)}</Typography>
                ) : null}
                {action === 'reopen' && !row.canReopen ? (
                  <Typography textColor="danger600">{t('review.reopen.unavailable')}</Typography>
                ) : null}
              </Flex>
            ) : null}
            {action === 'refund-due' ? (
              <Field.Root required>
                <Field.Label>{t('review.field.amount')}</Field.Label>
                <TextInput
                  name="refund-amount"
                  type="number"
                  value={amountText}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAmountText(event.target.value)}
                />
              </Field.Root>
            ) : null}
            <Field.Root required>
              <Field.Label>{t('review.field.reason')}</Field.Label>
              <Textarea
                name="review-reason"
                value={reason}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
              />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={blocked} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

const PaymentReviewPage = () => {
  const t = useT();
  const { get } = useFetchClient();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [reason, setReason] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [active, setActive] = useState<ReviewRow | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status: tab, page: String(page), pageSize: '25' });
    if (reason) params.set('reason', reason);
    if (branch.trim()) params.set('branch', branch.trim());
    if (from) params.set('from', `${from}T00:00:00+07:00`);
    if (to) params.set('to', `${to}T23:59:59+07:00`);
    if (search) params.set('q', search);
    try {
      const { data } = await get(`/ordering/payment-reviews?${params.toString()}`);
      setBody(data as ListBody);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [branch, from, get, page, reason, search, tab, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = body?.results ?? [];
  const resolved = tab === 'resolved';
  const colCount = resolved ? 10 : 7;

  return (
    <Page.Protect permissions={PERMISSIONS.review}>
      <Page.Title>{t('review.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('review.title')}
          subtitle={t('review.subtitle')}
          primaryAction={<Button disabled>{t('review.manual')}</Button>}
        />
        <Layouts.Content>
          <Flex gap={3} wrap="wrap" alignItems="flex-end" paddingBottom={4}>
            <Button
              variant={tab === 'open' ? 'default' : 'tertiary'}
              onClick={() => {
                setTab('open');
                setPage(1);
              }}
            >
              {t('review.tab.open', { count: body?.counts.open ?? 0 })}
            </Button>
            <Button
              variant={tab === 'resolved' ? 'default' : 'tertiary'}
              onClick={() => {
                setTab('resolved');
                setPage(1);
              }}
            >
              {t('review.tab.resolved', { count: body?.counts.resolved ?? 0 })}
            </Button>
            <Field.Root>
              <Field.Label>{t('review.filter.reason')}</Field.Label>
              <SingleSelect
                value={reason}
                onChange={(value: string | number) => {
                  setReason(String(value));
                  setPage(1);
                }}
              >
                <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
                {REASONS.map((item) => (
                  <SingleSelectOption key={item} value={item}>
                    {reasonLabel(t, item)}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('review.filter.branch')}</Field.Label>
              <TextInput
                name="branch"
                value={branch}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setBranch(event.target.value);
                  setPage(1);
                }}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('review.filter.from')}</Field.Label>
              <TextInput
                name="from"
                type="date"
                value={from}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('review.filter.to')}</Field.Label>
              <TextInput
                name="to"
                type="date"
                value={to}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </Field.Root>
            <Box minWidth="260px">
              <Searchbar
                name="q"
                value={query}
                placeholder={t('review.filter.search')}
                clearLabel={t('common.clear')}
                onClear={() => {
                  setQuery('');
                  setSearch('');
                  setPage(1);
                }}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                onSubmit={(event: React.FormEvent) => {
                  event.preventDefault();
                  setSearch(query.trim());
                  setPage(1);
                }}
              >
                {t('review.filter.search')}
              </Searchbar>
            </Box>
          </Flex>

          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status !== 'ready' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={status === 'scope' ? t('common.forbidden.title') : t('common.error.title')}
              action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
            >
              {status === 'scope' ? t('review.noScope') : t('review.loadFailed')}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyStateLayout content={t('review.empty')} />
          ) : (
            <>
              <Table colCount={colCount} rowCount={rows.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">{t('review.col.time')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('review.col.amount')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('review.col.content')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('review.col.account')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('review.col.reason')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('review.col.suggestion')}</Typography>
                    </Th>
                    {resolved ? (
                      <>
                        <Th>
                          <Typography variant="sigma">{t('review.col.outcome')}</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">{t('review.col.reviewer')}</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">{t('review.col.staffReason')}</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">{t('review.col.reviewedAt')}</Typography>
                        </Th>
                      </>
                    ) : (
                      <Th>
                        <Typography variant="sigma">{t('review.col.action')}</Typography>
                      </Th>
                    )}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <Typography>{formatDateTime(row.receivedAt)}</Typography>
                      </Td>
                      <Td style={{ textAlign: 'right' }}>
                        <Typography>{formatMoney(row.amount)}</Typography>
                      </Td>
                      <Td>
                        <Tooltip label={row.content || '—'}>
                          <Typography>{clip(row.content)}</Typography>
                        </Tooltip>
                      </Td>
                      <Td>
                        <Typography>
                          {row.accountMasked ?? '—'} · {locationLabel(t, row.locationRefs)}
                        </Typography>
                      </Td>
                      <Td>
                        <Badge>{reasonLabel(t, row.reviewReason)}</Badge>
                      </Td>
                      <Td>
                        <Typography>
                          {row.suggestedOrder
                            ? `${row.suggestedOrder.code} · ${t('review.due', { amount: formatMoney(row.suggestedOrder.due ?? 0) })}`
                            : '—'}
                        </Typography>
                      </Td>
                      {resolved ? (
                        <>
                          <Td>
                            <Typography>{outcomeLabel(t, row.reviewStatus)}</Typography>
                          </Td>
                          <Td>
                            <Typography>{row.reviewedBy ?? '—'}</Typography>
                          </Td>
                          <Td>
                            <Typography>{row.staffReason ?? '—'}</Typography>
                          </Td>
                          <Td>
                            <Typography>{formatDateTime(row.reviewedAt)}</Typography>
                          </Td>
                        </>
                      ) : (
                        <Td>
                          <Button size="S" onClick={() => setActive(row)}>
                            {t('review.action.review')}
                          </Button>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              {body && body.pagination.total > body.pagination.pageSize ? (
                <Flex gap={2} paddingTop={4} justifyContent="flex-end">
                  <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={page * body.pagination.pageSize >= body.pagination.total}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </Flex>
              ) : null}
            </>
          )}
          {active ? (
            <ReviewDialog
              key={active.id}
              row={active}
              onClose={() => setActive(null)}
              onDone={() => {
                setActive(null);
                void load();
              }}
            />
          ) : null}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default PaymentReviewPage;
