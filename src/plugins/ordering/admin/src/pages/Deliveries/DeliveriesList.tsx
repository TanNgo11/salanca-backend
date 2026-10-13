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
  SingleSelect,
  SingleSelectOption,
  Table,
  Tabs,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { useOrderingInbox } from '../../inbox/OrderingInboxProvider';
import { formatMoney, formatTime, localized } from '../../lib/format';
import { httpStatusOf } from '../../lib/api';
import { useLocale, useT } from '../../lib/i18n';
import { RBAC_DETAIL } from '../../lib/permissions';
import type { DeliveryStaff, OrderRow } from '../../lib/types';
import { useOrderActions } from '../../lib/useOrderActions';
import { AssignDialog, CollectDialog, FailDialog } from './DeliveryDialogs';

const TABS = ['ready', 'out', 'failed'] as const;
type Tab = (typeof TABS)[number];
const BRANCH_KEY = 'ordering.inbox.branch';

type StaffBranch = { code: string; name: Record<string, string>; timezone: string };
type ListResponse = {
  results: OrderRow[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  counts: Record<string, number>;
};

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
};

/**
 * "Đơn giao" board (screens D2): legs ready to leave, on the road and failed drops. Assignment
 * and the fail dialog post through the generic transition endpoint; the collect button is the
 * cash-handover endpoint — all inside the staff's branch scope.
 */
