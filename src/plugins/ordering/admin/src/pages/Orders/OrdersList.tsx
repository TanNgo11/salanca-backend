import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  IconButton,
  Loader,
  Searchbar,
  SearchForm,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tabs,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tooltip,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Eye, Plus } from '@strapi/icons';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { OrderExportModal } from '../../components/OrderExportModal';
import { PaymentBadge, StateBadge } from '../../components/orders/StatusBadges';
import { useOrderingInbox } from '../../inbox/OrderingInboxProvider';
import { formatBusinessDate, formatMoney, formatTime, localized } from '../../lib/format';
import { httpStatusOf } from '../../lib/api';
import { useLocale, useT } from '../../lib/i18n';
import { RBAC_EXPORT, RBAC_LIST } from '../../lib/permissions';
import type { OrderRow } from '../../lib/types';
import { useOrderActions } from '../../lib/useOrderActions';
import { OrderPreviewModal } from './OrderPreviewModal';
import { PauseBusyBar, type BranchAvailability } from './PauseBusyBar';

const TABS = ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'] as const;
type Tab = (typeof TABS)[number];
const BRANCH_KEY = 'ordering.inbox.branch';

type StaffBranch = {
  code: string;
  name: Record<string, string>;
  timezone: string;
  businessDate: string;
} & BranchAvailability;
type ListResponse = {
  results: OrderRow[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  counts: Record<Tab, number>;
};

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
};

/**
 * Order inbox (screens S1, TastyIgniter list + WooCommerce preview): tabs group workflow states,
 * filters by branch (scope only), business date, search, payment and source; realtime refresh
 * from the inbox provider plus its polling fallback.
 */
