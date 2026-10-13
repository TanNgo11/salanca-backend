import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Loader,
  NumberInput,
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
import { ArrowLeft } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import type { CardRow } from './CardList';
import { expiringSoon, StatusBadge } from './CardList';

type LedgerRow = {
  id: number;
  kind: 'issue' | 'activate' | 'redeem' | 'refund' | 'adjust' | 'expire' | 'block' | 'unblock' | 'extend';
  amount: number;
  balanceAfter: number;
  orderId: number | null;
  orderCode: string | null;
  paymentId: number | null;
  refundId: number | null;
  actorRef: string | null;
  reason: string | null;
  at: string;
};

type CardDetailResponse = CardRow & {
  recipientMasked: string | null;
  note: string | null;
  issuedBy: string | null;
  orderLineId: number | null;
  ledger: LedgerRow[];
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
    <Typography variant="delta" tag="h2">
      {title}
    </Typography>
    <Box paddingTop={3}>{children}</Box>
  </Box>
);

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Flex justifyContent="space-between" paddingBottom={1} gap={2}>
    <Typography textColor="neutral600">{label}</Typography>
    <Typography>{value}</Typography>
  </Flex>
);

type Panel = 'block' | 'unblock' | 'extend' | 'adjust' | null;

/** G2 — masked header, reason-gated actions, newest-first append-only ledger. */
const CardDetail = () => {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const { toggleNotification } = useNotification();
  const adjustRbac = useRBAC(PERMISSIONS.giftCardAdjust);
  const canAdjust = !adjustRbac.isLoading && Object.values(adjustRbac.allowedActions).some(Boolean);

  const [card, setCard] = useState<CardDetailResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get(`/ordering/gift-cards/${id}`);
      setCard(data as CardDetailResponse);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [get, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(`/ordering/gift-cards/${id}/${path}`, body);
      setPanel(null);
      setReason('');
      setNewExpiry('');
      setAmount(undefined);
      toggleNotification({ type: 'success', message: t('card.detail.done') });
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResendOpen(false);
    setBusy(true);
    try {
      const { data } = await post(`/ordering/gift-cards/${id}/resend`, {});
      const result = data as { recipientMasked: string | null };
      toggleNotification({
        type: 'success',
        message: result.recipientMasked
          ? t('card.detail.resend.done', { email: result.recipientMasked })
          : t('card.detail.done'),
      });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status !== 'ready' || !card) {
    return (
      <Layouts.Content>
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={status === 'forbidden' ? t('common.forbidden.title') : t('common.error.title')}
        >
          {t('card.detail.loadFailed')}
        </Alert>
      </Layouts.Content>
    );
  }

  const expirySoon = expiringSoon(card.expiresAt);
  const extendInvalid = !newExpiry || !card.expiresAt || new Date(newExpiry) <= new Date(card.expiresAt);
  const preview = card.balance + (amount ?? 0);
  const reasonMissing = !reason.trim();

  return (
    <>
      <Layouts.Header
        title={card.masked}
        subtitle={`${formatMoney(card.balance)} / ${formatMoney(card.initialAmount)}`}
        navigationAction={
          <Button variant="tertiary" startIcon={<ArrowLeft />} onClick={() => navigate('/plugins/ordering/gift-cards')}>
            {t('card.title')}
          </Button>
        }
        primaryAction={
          <Flex gap={2}>
            {card.status === 'blocked' ? (
              <Button variant="secondary" onClick={() => setPanel('unblock')}>
                {t('card.detail.unblock')}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setPanel('block')}>
                {t('card.detail.block')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPanel('extend')}>
              {t('card.detail.extend')}
            </Button>
            {canAdjust ? (
              <Button variant="secondary" onClick={() => setPanel('adjust')}>
                {t('card.detail.adjust')}
              </Button>
            ) : null}
            {card.recipientMasked ? (
              <Button variant="secondary" onClick={() => setResendOpen(true)}>
                {t('card.detail.resend')}
              </Button>
            ) : null}
          </Flex>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Section title={t('card.title')}>
            <Flex direction="column" alignItems="stretch" gap={1}>
              <Flex gap={3} alignItems="center" paddingBottom={2}>
                <StatusBadge status={card.status} />
                <Typography variant="omega" textColor="neutral600">
                  {t(`card.source.${card.source}`)}
                </Typography>
              </Flex>
              <Row
                label={t('card.detail.expiry')}
                value={
                  <Typography textColor={expirySoon ? 'danger600' : undefined}>
                    {formatDateTime(card.expiresAt)}
                  </Typography>
                }
              />
              {card.orderId ? (
                <Row
                  label={t('card.detail.order')}
                  value={
                    <Link to={`/plugins/ordering/orders/${card.orderId}`}>{card.orderCode ?? card.orderId}</Link>
                  }
                />
              ) : null}
              {card.batchId ? <Row label={t('card.detail.batch')} value={card.batchCode ?? card.batchId} /> : null}
              {card.recipientMasked ? <Row label={t('card.detail.recipient')} value={card.recipientMasked} /> : null}
              {card.note ? <Row label={t('card.detail.note')} value={card.note} /> : null}
            </Flex>
          </Section>

          {panel ? (
            <Section
              title={
                panel === 'block'
                  ? t('card.detail.block')
                  : panel === 'unblock'
                    ? t('card.detail.unblock')
                    : panel === 'extend'
                      ? t('card.detail.extend')
                      : t('card.detail.adjust')
              }
            >
              <Flex direction="column" alignItems="stretch" gap={3}>
                {panel === 'extend' ? (
                  <>
                    <Row label={t('card.detail.expiry')} value={formatDateTime(card.expiresAt)} />
                    <Field.Root
                      required
                      error={newExpiry && extendInvalid ? t('card.detail.extend.invalid') : undefined}
                    >
                      <Field.Label>{t('card.detail.extend.newExpiry')}</Field.Label>
                      <TextInput
                        type="date"
                        value={newExpiry}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setNewExpiry(event.target.value)
                        }
                      />
                      <Field.Error />
                    </Field.Root>
                  </>
                ) : null}
                {panel === 'adjust' ? (
                  <>
                    <Field.Root required>
                      <Field.Label>{t('card.detail.adjust.amount')}</Field.Label>
                      <NumberInput
                        value={amount}
                        onValueChange={(next?: number) => setAmount(next)}
                        step={1000}
                      />
                    </Field.Root>
                    <Typography variant="pi" textColor={preview < 0 ? 'danger600' : 'neutral600'}>
                      {t('card.detail.adjust.preview', { balance: formatMoney(preview) })}
                    </Typography>
                    {preview < 0 ? (
                      <Alert variant="danger" closeLabel={t('common.close')} title={t('card.detail.adjust.negative')}>
                        {t('card.detail.adjust.negative')}
                      </Alert>
                    ) : null}
                  </>
                ) : null}
                <Field.Root required hint={t('card.detail.reasonHint')}>
                  <Field.Label>{t('card.detail.reason')}</Field.Label>
                  <Textarea
                    value={reason}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setReason(event.target.value)
                    }
                  />
                  <Field.Hint />
                </Field.Root>
                <Flex gap={2}>
                  <Button variant="tertiary" onClick={() => setPanel(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    loading={busy}
                    disabled={
                      reasonMissing ||
                      (panel === 'extend' && extendInvalid) ||
                      (panel === 'adjust' && (!amount || preview < 0))
                    }
                    onClick={() =>
                      void act(
                        panel === 'block' ? 'block' : panel === 'unblock' ? 'unblock' : panel === 'extend' ? 'extend' : 'adjust',
                        {
                          reason: reason.trim(),
                          ...(panel === 'extend' ? { expiresAt: newExpiry } : {}),
                          ...(panel === 'adjust' ? { amount: amount ?? 0 } : {}),
                        },
                      )
                    }
                  >
                    {t('common.save')}
                  </Button>
                </Flex>
              </Flex>
            </Section>
          ) : null}

          <Section title={t('card.ledger.title')}>
            {card.ledger.length === 0 ? (
              <Typography textColor="neutral600">{t('card.ledger.empty')}</Typography>
            ) : (
              <Table colCount={7} rowCount={card.ledger.length + 1}>
                <Thead>
                  <Tr>
                    {['at', 'kind', 'amount', 'balanceAfter', 'order', 'actor', 'reason'].map((column) => (
                      <Th key={column}>
                        <Typography variant="sigma">{t(`ledger.col.${column}`)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {card.ledger.map((entry) => (
                    <Tr key={entry.id}>
                      <Td>
                        <Typography>{formatDateTime(entry.at)}</Typography>
                      </Td>
                      <Td>
                        <Typography>{t(`ledger.kind.${entry.kind}`)}</Typography>
                      </Td>
                      <Td>
                        <Typography textColor={entry.amount >= 0 ? 'success600' : 'danger600'}>
                          {`${entry.amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(entry.amount))}`}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography>{formatMoney(entry.balanceAfter)}</Typography>
                      </Td>
                      <Td>
                        {entry.orderId ? (
                          <Link to={`/plugins/ordering/orders/${entry.orderId}`}>
                            {entry.orderCode ?? entry.orderId}
                          </Link>
                        ) : (
                          <Typography textColor="neutral600">—</Typography>
                        )}
                      </Td>
                      <Td>
                        <Typography>{entry.actorRef ?? '—'}</Typography>
                      </Td>
                      <Td>
                        <Typography textColor="neutral600">{entry.reason ?? '—'}</Typography>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Section>
        </Flex>
      </Layouts.Content>

      <Dialog.Root open={resendOpen} onOpenChange={(open: boolean) => !open && setResendOpen(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('card.detail.resend')}</Dialog.Header>
          <Dialog.Body>{t('card.detail.resend.confirm', { email: card.recipientMasked ?? '—' })}</Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button loading={busy} onClick={() => void resend()}>
                {t('card.detail.resend')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default CardDetail;