export const DeliveriesList = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const inbox = useOrderingInbox();
  const { allowedActions } = useRBAC(RBAC_DETAIL);
  const can = {
    canProcess: allowedActions.canProcess,
    canRecordCash: allowedActions.canRecordCash,
  };

  const [branches, setBranches] = useState<StaffBranch[] | null>(null);
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<Tab>('ready');
  const [assignee, setAssignee] = useState('');
  const [staff, setStaff] = useState<DeliveryStaff[] | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [dialog, setDialog] = useState<
    { kind: 'assign' | 'fail' | 'collect'; order: OrderRow } | null
  >(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: response } = await get('/ordering/orders/branches');
        const items = ((response as { results?: StaffBranch[] })?.results ?? []) as StaffBranch[];
        setBranches(items);
        const chosen = items.find((item) => item.code === remembered()) ?? items[0];
        if (chosen) setBranch(chosen.code);
        else setStatus('ready');
      } catch (error) {
        const code = httpStatusOf(error);
        setStatus(code === 403 ? 'forbidden' : 'error');
      }
    })();
  }, [get]);

  useEffect(() => {
    if (!branch) return;
    setStaffLoading(true);
    get(`/ordering/orders/delivery-staff?branch=${encodeURIComponent(branch)}`)
      .then(({ data: response }) => setStaff((response as { results?: DeliveryStaff[] })?.results ?? []))
      .catch(() => setStaff([]))
      .finally(() => setStaffLoading(false));
  }, [branch, get]);

  const load = useCallback(async () => {
    if (!branch) return;
    const params = new URLSearchParams({ receive: 'delivery', tab, branch, page: String(page), pageSize: '20' });
    if (assignee) params.set('assignee', assignee);
    try {
      const { data: response } = await get(`/ordering/orders?${params.toString()}`);
      setData(response as ListResponse);
      setStatus('ready');
    } catch (error) {
      const code = httpStatusOf(error);
      setStatus(code === 403 ? 'forbidden' : 'error');
    }
  }, [assignee, branch, get, page, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => inbox?.subscribe(() => void load()),
    [inbox, load],
  );

  const actions = useOrderActions(() => void load());
  const timezone = useMemo(
    () => branches?.find((item) => item.code === branch)?.timezone ?? 'Asia/Ho_Chi_Minh',
    [branch, branches],
  );
  const branchName = localized(branches?.find((item) => item.code === branch)?.name, locale);

  const run = async (promise: Promise<boolean>) => {
    if (await promise) setDialog(null);
  };

  const rowActions = (row: OrderRow) => {
    const buttons: React.ReactNode[] = [];
    const busy = actions.busy !== null;
    if (tab === 'ready' && can.canProcess) {
      buttons.push(
        <Button key="assign" size="S" disabled={busy} onClick={() => setDialog({ kind: 'assign', order: row })}>
          {t('deliveries.action.assign')}
        </Button>,
      );
    }
    if (tab === 'out') {
      if ((row.delivery?.due ?? 0) > 0 && can.canRecordCash) {
        buttons.push(
          <Button
            key="collect"
            size="S"
            disabled={busy}
            onClick={() => setDialog({ kind: 'collect', order: row })}
          >
            {t('deliveries.action.collect')}
          </Button>,
        );
      } else if (can.canProcess) {
        buttons.push(
          <Button
            key="delivered"
            size="S"
            loading={actions.busy === 'transition:delivered'}
            onClick={() => void actions.transition(row.id, { to: 'delivered', notifyCustomer: true })}
          >
            {t('deliveries.action.delivered')}
          </Button>,
        );
      }
      if (can.canProcess) {
        buttons.push(
          <Button
            key="fail"
            size="S"
            variant="danger-light"
            disabled={busy}
            onClick={() => setDialog({ kind: 'fail', order: row })}
          >
            {t('deliveries.action.fail')}
          </Button>,
        );
      }
    }
    if (tab === 'failed' && can.canProcess) {
      buttons.push(
        <Button
          key="retry"
          size="S"
          loading={actions.busy === 'transition:ready'}
          onClick={() => void actions.transition(row.id, { to: 'ready' })}
        >
          {t('deliveries.action.retry')}
        </Button>,
      );
    }
    return buttons;
  };

  const header = (
    <Layouts.Header
      title={t('deliveries.title')}
      subtitle={t('deliveries.subtitle', { branch: branchName || '—' })}
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
        <Flex gap={3} wrap="wrap" alignItems="flex-end" paddingBottom={4}>
          <Field.Root>
            <Field.Label>{t('orders.filter.branch')}</Field.Label>
            <SingleSelect
              value={branch}
              onChange={(value: string | number) => {
                const code = String(value);
                setBranch(code);
                setPage(1);
                try {
                  window.localStorage.setItem(BRANCH_KEY, code);
                } catch {
                  /* private mode */
                }
              }}
            >
              {(branches ?? []).map((item) => (
                <SingleSelectOption key={item.code} value={item.code}>
                  {localized(item.name, locale)}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('deliveries.filter.assignee')}</Field.Label>
            <SingleSelect
              value={assignee}
              onChange={(value: string | number) => {
                setAssignee(String(value));
                setPage(1);
              }}
            >
              <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
              <SingleSelectOption value="unassigned">{t('deliveries.filter.unassigned')}</SingleSelectOption>
              <SingleSelectOption value="mine">{t('deliveries.filter.mine')}</SingleSelectOption>
              <SingleSelectOption value="other">{t('deliveries.filter.other')}</SingleSelectOption>
              {(staff ?? []).map((member) => (
                <SingleSelectOption key={member.ref} value={member.ref}>
                  {member.name}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Flex>
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
                {t(`deliveries.tab.${item}`)}
                {data?.counts[item] ? ` (${data.counts[item]})` : ''}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <Box paddingTop={4}>
          {status === 'loading' || (status === 'ready' && data === null) ? (
            <Flex justifyContent="center" padding={10}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' ? (
            <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')} action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}>
              {t('deliveries.loadFailed')}
            </Alert>
          ) : !data || data.results.length === 0 ? (
            <EmptyStateLayout content={t(assignee ? 'deliveries.empty.filtered' : `deliveries.empty.${tab}`)} />
          ) : (
            <>
              <Table colCount={6} rowCount={data.results.length + 1}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('deliveries.col.code')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('deliveries.col.courier')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('deliveries.col.address')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('deliveries.col.due')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('deliveries.col.departed')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('orders.col.actions')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {data.results.map((row) => (
                    <Tr
                      key={row.id}
                      onClick={() => navigate(`/plugins/ordering/orders/${row.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Td>
                        <Typography fontWeight="semiBold">{row.code}</Typography>
                      </Td>
                      <Td onClick={(event: React.MouseEvent) => event.stopPropagation()}>
                        {row.delivery?.carrier ? (
                          <Typography>
                            {row.delivery.carrier}
                            {row.delivery.trackingNumber ? ` · ${row.delivery.trackingNumber}` : ''}
                          </Typography>
                        ) : row.delivery?.assigneeName ? (
                          <Typography>{row.delivery.assigneeName}</Typography>
                        ) : (
                          <Badge>{t('deliveries.unassigned')}</Badge>
                        )}
                      </Td>
                      <Td>
                        <Typography>
                          {[row.delivery?.address?.line1, row.delivery?.address?.wardName]
                            .filter(Boolean)
                            .join(', ') || '—'}
                        </Typography>
                      </Td>
                      <Td>
                        {(row.delivery?.due ?? 0) > 0 ? (
                          <Typography fontWeight="semiBold">{formatMoney(row.delivery?.due)}</Typography>
                        ) : (
                          <Badge>{t('deliveries.paid')}</Badge>
                        )}
                      </Td>
                      <Td>
                        <Typography>{formatTime(row.delivery?.shippedAt, timezone)}</Typography>
                      </Td>
                      <Td onClick={(event: React.MouseEvent) => event.stopPropagation()}>
                        <Flex gap={1}>{rowActions(row)}</Flex>
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
        {dialog?.kind === 'assign' ? (
          <AssignDialog
            staff={staff}
            staffLoading={staffLoading}
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(body) => void run(actions.transition(dialog.order.id, body))}
          />
        ) : null}
        {dialog?.kind === 'fail' ? (
          <FailDialog
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(body) => void run(actions.transition(dialog.order.id, body))}
          />
        ) : null}
        {dialog?.kind === 'collect' ? (
          <CollectDialog
            due={dialog.order.delivery?.due ?? 0}
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={() => void run(actions.cashHandover(dialog.order.id))}
          />
        ) : null}
      </Layouts.Content>
    </>
  );
};