export const OrdersList = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const inbox = useOrderingInbox();
  const { allowedActions } = useRBAC(RBAC_LIST);
  const { allowedActions: exportAccess } = useRBAC(RBAC_EXPORT);

  const [branches, setBranches] = useState<StaffBranch[] | null>(null);
  const [branch, setBranch] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  const [tab, setTab] = useState<Tab>('awaiting');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState('');
  const [origin, setOrigin] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      const { data: response } = await get('/ordering/orders/branches');
      const items = ((response as { results?: StaffBranch[] })?.results ?? []) as StaffBranch[];
      setBranches(items);
      setBranch((current) => {
        const chosen = items.find((item) => item.code === (current || remembered())) ?? items[0];
        if (chosen) setBusinessDate((date) => date || chosen.businessDate);
        return chosen?.code ?? current;
      });
      if (items.length === 0) setStatus('ready');
    } catch (error) {
      const code = httpStatusOf(error);
      setStatus(code === 403 ? 'forbidden' : 'error');
    }
  }, [get]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const load = useCallback(async () => {
    if (!branch) return;
    const params = new URLSearchParams({ tab, branch, page: String(page), pageSize: '20' });
    if (search) params.set('q', search);
    else if (businessDate) params.set('businessDate', businessDate);
    if (payment) params.set('payment', payment);
    if (origin) params.set('origin', origin);
    try {
      const { data: response } = await get(`/ordering/orders?${params.toString()}`);
      setData(response as ListResponse);
      setStatus('ready');
    } catch (error) {
      const code = httpStatusOf(error);
      setStatus(code === 403 ? 'forbidden' : 'error');
    }
  }, [branch, businessDate, get, origin, page, payment, search, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      inbox?.subscribe((event) => {
        if (event.type === 'order.created') setFresh((current) => new Set(current).add(event.orderId));
        void load();
      }),
    [inbox, load],
  );

  const actions = useOrderActions(() => void load());
  const activeBranch = useMemo(() => branches?.find((item) => item.code === branch), [branch, branches]);
  const timezone = activeBranch?.timezone ?? 'Asia/Ho_Chi_Minh';
  const branchName = localized(activeBranch?.name, locale);
  const filtered = Boolean(search || payment || origin);

  const header = (
    <Layouts.Header
      title={t('orders.title')}
      subtitle={t('orders.subtitle', { date: formatBusinessDate(businessDate), branch: branchName || '—' })}
      primaryAction={
        allowedActions.canCreate ? (
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('orders.create')}
          </Button>
        ) : undefined
      }
      secondaryAction={
        exportAccess.canExport ? (
          <Button variant="tertiary" onClick={() => setExportOpen(true)}>
            {t('export.download')}
          </Button>
        ) : undefined
      }
    />
  );

  if (status === 'forbidden') {
    return (
      <>
        {header}
        <Layouts.Content>
          <Alert variant="danger" closeLabel={t('common.close')} title={t('common.forbidden.title')}>
            {t('orders.noScope')}
          </Alert>
        </Layouts.Content>
      </>
    );
  }

  return (
    <>
      {header}
      <Layouts.Content>
        {branch ? (
          <PauseBusyBar
            branch={branch}
            availability={activeBranch}
            timezone={timezone}
            canProcess={allowedActions.canProcess === true}
            onChanged={() => void loadBranches()}
          />
        ) : null}
        <Flex gap={3} wrap="wrap" alignItems="flex-end" paddingBottom={4}>
          <Field.Root>
            <Field.Label>{t('orders.filter.branch')}</Field.Label>
            <SingleSelect
              value={branch}
              onChange={(value: string | number) => {
                const code = String(value);
                setBranch(code);
                setPage(1);
                const found = branches?.find((item) => item.code === code);
                if (found) setBusinessDate(found.businessDate);
                try {
                  window.localStorage.setItem(BRANCH_KEY, code);
                } catch {
                  // ignore
                }
              }}
            >
              {(branches ?? []).map((item) => (
                <SingleSelectOption key={item.code} value={item.code}>
                  {localized(item.name, locale) || item.code}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('orders.filter.businessDate')}</Field.Label>
            <TextInput
              type="date"
              value={businessDate}
              disabled={Boolean(search)}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setBusinessDate(event.target.value);
                setPage(1);
              }}
            />
          </Field.Root>
          <Box minWidth="260px">
            {/* `Searchbar` renders a bare <input>: Enter only submits inside a <form>, so the form owns onSubmit. */}
            <SearchForm
              onSubmit={(event: React.FormEvent) => {
                event.preventDefault();
                setSearch(query.trim());
                setPage(1);
              }}
            >
              <Searchbar
                name="q"
                value={query}
                placeholder={t('orders.filter.search')}
                clearLabel={t('common.clear')}
                onClear={() => {
                  setQuery('');
                  setSearch('');
                }}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              >
                {t('orders.filter.search')}
              </Searchbar>
            </SearchForm>
          </Box>
          <Field.Root>
            <Field.Label>{t('orders.filter.payment')}</Field.Label>
            <SingleSelect value={payment} onChange={(value: string | number) => setPayment(String(value))}>
              <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
              {['unpaid', 'paid', 'partially-refunded', 'refunded'].map((item) => (
                <SingleSelectOption key={item} value={item}>
                  {t(`payment.${item}`)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('orders.filter.origin')}</Field.Label>
            <SingleSelect value={origin} onChange={(value: string | number) => setOrigin(String(value))}>
              <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
              <SingleSelectOption value="storefront">{t('origin.storefront')}</SingleSelectOption>
              <SingleSelectOption value="staff-draft">{t('origin.staff-draft')}</SingleSelectOption>
            </SingleSelect>
          </Field.Root>
        </Flex>

        <Tabs.Root
          value={tab}
          onValueChange={(value: string) => {
            setTab(value as Tab);
            setPage(1);
          }}
        >
          <Tabs.List aria-label={t('orders.title')}>
            {TABS.map((item) => (
              <Tabs.Trigger key={item} value={item}>
                {t(`tab.${item}`)} ({data?.counts?.[item] ?? 0})
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>

        <Box paddingTop={4}>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={t('common.error.title')}
              action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
            >
              {t('orders.loadFailed')}
            </Alert>
          ) : !data || data.results.length === 0 ? (
            <EmptyStateLayout
              content={filtered ? t('orders.empty.filtered') : t(`orders.empty.${tab}`)}
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setSearch('');
                      setPayment('');
                      setOrigin('');
                    }}
                  >
                    {t('orders.clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table colCount={10} rowCount={data.results.length + 1}>
                <Thead>
                  <Tr>
                    {['code', 'pickup', 'customer', 'items', 'total', 'payment', 'state', 'waiting', 'origin', 'actions'].map(
                      (column) => (
                        <Th key={column}>
                          <Typography variant="sigma">{t(`orders.col.${column}`)}</Typography>
                        </Th>
                      ),
                    )}
                  </Tr>
                </Thead>
                <Tbody>
                  {data.results.map((row) => (
                    <Tr
                      key={row.id}
                      onClick={() => navigate(String(row.id))}
                      style={{ cursor: 'pointer', background: fresh.has(row.id) ? 'var(--ordering-fresh, #fdf4dc)' : undefined }}
                    >
                      <Td>
                        <Typography fontWeight={fresh.has(row.id) ? 'bold' : 'semiBold'}>{row.code}</Typography>
                      </Td>
                      <Td>
                        {row.receive.slotStartsAt ? (
                          <Typography>{formatTime(row.receive.slotStartsAt, timezone)}</Typography>
                        ) : (
                          <Badge>{t('summary.asap')}</Badge>
                        )}
                      </Td>
                      <Td>
                        <Typography>
                          {[row.customer.name, row.customer.phoneMasked].filter(Boolean).join(' · ') || '—'}
                        </Typography>
                      </Td>
                      <Td>
                        <Tooltip label={row.items.map((item) => `${item.quantity} × ${item.title}`).join(', ')}>
                          <Typography>{t('orders.itemCount', { count: row.itemCount })}</Typography>
                        </Tooltip>
                      </Td>
                      <Td style={{ textAlign: 'right' }}>
                        <Typography>{formatMoney(row.total)}</Typography>
                      </Td>
                      <Td>
                        <PaymentBadge status={row.paymentStatus} />
                      </Td>
                      <Td>
                        {row.status === 'draft' ? <Badge>{t('state.draft')}</Badge> : <StateBadge status={row.groupStatus} />}
                      </Td>
                      <Td>
                        <Typography textColor={row.overdue ? 'danger600' : 'neutral800'}>
                          {t('orders.minutes', { minutes: row.waitingMinutes })}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography>{t(`origin.${row.origin}`)}</Typography>
                      </Td>
                      <Td onClick={(event: React.MouseEvent) => event.stopPropagation()}>
                        <Flex gap={1}>
                          <IconButton label={t('orders.preview')} variant="ghost" onClick={() => setPreview(row.id)}>
                            <Eye />
                          </IconButton>
                          {row.next && allowedActions.canProcess && row.next.requires.length === 0 ? (
                            <Button
                              size="S"
                              loading={actions.busy === `transition:${row.next.to}`}
                              onClick={() => void actions.transition(row.id, { to: row.next!.to, notifyCustomer: true })}
                            >
                              {t(`transition.${row.next.to}`)}
                            </Button>
                          ) : null}
                        </Flex>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              {data.pagination.pageCount > 1 ? (
                <Flex justifyContent="flex-end" gap={2} paddingTop={4}>
                  <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Typography>
                    {page}/{data.pagination.pageCount}
                  </Typography>
                  <Button
                    variant="tertiary"
                    disabled={page >= data.pagination.pageCount}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </Flex>
              ) : null}
            </>
          )}
        </Box>
        {preview !== null ? (
          <OrderPreviewModal orderId={preview} onClose={() => setPreview(null)} onChanged={() => void load()} />
        ) : null}
        <OrderExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          branches={branches ?? []}
          initialBranch={branch}
          initialFrom={businessDate}
          initialTo={businessDate}
        />
      </Layouts.Content>
    </>
  );
};
