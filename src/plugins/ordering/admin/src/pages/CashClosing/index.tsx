import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Modal,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Table,
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

import { fieldErrors, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type BranchOption = {
  code: string;
  name: Record<string, string>;
  timezone: string;
  businessDateToday: string;
};

type Closing = {
  id: number;
  countedAmount: number;
  differenceAmount: number;
  note: string | null;
  closedBy: string;
  closedByName: string | null;
  closedAt: string;
  revision: number;
  adjustmentReason: string | null;
};

type CollectorRow = {
  collectorRef: string;
  collectorName: string | null;
  orderCount: number;
  systemAmount: number;
  refundAmount: number;
  expectedAmount: number;
  closing: Closing | null;
};

type Summary = {
  branch: { code: string; name: Record<string, string>; timezone: string };
  businessDate: string;
  isToday: boolean;
  rows: CollectorRow[];
  totals: { orderCount: number; systemAmount: number; refundAmount: number; expectedAmount: number };
};

type Draft = { counted: number | undefined; note: string };
const DRAFT_DEFAULTS: Draft = { counted: undefined, note: '' };

/**
 * "Chốt tiền mặt" (screens V3): one row per cash collector for a branch + business date. Open
 * rows take the physical count (a note is mandatory when it differs from the system); closed
 * rows are read-only and corrected through an adjustment revision with a required reason.
 */
const CashClosingPage = () => {
  const t = useT();
  const locale = useLocale();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();

  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState<CollectorRow | null>(null);
  const [adjusting, setAdjusting] = useState<CollectorRow | null>(null);
  const [adjustForm, setAdjustForm] = useState<{ counted: number | undefined; note: string; reason: string }>(
    { counted: undefined, note: '', reason: '' },
  );
  const [busy, setBusy] = useState<string | number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const timezone = summary?.branch.timezone ?? 'Asia/Ho_Chi_Minh';

  const loadSummary = useCallback(
    async (code: string, day: string) => {
      try {
        const { data } = await get(
          `/ordering/cash-closing/summary?branch=${encodeURIComponent(code)}&businessDate=${day}`,
        );
        const next = data as Summary;
        setSummary(next);
        setDrafts(
          Object.fromEntries(
            next.rows
              .filter((row) => row.closing === null)
              .map((row) => [row.collectorRef, { counted: row.expectedAmount, note: '' }]),
          ),
        );
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
        const first = list[0];
        setBranch(first.code);
        setDate(first.businessDateToday);
        void loadSummary(first.code, first.businessDateToday);
      })
      .catch(() => {
        if (live) setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [get, loadSummary]);

  const pickBranch = (code: string) => {
    setBranch(code);
    const option = branches?.find((item) => item.code === code);
    const day = option?.businessDateToday ?? date;
    setDate(day);
    setStatus('loading');
    void loadSummary(code, day);
  };

  const pickDate = (day: string) => {
    setDate(day);
    if (branch && day) {
      setStatus('loading');
      void loadSummary(branch, day);
    }
  };

  const draftOf = (row: CollectorRow): Draft =>
    drafts[row.collectorRef] ?? { counted: row.expectedAmount, note: '' };

  const setDraft = (ref: string, next: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [ref]: { ...DRAFT_DEFAULTS, ...current[ref], ...next },
    }));

  const closeRow = async () => {
    const row = confirming;
    if (!row || !summary) return;
    const draft = draftOf(row);
    setBusy(row.collectorRef);
    try {
      await post('/ordering/cash-closing', {
        branch: summary.branch.code,
        businessDate: summary.businessDate,
        collectorRef: row.collectorRef,
        countedAmount: draft.counted ?? 0,
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      });
      toggleNotification({ type: 'success', message: t('cash.closed') });
      setConfirming(null);
      setErrors({});
      void loadSummary(summary.branch.code, summary.businessDate);
    } catch (error) {
      setErrors(fieldErrors(error));
      toastError(error);
    } finally {
      setBusy(null);
    }
  };

  const adjustRow = async () => {
    const row = adjusting;
    if (!row?.closing || !summary) return;
    setBusy(row.closing.id);
    try {
      await post(`/ordering/cash-closing/${row.closing.id}/adjust`, {
        countedAmount: adjustForm.counted ?? 0,
        ...(adjustForm.note.trim() ? { note: adjustForm.note.trim() } : {}),
        reason: adjustForm.reason.trim(),
      });
      toggleNotification({ type: 'success', message: t('cash.adjusted') });
      setAdjusting(null);
      setErrors({});
      void loadSummary(summary.branch.code, summary.businessDate);
    } catch (error) {
      setErrors(fieldErrors(error));
      toastError(error);
    } finally {
      setBusy(null);
    }
  };

  const rows = summary?.rows ?? [];
  const closedCount = rows.filter((row) => row.closing !== null).length;
  const adjustDiff = adjusting
    ? (adjustForm.counted ?? 0) - adjusting.expectedAmount
    : 0;

  return (
    <Page.Protect permissions={PERMISSIONS.report}>
      <Page.Title>{t('cash.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header
          title={t('cash.title')}
          subtitle={t('cash.subtitle')}
          primaryAction={
            rows.length > 0 ? (
              closedCount === rows.length ? (
                <Badge textColor="success700" backgroundColor="success100">
                  {t('cash.state.closed')}
                </Badge>
              ) : closedCount > 0 ? (
                <Badge textColor="warning700" backgroundColor="warning100">
                  {t('cash.state.partial')}
                </Badge>
              ) : (
                <Badge>{t('cash.state.open')}</Badge>
              )
            ) : undefined
          }
        />
        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex gap={4} wrap="wrap" alignItems="end">
              <Box minWidth="220px">
                <Field.Root>
                  <Field.Label>{t('cash.field.branch')}</Field.Label>
                  <SingleSelect value={branch} onChange={(value: string | number) => pickBranch(String(value))}>
                    {(branches ?? []).map((option) => (
                      <SingleSelectOption key={option.code} value={option.code}>
                        {localized(option.name, locale) || option.code}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>
              <Box minWidth="180px">
                <Field.Root>
                  <Field.Label>{t('cash.field.date')}</Field.Label>
                  <TextInput
                    type="date"
                    value={date}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => pickDate(event.target.value)}
                  />
                </Field.Root>
              </Box>
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
                  <Button onClick={() => branch && date && void loadSummary(branch, date)}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {t('cash.loadFailed')}
              </Alert>
            ) : status === 'empty' || !summary ? (
              <EmptyStateLayout content={t('cash.empty')} />
            ) : (
              <Table colCount={8} rowCount={rows.length + 2}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">{t('cash.col.collector')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.orders')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.system')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.refunds')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.expected')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.counted')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('cash.col.diff')}</Typography></Th>
                    <Th><Typography variant="sigma">{t('orders.col.actions')}</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => {
                    const draft = draftOf(row);
                    const diff = (draft.counted ?? 0) - row.expectedAmount;
                    return (
                      <Tr key={row.collectorRef}>
                        <Td>
                          <Typography>{row.collectorName ?? row.collectorRef}</Typography>
                        </Td>
                        <Td><Typography variant="pi">{row.orderCount}</Typography></Td>
                        <Td><Typography variant="pi">{formatMoney(row.systemAmount)}</Typography></Td>
                        <Td>
                          <Typography variant="pi" textColor={row.refundAmount > 0 ? 'warning600' : undefined}>
                            {row.refundAmount > 0 ? `−${formatMoney(row.refundAmount)}` : '—'}
                          </Typography>
                        </Td>
                        <Td><Typography variant="pi">{formatMoney(row.expectedAmount)}</Typography></Td>
                        {row.closing ? (
                          <>
                            <Td><Typography variant="pi">{formatMoney(row.closing.countedAmount)}</Typography></Td>
                            <Td>
                              <Typography
                                variant="pi"
                                textColor={row.closing.differenceAmount !== 0 ? 'danger600' : undefined}
                              >
                                {formatMoney(row.closing.differenceAmount)}
                              </Typography>
                            </Td>
                            <Td>
                              <Flex direction="column" alignItems="start" gap={1}>
                                <Typography variant="pi" textColor="neutral600">
                                  {t('cash.closedBy', {
                                    by: row.closing.closedByName ?? row.closing.closedBy,
                                    at: formatDateTime(row.closing.closedAt, timezone),
                                  })}
                                </Typography>
                                {row.closing.note ? (
                                  <Typography variant="pi" textColor="neutral600">
                                    {row.closing.note}
                                  </Typography>
                                ) : null}
                                {row.closing.adjustmentReason ? (
                                  <Typography variant="pi" textColor="neutral600">
                                    {t('cash.adjustReason', { reason: row.closing.adjustmentReason })}
                                  </Typography>
                                ) : null}
                                <Button
                                  size="S"
                                  variant="tertiary"
                                  disabled={busy !== null}
                                  onClick={() => {
                                    setErrors({});
                                    setAdjustForm({ counted: row.closing?.countedAmount, note: row.closing?.note ?? '', reason: '' });
                                    setAdjusting(row);
                                  }}
                                >
                                  {t('cash.action.adjust')}
                                </Button>
                              </Flex>
                            </Td>
                          </>
                        ) : (
                          <>
                            <Td>
                              <Box minWidth="140px">
                                <NumberInput
                                  value={draft.counted}
                                  onValueChange={(value: number | undefined) =>
                                    setDraft(row.collectorRef, { counted: value })
                                  }
                                />
                              </Box>
                            </Td>
                            <Td>
                              <Typography variant="pi" textColor={diff !== 0 ? 'danger600' : undefined}>
                                {formatMoney(diff)}
                              </Typography>
                            </Td>
                            <Td>
                              <Flex direction="column" alignItems="stretch" gap={2}>
                                {diff !== 0 ? (
                                  <Field.Root error={errors.note}>
                                    <Textarea
                                      placeholder={t('cash.note.required')}
                                      value={draft.note}
                                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                                        setDraft(row.collectorRef, { note: event.target.value })
                                      }
                                    />
                                    <Field.Error />
                                  </Field.Root>
                                ) : null}
                                <Box>
                                  <Button
                                    size="S"
                                    disabled={busy !== null || (diff !== 0 && !draft.note.trim())}
                                    onClick={() => {
                                      setErrors({});
                                      setConfirming(row);
                                    }}
                                  >
                                    {t('cash.action.close')}
                                  </Button>
                                </Box>
                              </Flex>
                            </Td>
                          </>
                        )}
                      </Tr>
                    );
                  })}
                  <Tr>
                    <Td><Typography variant="sigma">{t('cash.totals')}</Typography></Td>
                    <Td><Typography variant="sigma">{summary.totals.orderCount}</Typography></Td>
                    <Td><Typography variant="sigma">{formatMoney(summary.totals.systemAmount)}</Typography></Td>
                    <Td>
                      <Typography variant="sigma">
                        {summary.totals.refundAmount > 0 ? `−${formatMoney(summary.totals.refundAmount)}` : '—'}
                      </Typography>
                    </Td>
                    <Td><Typography variant="sigma">{formatMoney(summary.totals.expectedAmount)}</Typography></Td>
                    <Td colSpan={3} />
                  </Tr>
                </Tbody>
              </Table>
            )}
          </Flex>
        </Layouts.Content>
      </Page.Main>

      <Dialog.Root open={confirming !== null} onOpenChange={(open: boolean) => !open && setConfirming(null)}>
        <Dialog.Content>
          <Dialog.Header>{t('cash.action.close')}</Dialog.Header>
          <Dialog.Body>
            <Typography>{t('cash.confirm')}</Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary" disabled={busy !== null}>
                {t('common.cancel')}
              </Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy !== null} onClick={() => void closeRow()}>
                {t('cash.action.close')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      {adjusting ? (
        <Modal.Root open onOpenChange={(open: boolean) => !open && busy === null && setAdjusting(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>
                {t('cash.adjust.title', { name: adjusting.collectorName ?? adjusting.collectorRef })}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Typography variant="pi" textColor="neutral600">
                  {t('cash.adjust.expected', { amount: formatMoney(adjusting.expectedAmount) })}
                </Typography>
                <Field.Root error={errors.countedAmount}>
                  <Field.Label>{t('cash.col.counted')}</Field.Label>
                  <NumberInput
                    value={adjustForm.counted}
                    onValueChange={(value: number | undefined) =>
                      setAdjustForm({ ...adjustForm, counted: value })
                    }
                  />
                  <Field.Error />
                </Field.Root>
                <Typography variant="pi" textColor={adjustDiff !== 0 ? 'danger600' : 'neutral600'}>
                  {t('cash.col.diff')}: {formatMoney(adjustDiff)}
                </Typography>
                <Field.Root error={errors.note}>
                  <Field.Label>{t('cash.field.note')}</Field.Label>
                  <Textarea
                    value={adjustForm.note}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setAdjustForm({ ...adjustForm, note: event.target.value })
                    }
                  />
                  <Field.Error />
                </Field.Root>
                <Field.Root required error={errors.reason}>
                  <Field.Label>{t('cash.field.reason')}</Field.Label>
                  <TextInput
                    value={adjustForm.reason}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setAdjustForm({ ...adjustForm, reason: event.target.value })
                    }
                  />
                  <Field.Error />
                </Field.Root>
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary" disabled={busy !== null}>
                  {t('common.cancel')}
                </Button>
              </Modal.Close>
              <Button
                loading={busy !== null}
                disabled={
                  !adjustForm.reason.trim() || (adjustDiff !== 0 && !adjustForm.note.trim())
                }
                onClick={() => void adjustRow()}
              >
                {t('cash.action.adjust')}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      ) : null}
    </Page.Protect>
  );
};

export default CashClosingPage;
