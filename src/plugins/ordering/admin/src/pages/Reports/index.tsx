import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  EmptyStateLayout,
  Field,
  Flex,
  Grid,
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
import { Layouts, Page, useFetchClient, useRBAC } from '@strapi/strapi/admin';

import { OrderExportModal } from '../../components/OrderExportModal';
import { formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS, RBAC_EXPORT } from '../../lib/permissions';

type BranchOption = {
  code: string;
  name: Record<string, string>;
  timezone: string;
  businessDateToday: string;
};

type GroupBy = 'day' | 'category' | 'product' | 'payment' | 'receive' | 'promotion';

type ReportRow = {
  key: string;
  label: string;
  orders: number;
  quantity?: number;
  gross?: number;
  revenue?: number;
  refunded?: number;
  /** O8 `promotion` grouping: positive VND taken off. */
  discount?: number;
};

type Report = {
  range: { from: string; to: string };
  branch: string | null;
  groupBy: GroupBy;
  summary: {
    revenue: number;
    refunded: number;
    orders: number;
    gross: number;
    averageOrder: number;
    net: number;
    /** O8: Σ discount adjustments on sold orders (positive VND). */
    discount?: number;
  };
  /** O8: ratings of the period's orders. */
  ratings?: { average: number | null; count: number };
  rows: ReportRow[];
  generatedAt: string;
};

const GROUPINGS: GroupBy[] = ['day', 'category', 'product', 'payment', 'receive', 'promotion'];
const ALL_BRANCHES = '';

const minusDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

/**
 * "Báo cáo" (screens V4): sales over a business-date range grouped by day, category,
 * product, payment or receive method. Numbers come from the order snapshot + payment/refund
 * ledgers — totals reconcile with the ledger, names stay as they were at order time.
 */
