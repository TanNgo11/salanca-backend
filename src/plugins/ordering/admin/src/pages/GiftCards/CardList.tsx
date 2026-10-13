import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  Grid,
  Loader,
  Modal,
  NumberInput,
  ProgressBar,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tabs,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { apiErrorOf, httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';

export type CardRow = {
  id: number;
  masked: string;
  last4: string;
  initialAmount: number;
  balance: number;
  currency: string;
  status: 'inactive' | 'active' | 'blocked' | 'expired';
  source: 'sale' | 'manual' | 'batch';
  issuedAt: string | null;
  expiresAt: string | null;
  soldAt: string | null;
  orderId: number | null;
  orderCode: string | null;
  batchId: number | null;
  batchCode: string | null;
};

type ListResponse = {
  items: CardRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { outstandingBalance: number; soldThisMonth: number; redeemedThisMonth: number };
};

const TABS = ['active', 'blocked', 'expired', 'zero', 'all'] as const;
const SOURCES = ['sold', 'manual'] as const;
const QUICK_AMOUNTS = [100_000, 200_000, 500_000];

const statusTone: Record<CardRow['status'], { textColor: string; backgroundColor: string }> = {
  active: { textColor: 'success700', backgroundColor: 'success100' },
  blocked: { textColor: 'danger700', backgroundColor: 'danger100' },
  expired: { textColor: 'neutral700', backgroundColor: 'neutral150' },
  inactive: { textColor: 'warning700', backgroundColor: 'warning100' },
};

export const StatusBadge = ({ status }: { status: CardRow['status'] }) => {
  const t = useT();
  return <Badge {...statusTone[status]}>{t(`card.status.${status}`)}</Badge>;
};

/** Red "Hạn dùng" when the card dies inside 30 days (screens G1). */
export const expiringSoon = (expiresAt: string | null, now = Date.now()): boolean =>
  Boolean(expiresAt) && new Date(expiresAt as string).getTime() - now < 30 * 24 * 3600 * 1000;

/** G3 — the one-time result: full code in large type + copy, or the masked "sent" note. */
const IssueResult = ({
  result,
  onClose,
}: {
  result: { code: string | null; emailSent: boolean; recipientMasked: string | null };
  onClose: () => void;
}) => {
  const t = useT();
  const { toggleNotification } = useNotification();
  const copy = async () => {
    if (!result.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
      toggleNotification({ type: 'success', message: t('card.issue.copied') });
    } catch {
      // Clipboard needs a user gesture/https — the code is on screen as a fallback.
    }
  };
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Typography variant="delta">{t('card.issue.result')}</Typography>
      {result.code ? (
        <>
          <Box textAlign="center" padding={4} background="neutral100" hasRadius>
            <Typography variant="alpha" tag="p" style={{ fontFamily: 'monospace' }}>
              {result.code}
            </Typography>
          </Box>
          <Button onClick={() => void copy()}>{t('card.issue.copy')}</Button>
          <Alert variant="warning" closeLabel={t('common.close')} title={t('card.issue.once')}>
            {t('card.issue.once')}
          </Alert>
        </>
      ) : (
        <Alert
          variant={result.emailSent ? 'success' : 'warning'}
          closeLabel={t('common.close')}
          title={result.emailSent ? t('card.issue.result') : t('card.issue.mailFailed')}
        >
          {result.emailSent && result.recipientMasked
            ? t('card.issue.mailed', { email: result.recipientMasked })
            : t('card.issue.mailFailed')}
        </Alert>
      )}
      <Button variant="tertiary" onClick={onClose}>
        {t('common.close')}
      </Button>
    </Flex>
  );
};

