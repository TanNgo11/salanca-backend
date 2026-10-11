import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  IconButton,
  Loader,
  MenuItem,
  SimpleMenu,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Trash } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { useNavigate, useParams } from 'react-router-dom';

import { PaymentBadge, StateBadge } from '../../components/orders/StatusBadges';
import { useOrderingInbox } from '../../inbox/OrderingInboxProvider';
import { useErrorToast, httpStatusOf } from '../../lib/api';
import { formatDateTime, formatMoney, formatTime, localized, minutesSince } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { RBAC_DETAIL } from '../../lib/permissions';
import type { InboxSettings, NextTransition, OrderDetail } from '../../lib/types';
import { useOrderActions } from '../../lib/useOrderActions';
import {
  CancelDialog,
  CashHandoverDialog,
  LineCancelDialog,
  RefundDialog,
  RejectDialog,
  TransitionDialog,
} from './OrderDialogs';

type Dialog =
  | { kind: 'transition'; to: string }
  | { kind: 'reject'; to: string }
  | { kind: 'cancel' }
  | { kind: 'cash' }
  | { kind: 'line'; lineId: number }
  | { kind: 'refund' }
  | null;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
    <Typography variant="delta" tag="h2">
      {title}
    </Typography>
    <Box paddingTop={3}>{children}</Box>
  </Box>
);

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <Flex justifyContent="space-between" paddingBottom={1}>
    <Typography textColor="neutral600">{label}</Typography>
    <Typography fontWeight={strong ? 'bold' : 'regular'}>{value}</Typography>
  </Flex>
);

/**
 * Order detail (screens S4/S4b/S5; Medusa two columns, Saleor history, Vendure state buttons
 * generated from `nextTransitions`). Every action posts to the scoped admin API and reloads.
 */