const ReportsPage = () => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const { allowedActions: exportAccess } = useRBAC(RBAC_EXPORT);

  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const loadReport = useCallback(
    async (code: string, fromDay: string, toDay: string, grouping: GroupBy) => {
      try {
        const params = new URLSearchParams({ from: fromDay, to: toDay, groupBy: grouping });
        if (code) params.set('branch', code);
        const { data } = await get(`/ordering/reports/sales?${params.toString()}`);
        const next = data as Report;
        setReport(next);
        setApplied({ from: fromDay, to: toDay });
        setStatus(next.rows.length === 0 ? 'empty' : 'ready');
      } catch {
        setStatus('error');
      }
    },
    [get],
  );

  useEffect(() => {
    let live = true;
    get('/ordering/reports/branches')
      .then(({ data }) => {
        if (!live) return;
        const list = (data as { branches: BranchOption[] }).branches;
        setBranches(list);
        if (list.length === 0) {
          setStatus('empty');
          return;
        }
        const today = list[0].businessDateToday;
        const weekAgo = minusDays(today, 6);
        setFrom(weekAgo);
        setTo(today);
        void loadReport('', weekAgo, today, 'day');
      })
      .catch(() => {
        if (live) setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [get, loadReport]);

  const apply = () => {
    if (from && to) {
      setStatus('loading');
      void loadReport(branch, from, to, groupBy);
    }
  };

  const columns = (grouping: GroupBy): string[] => {
    switch (grouping) {
      case 'day':
        return ['reports.col.day', 'reports.col.orders', 'reports.col.gross', 'reports.col.revenue', 'reports.col.refunded'];
      case 'category':
      case 'product':
        return ['reports.col.name', 'reports.col.quantity', 'reports.col.orders', 'reports.col.gross'];
      case 'payment':
        return ['reports.col.payment', 'reports.col.orders', 'reports.col.revenue', 'reports.col.refunded'];
      case 'receive':
        return ['reports.col.receive', 'reports.col.orders', 'reports.col.gross'];
      case 'promotion':
        return ['reports.col.promotion', 'reports.col.orders', 'reports.col.gross', 'reports.col.discount'];
    }
  };

  const labelOf = (row: ReportRow, grouping: GroupBy): string => {
    if (grouping === 'payment') return t(`method.${row.key}`, undefined, row.key);
    if (grouping === 'receive') return t(`receive.${row.key}`, undefined, row.key);
    return row.label;
  };

  const summaryCard = (label: string, value: string, hint?: string) => (
    <Card height="100%">
      <CardContent>
        <Flex direction="column" alignItems="start" gap={1}>
          <Typography variant="pi" textColor="neutral600">
            {label}
          </Typography>
          <Typography variant="alpha">{value}</Typography>
          {hint ? (
            <Typography variant="pi" textColor="neutral500">
              {hint}
            </Typography>
          ) : null}
        </Flex>
      </CardContent>
    </Card>
  );

  const rows = report?.rows ?? [];
  const summary = report?.summary;

  return (
    <Page.Protect permissions={PERMISSIONS.report}>
      <Page.Title>{t('reports.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('reports.title')}
          subtitle={t('reports.subtitle')}
          secondaryAction={
            exportAccess.canExport ? (
              <Button variant="tertiary" onClick={() => setExportOpen(true)}>
                {t('reports.export')}
              </Button>
            ) : undefined
          }
        />
        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex gap={4} wrap="wrap" alignItems="end">
              <Box minWidth="200px">
                <Field.Root>
                  <Field.Label>{t('reports.field.branch')}</Field.Label>
                  <SingleSelect
                    value={branch}
                    onChange={(value: string | number) => setBranch(String(value))}
                  >
                    <SingleSelectOption value={ALL_BRANCHES}>
                      {t('reports.field.allBranches')}
                    </SingleSelectOption>
                    {(branches ?? []).map((option) => (
                      <SingleSelectOption key={option.code} value={option.code}>
                        {localized(option.name, locale) || option.code}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="160px">
                <Field.Root>
                  <Field.Label>{t('reports.field.from')}</Field.Label>
                  <TextInput
                    type="date"
                    value={from}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setFrom(event.target.value)
                    }
                  />
                </Field.Root>
              </Box>
              <Box minWidth="160px">
                <Field.Root>
                  <Field.Label>{t('reports.field.to')}</Field.Label>
                  <TextInput
                    type="date"
                    value={to}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setTo(event.target.value)
                    }
                  />
                </Field.Root>
              </Box>
              <Box minWidth="180px">
                <Field.Root>
                  <Field.Label>{t('reports.field.groupBy')}</Field.Label>
                  <SingleSelect
                    value={groupBy}
                    onChange={(value: string | number) => setGroupBy(value as GroupBy)}
                  >
                    {GROUPINGS.map((grouping) => (
                      <SingleSelectOption key={grouping} value={grouping}>
                        {t(`reports.group.${grouping}`)}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Button onClick={apply} disabled={!from || !to}>
                {t('reports.apply')}
              </Button>
            </Flex>

            {status === 'loading' ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>{t('common.loading')}</Loader>
              </Flex>
            ) : status === 'error' ? (
              <Alert
                variant="danger"
                closeLabel={t('common.close')}
                title={t('common.error.title')}
                action={
                  <Button onClick={apply}>{t('common.retry')}</Button>
                }
              >
                {t('reports.loadFailed')}
              </Alert>
            ) : status === 'empty' || !report || !summary ? (
              <EmptyStateLayout content={t('reports.empty')} />
            ) : (
              <>
                <Grid.Root gap={4}>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(t('reports.card.revenue'), formatMoney(summary.revenue))}
                  </Grid.Item>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(t('reports.card.orders'), String(summary.orders))}
                  </Grid.Item>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(t('reports.card.average'), formatMoney(summary.averageOrder))}
                  </Grid.Item>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(
                      t('reports.card.refunded'),
                      formatMoney(summary.refunded),
                      t('reports.card.net', { amount: formatMoney(summary.net) }),
                    )}
                  </Grid.Item>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(t('reports.card.discount'), formatMoney(summary.discount ?? 0))}
                  </Grid.Item>
                  <Grid.Item col={3} s={6}>
                    {summaryCard(
                      t('reports.card.rating', { count: report.ratings?.count ?? 0 }),
                      report.ratings?.average == null ? '—' : `${report.ratings.average} ★`,
                    )}
                  </Grid.Item>
                </Grid.Root>

                <Table colCount={columns(report.groupBy).length}>
                  <Thead>
                    <Tr>
                      {columns(report.groupBy).map((key) => (
                        <Th key={key}>
                          <Typography variant="sigma">{t(key)}</Typography>
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => (
                      <Tr key={row.key}>
                        <Td>
                          <Typography variant="pi">
                            {report.groupBy === 'day' ? row.key : labelOf(row, report.groupBy)}
                          </Typography>
                        </Td>
                        {report.groupBy === 'category' || report.groupBy === 'product' ? (
                          <Td>
                            <Typography variant="pi">{row.quantity ?? 0}</Typography>
                          </Td>
                        ) : null}
                        <Td>
                          <Typography variant="pi">{row.orders}</Typography>
                        </Td>
                        {report.groupBy === 'day' ||
                        report.groupBy === 'category' ||
                        report.groupBy === 'product' ||
                        report.groupBy === 'receive' ||
                        report.groupBy === 'promotion' ? (
                          <Td>
                            <Typography variant="pi">{formatMoney(row.gross ?? 0)}</Typography>
                          </Td>
                        ) : null}
                        {report.groupBy === 'promotion' ? (
                          <Td>
                            <Typography variant="pi">{`−${formatMoney(row.discount ?? 0)}`}</Typography>
                          </Td>
                        ) : null}
                        {report.groupBy === 'day' || report.groupBy === 'payment' ? (
                          <>
                            <Td>
                              <Typography variant="pi">{formatMoney(row.revenue ?? 0)}</Typography>
                            </Td>
                            <Td>
                              <Typography
                                variant="pi"
                                textColor={(row.refunded ?? 0) > 0 ? 'warning600' : undefined}
                              >
                                {(row.refunded ?? 0) > 0 ? `−${formatMoney(row.refunded)}` : '—'}
                              </Typography>
                            </Td>
                          </>
                        ) : null}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Typography variant="pi" textColor="neutral600">
                  {t('reports.hint')}
                </Typography>
                {applied ? (
                  <Typography variant="pi" textColor="neutral500">
                    {t('reports.range', { from: applied.from, to: applied.to })}
                  </Typography>
                ) : null}
              </>
            )}
          </Flex>
        </Layouts.Content>
      </Page.Main>
      <OrderExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        branches={branches ?? []}
        initialBranch={branch === ALL_BRANCHES ? '' : branch}
        initialFrom={from}
        initialTo={to}
      />
    </Page.Protect>
  );
};

export default ReportsPage;