/** G3 — amount + quick buttons, optional recipient, optional message, required reason. */
const IssueModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useT();
  const { post } = useFetchClient();
  const toastError = useErrorToast();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    code: string | null;
    emailSent: boolean;
    recipientMasked: string | null;
  } | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await post('/ordering/gift-cards', {
        amount: amount ?? 0,
        reason,
        ...(recipientEmail.trim() ? { recipientEmail: recipientEmail.trim() } : {}),
        ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
      const created = data as {
        code: string | null;
        emailSent: boolean;
        recipientMasked: string | null;
      };
      // The server withholds `code` once the mail went out — staff sees the masked address.
      setResult({
        code: created.code,
        emailSent: created.emailSent,
        recipientMasked: created.recipientMasked,
      });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('card.issue.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {result ? (
            <IssueResult result={result} onClose={onClose} />
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Field.Root>
                <Field.Label>{t('card.issue.amount')}</Field.Label>
                <NumberInput
                  value={amount}
                  onValueChange={(next?: number) => setAmount(next)}
                  min={1}
                  step={1000}
                />
              </Field.Root>
              <Flex gap={2}>
                {QUICK_AMOUNTS.map((quick) => (
                  <Button
                    key={quick}
                    size="S"
                    variant={amount === quick ? 'default' : 'tertiary'}
                    onClick={() => setAmount(quick)}
                  >
                    {formatMoney(quick)}
                  </Button>
                ))}
              </Flex>
              <Field.Root>
                <Field.Label>{t('card.issue.email')}</Field.Label>
                <TextInput
                  type="email"
                  value={recipientEmail}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setRecipientEmail(event.target.value)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('card.issue.name')}</Field.Label>
                <TextInput
                  value={recipientName}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setRecipientName(event.target.value)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('card.issue.message')}</Field.Label>
                <Textarea
                  value={message}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setMessage(event.target.value)
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('card.issue.expiry')}</Field.Label>
                <TextInput
                  type="date"
                  value={expiresAt}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setExpiresAt(event.target.value)
                  }
                />
              </Field.Root>
              <Field.Root required hint={t('card.detail.reasonHint')}>
                <Field.Label>{t('card.detail.reason')}</Field.Label>
                <TextInput
                  value={reason}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setReason(event.target.value)
                  }
                />
                <Field.Hint />
              </Field.Root>
            </Flex>
          )}
        </Modal.Body>
        {!result ? (
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button loading={busy} disabled={!amount || amount <= 0 || !reason.trim()} onClick={() => void submit()}>
              {t('card.issue.submit')}
            </Button>
          </Modal.Footer>
        ) : null}
      </Modal.Content>
    </Modal.Root>
  );
};