export const OrderDetailPage = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const params = useParams();
  const orderId = Number(params.id);
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const inbox = useOrderingInbox();
  const { allowedActions: can } = useRBAC(RBAC_DETAIL);

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const [reasons, setReasons] = useState<InboxSettings['rejectReasons']>(inbox?.settings?.rejectReasons ?? []);

  const load = useCallback(async () => {
    try {
      const { data } = await get(`/ordering/orders/${orderId}`);
      setDetail(data as OrderDetail);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 404 ? 'missing' : 'error');
    }
  }, [get, orderId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => inbox?.subscribe((event) => (event.orderId === orderId ? void load() : undefined)), [inbox, load, orderId]);
  useEffect(() => {
    if (reasons.length > 0) return;
    void get('/ordering/orders/summary')
      .then(({ data }) => setReasons((data as { settings: InboxSettings }).settings.rejectReasons))
      .catch(() => {});
  }, [get, reasons.length]);

  const { post, del } = useFetchClient();
  const toastError = useErrorToast();
  const [draftBusy, setDraftBusy] = useState<'confirm' | 'delete' | null>(null);
  const draftAction = async (kind: 'confirm' | 'delete') => {
    setDraftBusy(kind);
    try {
      if (kind === 'confirm') {
        const { data } = await post(`/ordering/drafts/${orderId}/confirm`);
        setDetail(data as OrderDetail);
        toggleNotification({ type: 'success', message: t('draft.confirmed') });
      } else {
        await del(`/ordering/drafts/${orderId}`);
        toggleNotification({ type: 'success', message: t('draft.deleted') });
        navigate('..');
      }
    } catch (error) {
      toastError(error);
    } finally {
      setDraftBusy(null);
    }
  };

  const actions = useOrderActions((next) => {
    setDialog(null);
    if (next) setDetail(next);
    else void load();
  });

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status !== 'ready' || !detail) {
    return (
      <Layouts.Content>
        <Box paddingTop={8}>
          <Alert
            variant="danger"
            closeLabel={t('common.close')}
            title={status === 'missing' ? t('detail.missing') : t('common.error.title')}
            action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
          >
            {status === 'missing' ? t('detail.missing.body') : t('detail.loadFailed')}
          </Alert>
        </Box>
      </Layouts.Content>
    );
  }

  const { order, group, totals } = detail;
  const timezone = order.branch.timezone;
  const timing = order.receiveMethod.timing;
  const cashHeld = detail.payments
    .filter((payment) => payment.providerCode === 'cash')
    .reduce((sum, payment) => sum + payment.capturedAmount - payment.refundedAmount, 0);
  const closed = order.status === 'canceled' || order.status === 'completed';

  const onStep = (item: NextTransition) => {
    if (item.requires.includes('cash')) return setDialog({ kind: 'cash' });
    if (item.requires.includes('reason')) return setDialog({ kind: 'reject', to: item.to });
    return setDialog({ kind: 'transition', to: item.to });
  };

  const stepButtons = order.status === 'draft' ? (
    can.canCreate ? (
      <Flex gap={2}>
        <Button variant="danger-light" loading={draftBusy === 'delete'} onClick={() => void draftAction('delete')}>
          {t('draft.delete')}
        </Button>
        <Button loading={draftBusy === 'confirm'} onClick={() => void draftAction('confirm')}>
          {t('draft.confirm')}
        </Button>
      </Flex>
    ) : null
  ) : (
    <Flex gap={2}>
      {can.canProcess || can.canRecordCash
        ? detail.nextTransitions.map((item) => (
            <Button
              key={item.to}
              variant={item.kind === 'danger' ? 'danger-light' : item.kind === 'primary' ? 'default' : 'secondary'}
              disabled={(item.requires.includes('cash') ? !can.canRecordCash : !can.canProcess) || actions.busy !== null}
              onClick={() => onStep(item)}
            >
              {item.requires.includes('cash') ? t('transition.cash-handover') : t(`transition.${item.to}`)}
            </Button>
          ))
        : null}
      <SimpleMenu label="…" variant="tertiary">
        {can.canCancel && !closed ? <MenuItem onSelect={() => setDialog({ kind: 'cancel' })}>{t('detail.cancelOrder')}</MenuItem> : null}
        {can.canManage && cashHeld > 0 ? <MenuItem onSelect={() => setDialog({ kind: 'refund' })}>{t('detail.refund')}</MenuItem> : null}
        <MenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(order.code);
            toggleNotification({ type: 'success', message: t('detail.copied') });
          }}
        >
          {t('detail.copyCode')}
        </MenuItem>
      </SimpleMenu>
    </Flex>
  );

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={order.code}
        subtitle={t('detail.subtitle', {
          placed: formatTime(order.placedAt, timezone),
          pickup: timing?.slot ? formatTime(timing.slot.startsAt, timezone) : t('summary.asap'),
          branch: localized(order.branch.name, locale) || order.locationRef,
          origin: t(`origin.${order.origin.kind}`),
        })}
        secondaryAction={
          <Flex gap={2}>
            {order.status === 'draft' ? <Badge>{t('state.draft')}</Badge> : <StateBadge status={group?.status ?? null} />}
            <PaymentBadge status={order.paymentStatus} />
          </Flex>
        }
        primaryAction={stepButtons}
      />
      <Layouts.Content>
        <Grid.Root gap={4}>
          <Grid.Item col={8} s={12} direction="column" alignItems="stretch" gap={4}>
            <Section title={t('detail.items')}>
              <Table colCount={4} rowCount={detail.lines.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.item')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.qty')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">{t('detail.col.amount')}</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">&nbsp;</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {detail.lines.map((line) => (
                    <Tr key={line.id}>
                      <Td>
                        <Typography fontWeight="semiBold">{line.title}</Typography>
                        {line.options.length > 0 || line.note ? (
                          <Typography variant="pi" textColor="neutral600" tag="p">
                            {[...line.options.map((option) => option.name), line.note ? `"${line.note}"` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </Typography>
                        ) : null}
                      </Td>
                      <Td>
                        <Typography>
                          {line.quantity}
                          {line.canceledQuantity > 0 ? ` · ${t('detail.canceledQty', { count: line.canceledQuantity })}` : ''}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography>{formatMoney(line.lineTotalAmount)}</Typography>
                      </Td>
                      <Td>
                        {can.canEditLines && order.status !== 'canceled' && line.quantity - line.canceledQuantity > 0 ? (
                          <IconButton label={t('detail.cancelLine')} variant="ghost" onClick={() => setDialog({ kind: 'line', lineId: line.id })}>
                            <Trash />
                          </IconButton>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Section>
            <Section title={t('detail.money')}>
              <Row label={t('detail.subtotal')} value={formatMoney(totals.subtotal)} />
              {detail.adjustments.map((adjustment) => (
                <Row key={`${adjustment.kind}:${adjustment.code}`} label={adjustment.label} value={formatMoney(adjustment.amount)} />
              ))}
              {totals.fulfillment ? <Row label={t('detail.fee')} value={formatMoney(totals.fulfillment)} /> : null}
              <Divider />
              <Row label={t('detail.total')} value={formatMoney(totals.total)} strong />
              <Row label={t('detail.paid')} value={formatMoney(totals.paid)} />
              <Row label={t('detail.refunded')} value={formatMoney(totals.refunded)} />
              <Row label={t('detail.due')} value={formatMoney(totals.due)} strong />
            </Section>
            <Section title={t('detail.payments')}>
              {detail.payments.length === 0 && detail.refunds.length === 0 ? (
                <Typography textColor="neutral600">{t('detail.noPayments')}</Typography>
              ) : (
                <>
                  {detail.payments.map((payment) => (
                    <Row
                      key={`p${payment.id}`}
                      label={`${t(`method.${payment.providerCode}`)} · ${payment.actorName ?? '—'} · ${formatDateTime(payment.capturedAt, timezone)}`}
                      value={formatMoney(payment.capturedAmount)}
                    />
                  ))}
                  {detail.refunds.map((refund) => (
                    <Row
                      key={`r${refund.id}`}
                      label={`${t('detail.refundRow')} · ${refund.reason} · ${refund.actorName ?? '—'}`}
                      value={`−${formatMoney(refund.amount)}`}
                    />
                  ))}
                </>
              )}
            </Section>
            {order.customerNote ? (
              <Alert variant="default" closeLabel={t('common.close')} title={t('detail.customerNote')}>
                {order.customerNote}
              </Alert>
            ) : null}
          </Grid.Item>
          <Grid.Item col={4} s={12} direction="column" alignItems="stretch" gap={4}>
            <Section title={t('detail.customer')}>
              <Typography fontWeight="semiBold">{order.contact.name ?? '—'}</Typography>
              {order.contact.phone ? (
                <Box>
                  <a href={`tel:${order.contact.phone}`}>{order.contact.phone}</a>
                </Box>
              ) : null}
              {order.contact.email ? <Typography>{order.contact.email}</Typography> : <Typography textColor="neutral600">{t('detail.noEmail')}</Typography>}
              <Typography variant="pi" textColor="neutral600" tag="p">
                {t('detail.consent', {
                  channel: t(`consent.${order.consent.channel ?? 'web-checkout'}`),
                  at: formatDateTime(order.consent.acceptedAt, timezone),
                  version: order.consent.policyVersion ?? '—',
                })}
              </Typography>
            </Section>
            <Section title={t('detail.receive')}>
              <Row label={t('detail.receiveKind')} value={t(`receive.${order.receiveMethod.kind ?? 'pickup'}`)} />
              <Row label={t('detail.pickupAt')} value={timing?.slot ? formatDateTime(timing.slot.startsAt, timezone) : t('summary.asap')} />
              <Row label={t('detail.readyAt')} value={formatDateTime(group?.estimatedReadyAt, timezone)} />
              {group && group.status === 'awaiting-acceptance' ? (
                <Row
                  label={t('detail.waiting')}
                  value={t('orders.minutes', { minutes: minutesSince(order.placedAt) })}
                />
              ) : null}
            </Section>
            <Section title={t('detail.history')}>
              {can.canProcess ? (
                <Flex direction="column" alignItems="stretch" gap={2} paddingBottom={4}>
                  <Textarea
                    placeholder={t('detail.notePlaceholder')}
                    value={note}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value.slice(0, 1000))}
                  />
                  <Flex justifyContent="flex-end">
                    <Button
                      size="S"
                      variant="secondary"
                      disabled={note.trim() === ''}
                      loading={actions.busy === 'note'}
                      onClick={async () => {
                        if (await actions.addNote(order.id, note.trim())) setNote('');
                      }}
                    >
                      {t('detail.addNote')}
                    </Button>
                  </Flex>
                </Flex>
              ) : null}
              {detail.timeline.map((event) => (
                <Box key={event.id} paddingBottom={3}>
                  <Flex gap={2} wrap="wrap">
                    <Typography fontWeight="semiBold">{timelineText(event, t)}</Typography>
                    {event.isPublic ? <Badge>{t('detail.customerSees')}</Badge> : null}
                  </Flex>
                  <Tooltip label={formatDateTime(event.occurredAt, timezone)}>
                    <Typography variant="pi" textColor="neutral600">
                      {(event.actorName ?? t(`actor.${event.actorRef.split(':')[0]}`, undefined, event.actorRef)) +
                        ' · ' +
                        t('detail.ago', { minutes: minutesSince(event.occurredAt) })}
                    </Typography>
                  </Tooltip>
                </Box>
              ))}
            </Section>
          </Grid.Item>
        </Grid.Root>

        {dialog?.kind === 'transition' ? (
          <TransitionDialog
            to={dialog.to}
            isPublic
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(body) => void actions.transition(order.id, { to: dialog.to, ...body })}
          />
        ) : null}
        {dialog?.kind === 'reject' ? (
          <RejectDialog
            to={dialog.to}
            reasons={reasons}
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(body) => void actions.transition(order.id, body)}
          />
        ) : null}
        {dialog?.kind === 'cancel' ? (
          <CancelDialog
            detail={detail}
            reasons={reasons}
            busy={actions.busy !== null}
            onClose={() => setDialog(null)}
            onSubmit={(body) => void actions.cancel(order.id, body)}
          />
        ) : null}
        {dialog?.kind === 'cash' ? (
          <CashHandoverDialog detail={detail} busy={actions.busy !== null} onClose={() => setDialog(null)} onSubmit={() => void actions.cashHandover(order.id)} />
        ) : null}
        {dialog?.kind === 'line'
          ? (() => {
              const line = detail.lines.find((item) => item.id === dialog.lineId);
              return line ? (
                <LineCancelDialog
                  line={line}
                  busy={actions.busy !== null}
                  onClose={() => setDialog(null)}
                  onPreview={(quantity) => actions.preview(order.id, line.id, quantity)}
                  onSubmit={(quantity, reason) => void actions.cancelLine(order.id, line.id, quantity, reason)}
                />
              ) : null;
            })()
          : null}
        {dialog?.kind === 'refund' ? (
          <RefundDialog max={cashHeld} busy={actions.busy !== null} onClose={() => setDialog(null)} onSubmit={(amount, reason) => void actions.refund(order.id, amount, reason)} />
        ) : null}
      </Layouts.Content>
    </>
  );
};

/** One line of history text per event type; unknown types fall back to the raw type. */
const timelineText = (
  event: OrderDetail['timeline'][number],
  t: ReturnType<typeof useT>,
): string => {
  const payload = event.payload ?? {};
  switch (event.type) {
    case 'fulfillment-group.transitioned': {
      const to = String(payload.to ?? '');
      const reason = typeof payload.reasonCode === 'string' ? payload.reasonCode : undefined;
      const extra = [
        payload.delayMinutes ? t('history.delay', { minutes: Number(payload.delayMinutes) }) : null,
        reason ? t('history.reason', { reason }) : null,
        typeof payload.note === 'string' ? `"${payload.note}"` : null,
      ].filter(Boolean);
      return [t(`state.${to}`), ...extra].join(' · ');
    }
    case 'note':
      return t('history.note', { text: String(payload.text ?? '') });
    case 'order.line.canceled':
      return [
        t('history.order.line.canceled'),
        typeof payload.reason === 'string' ? t('history.reason', { reason: payload.reason }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'payment.captured':
      return t('history.paid', { amount: formatMoney(Number(payload.amount ?? 0)) });
    default:
      return t(`history.${event.type}`, undefined, event.type);
  }
};
