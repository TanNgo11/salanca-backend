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
import { Layouts, useFetchClient } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';

type Row = {
  id: string;
  name: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  status: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  marketing: boolean;
  createdAt: string;
};

type ListBody = { items: Row[]; page: number; pageSize: number; total: number };

const ALL = '__all__';
const STATUS_FILTERS = [ALL, 'verified', 'unverified'] as const;
const MARKETING_FILTERS = [ALL, 'yes'] as const;

/**
 * C1 (Vận hành → Khách hàng): the scoped customer directory. Phones/emails arrive masked
 * from the server; a phone-shaped query resolves server-side by HMAC, not by ilike.
 */
export const CustomersList = () => {
  const t = useT();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>(ALL);
  const [marketing, setMarketing] = useState<(typeof MARKETING_FILTERS)[number]>(ALL);
  const [applied, setApplied] = useState(0);
  const [page, setPage] = useState(1);
  const [body, setBody] = useState<ListBody | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');

  const load = useCallback(async () => {
    setState((current) => (current === 'ready' ? 'ready' : 'loading'));
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q.trim()) query.set('q', q.trim());
      if (status !== ALL) query.set('status', status);
      if (marketing !== ALL) query.set('marketing', marketing);
      const { data } = await get(`/ordering/customers?${query.toString()}`);
      setBody(data as ListBody);
      setState('ready');
    } catch (error) {
      setState(httpStatusOf(error) === 403 ? 'scope' : 'error');
      if (httpStatusOf(error) === 400) toastError(error);
    }
    // `applied` re-runs the query when "Lọc" is pressed; typing in a filter alone does not.
  }, [get, page, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = body?.items ?? [];
  const hasNext = body ? body.page * body.pageSize < body.total : false;

  return (
    <>
      <Layouts.Header title={t('customers.title')} subtitle={t('customers.subtitle')} />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Flex gap={3} wrap="wrap" alignItems="end">
            <Box minWidth="280px">
              <Field.Root>
                <Field.Label>{t('customers.filter.q')}</Field.Label>
                <TextInput
                  value={q}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value)}
                />
              </Field.Root>
            </Box>
            <Box minWidth="160px">
              <Field.Root>
                <Field.Label>{t('customers.filter.status')}</Field.Label>
                <SingleSelect
                  value={status}
                  onChange={(value: string | number) => setStatus(value as typeof status)}
                >
                  {STATUS_FILTERS.map((item) => (
                    <SingleSelectOption key={item} value={item}>
                      {t(`customers.filter.status.${item === ALL ? 'all' : item}`)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box minWidth="160px">
              <Field.Root>
                <Field.Label>{t('customers.filter.marketing')}</Field.Label>
                <SingleSelect
                  value={marketing}
                  onChange={(value: string | number) => setMarketing(value as typeof marketing)}
                >
                  {MARKETING_FILTERS.map((item) => (
                    <SingleSelectOption key={item} value={item}>
                      {t(`customers.filter.marketing.${item === ALL ? 'all' : item}`)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Button
              onClick={() => {
                setPage(1);
                setApplied((n) => n + 1);
              }}
            >
              {t('customers.filter.apply')}
            </Button>
          </Flex>
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
              {t('customers.loadFailed')}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyStateLayout content={t('customers.empty')} />
          ) : (
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Table colCount={7}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('customers.col.customer')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.phone')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.email')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.orders')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.spent')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.lastOrder')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('customers.col.marketing')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => (
                    <Tr
                      key={row.id}
                      onClick={() => navigate(`/plugins/ordering/customers/${row.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Td>
                        <Typography variant="pi" fontWeight="semiBold">
                          {row.name ?? t('customers.noName')}
                        </Typography>
                        {row.status === 'unverified' ? (
                          <Badge>{t('customers.status.unverified')}</Badge>
                        ) : null}
                      </Td>
                      <Td><Typography variant="pi">{row.phoneMasked ?? '—'}</Typography></Td>
                      <Td><Typography variant="pi">{row.emailMasked ?? '—'}</Typography></Td>
                      <Td><Typography variant="pi">{row.orderCount}</Typography></Td>
                      <Td><Typography variant="pi">{formatMoney(row.totalSpent)}</Typography></Td>
                      <Td><Typography variant="pi">{formatDateTime(row.lastOrderAt)}</Typography></Td>
                      <Td>{row.marketing ? <Badge>{t('customers.marketing.yes')}</Badge> : '—'}</Td>
                    </Tr>
                  ))}
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
    </>
  );
};