/** G1 — tabs, source filter, summary cards, the masked card table, and the G3 modal. */
const CardList = () => {
  const t = useT();
  const navigate = useNavigate();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const { toggleNotification } = useNotification();
  const [tab, setTab] = useState<(typeof TABS)[number]>('active');
  const [source, setSource] = useState<string>('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [issueOpen, setIssueOpen] = useState(false);
  const [codeSearch, setCodeSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ status: tab });
      if (source) query.set('source', source);
      if (q.trim()) query.set('q', q.trim());
      const { data: body } = await get(`/ordering/gift-cards?${query.toString()}`);
      setData(body as ListResponse);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [get, q, source, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Full-code lookup rides POST /gift-cards/search — the code never lands in a URL. */
  const searchByCode = async () => {
    if (!codeSearch.trim()) return;
    try {
      const { data: body } = await post('/ordering/gift-cards/search', { code: codeSearch.trim() });
      const card = body as { id: number };
      setCodeSearch('');
      navigate(String(card.id));
    } catch (error) {
      if (apiErrorOf(error).code === 'GIFT_CARD_NOT_FOUND') {
        toggleNotification({ type: 'warning', message: t('card.searchCode.notFound') });
      } else {
        toastError(error);
      }
    }
  };

  return (
    <>
      <Layouts.Header
        title={t('card.title')}
        subtitle={t('card.subtitle')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => setIssueOpen(true)}>
            {t('card.issue')}
          </Button>
        }
        secondaryAction={
          <Button variant="tertiary" onClick={() => navigate('batches')}>
            {t('batch.title')}
          </Button>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Grid.Root gap={4}>
            {(['outstanding', 'sold', 'redeemed'] as const).map((key) => (
              <Grid.Item key={key} col={4} s={12}>
                <Box background="neutral0" hasRadius shadow="tableShadow" padding={4}>
                  <Typography variant="pi" textColor="neutral600">
                    {t(`card.summary.${key}`)}
                  </Typography>
                  <Typography variant="beta" tag="p">
                    {formatMoney(
                      key === 'outstanding'
                        ? data?.summary.outstandingBalance
                        : key === 'sold'
                          ? data?.summary.soldThisMonth
                          : data?.summary.redeemedThisMonth,
                    )}
                  </Typography>
                </Box>
              </Grid.Item>
            ))}
          </Grid.Root>
          <Flex justifyContent="space-between" gap={4} wrap="wrap">
            <Tabs.Root value={tab} onValueChange={(value: string) => setTab(value as (typeof TABS)[number])}>
              <Tabs.List aria-label={t('card.title')}>
                {TABS.map((item) => (
                  <Tabs.Trigger key={item} value={item}>
                    {t(`card.tab.${item}`)}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
            <Flex gap={3} wrap="wrap">
              <Box style={{ minWidth: 160 }}>
                <SingleSelect
                  aria-label={t('card.filter.source')}
                  value={source}
                  onChange={(value: string | number) => setSource(String(value))}
                  placeholder={t('card.filter.source')}
                >
                  <SingleSelectOption value="">{t('card.filter.all')}</SingleSelectOption>
                  {SOURCES.map((item) => (
                    <SingleSelectOption key={item} value={item}>
                      {t(`card.filter.${item}`)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Box style={{ minWidth: 240 }}>
                <Searchbar
                  name="q"
                  value={q}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value)}
                  onClear={() => setQ('')}
                  clearLabel={t('common.clear')}
                  placeholder={t('card.search')}
                >
                  {t('card.search')}
                </Searchbar>
              </Box>
            </Flex>
          </Flex>
          <Flex gap={2} alignItems="end" wrap="wrap">
            <Box style={{ minWidth: 260 }}>
              <Field.Root>
                <Field.Label>{t('card.searchCode')}</Field.Label>
                <TextInput
                  value={codeSearch}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setCodeSearch(event.target.value)
                  }
                  onKeyDown={(event: React.KeyboardEvent) => {
                    if (event.key === 'Enter') void searchByCode();
                  }}
                />
              </Field.Root>
            </Box>
            <Button variant="secondary" onClick={() => void searchByCode()} disabled={!codeSearch.trim()}>
              {t('card.searchCode.go')}
            </Button>
          </Flex>
          <Typography variant="pi" textColor="neutral500">
            {t('card.searchCode.hint')}
          </Typography>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status !== 'ready' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={status === 'forbidden' ? t('common.forbidden.title') : t('common.error.title')}
              action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
            >
              {t('card.loadFailed')}
            </Alert>
          ) : !data || data.items.length === 0 ? (
            <EmptyStateLayout content={t('card.empty')} />
          ) : (
            <Table colCount={7} rowCount={data.items.length + 1}>
              <Thead>
                <Tr>
                  {['card', 'denomination', 'balance', 'expiry', 'source', 'status', 'issuedAt'].map((column) => (
                    <Th key={column}>
                      <Typography variant="sigma">{t(`card.col.${column}`)}</Typography>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.items.map((row) => {
                  const open = () => navigate(String(row.id));
                  const ratio = row.initialAmount > 0 ? Math.round((row.balance / row.initialAmount) * 100) : 0;
                  return (
                    <Tr key={row.id}>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Typography fontWeight="semiBold">{row.masked}</Typography>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Typography>{formatMoney(row.initialAmount)}</Typography>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Flex direction="column" alignItems="stretch" gap={1}>
                          <Typography>{formatMoney(row.balance)}</Typography>
                          <ProgressBar value={Math.min(100, Math.max(0, ratio))} size="S" />
                        </Flex>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Typography textColor={expiringSoon(row.expiresAt) ? 'danger600' : undefined}>
                          {formatDateTime(row.expiresAt)}
                        </Typography>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Flex gap={2}>
                          <Badge>{t(`card.source.${row.source}`)}</Badge>
                          {row.orderCode ? (
                            <Typography variant="pi" textColor="neutral600">
                              {row.orderCode}
                            </Typography>
                          ) : null}
                        </Flex>
                      </Td>
                      <Td>
                        <StatusBadge status={row.status} />
                      </Td>
                      <Td>
                        <Typography>{formatDateTime(row.issuedAt ?? row.soldAt)}</Typography>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </Flex>
      </Layouts.Content>
      <IssueModal
        open={issueOpen}
        onClose={() => {
          setIssueOpen(false);
          void load();
        }}
      />
    </>
  );
};

export default CardList;
