import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, EmptyStateLayout, Flex, Loader, Textarea, Typography } from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { OrderingInboxProvider, useOrderingInbox } from '../../inbox/OrderingInboxProvider';
import { useErrorToast } from '../../lib/api';
import { formatBusinessDate, formatMoney, formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { CollectDialog } from '../Deliveries/DeliveryDialogs';

const REFRESH_MS = 30_000;
const REASONS = ['unreachable', 'wrong-address', 'refused', 'other'] as const;

type CourierOrder = {
  id: number;
  code: string;
  status: string;
  slotStartsAt: string | null;
  address: string;
  mapQuery: string;
  recipientName: string;
  phone: string | null;
  customerName: string | null;
  note: string | null;
  items: Array<{ title: string; quantity: number }>;
  due: number;
};

type CourierList = {
  actorName: string;
  actorRef: string;
  dates: string[];
  counts: { active: number; done: number };
  orders: CourierOrder[];
};

const tall = { minHeight: 48, fontSize: 16 } as const;
const wide = { minHeight: 48, width: '100%', fontSize: 16 } as const;

/** One assigned delivery, laid out for a phone (screens E4). No table. */
const Card = ({
  order,
  busy,
  failing,
  onDelivered,
  onCollect,
  onOpenFail,
  onFail,
}: {
  order: CourierOrder;
  busy: boolean;
  failing: boolean;
  onDelivered: () => void;
  onCollect: () => void;
  onOpenFail: () => void;
  onFail: (reason: string, note: string) => void;
}) => {
  const t = useT();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const ready = reason === 'other' ? note.trim().length >= 3 : reason !== '';
  const map = order.mapQuery.trim();
  return (
    <Box padding={4} background="neutral0" hasRadius shadow="filterShadow" marginBottom={3}>
      <Flex justifyContent="space-between" gap={2}>
        <Typography variant="beta" fontWeight="bold">
          {order.code}
        </Typography>
        <Badge>{t(`state.${order.status}`)}</Badge>
      </Flex>
      {order.slotStartsAt ? (
        <Typography>{formatTime(order.slotStartsAt)}</Typography>
      ) : null}
      <Box paddingTop={3}>
        <Typography variant="beta" fontWeight="bold">
          {order.address || '—'}
        </Typography>
        {order.customerName ? <Typography>{order.customerName}</Typography> : null}
        {order.recipientName && order.recipientName !== order.customerName ? (
          <Typography>{order.recipientName}</Typography>
        ) : null}
      </Box>
      <Flex gap={2} paddingTop={3}>
        {order.phone ? (
          <Button
            variant="secondary"
            style={tall}
            onClick={() => {
              window.location.href = `tel:${order.phone}`;
            }}
          >
            {t('courier.call')}
          </Button>
        ) : null}
        {map ? (
          <Button
            variant="secondary"
            style={tall}
            onClick={() => {
              window.open(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(map)}`,
                '_blank',
                'noopener',
              );
            }}
          >
            {t('courier.map')}
          </Button>
        ) : null}
      </Flex>
      {order.note ? (
        <Box paddingTop={3}>
          <Typography>{order.note}</Typography>
        </Box>
      ) : null}
      <Box paddingTop={3}>
        {order.items.map((item) => (
          <Typography key={`${item.title}-${item.quantity}`}>
            {item.quantity}× {item.title}
          </Typography>
        ))}
      </Box>
      <Box paddingTop={3}>
        {order.due > 0 ? (
          <Typography variant="beta" fontWeight="bold" textColor="danger600">
            {t('courier.collectCash', { amount: formatMoney(order.due) })}
          </Typography>
        ) : (
          <Typography variant="beta" fontWeight="bold" textColor="success600">
            {t('courier.paid')}
          </Typography>
        )}
      </Box>
      {order.status === 'out-for-delivery' ? (
        <Flex direction="column" gap={2} paddingTop={3} alignItems="stretch">
          {order.due > 0 ? (
            <Button style={wide} disabled={busy} onClick={onCollect}>
              {t('courier.collect')}
            </Button>
          ) : (
            <Button style={wide} disabled={busy} loading={busy} onClick={onDelivered}>
              {t('courier.delivered')}
            </Button>
          )}
          <Button style={wide} variant="danger-light" disabled={busy} onClick={onOpenFail}>
            {t('courier.fail')}
          </Button>
          {failing ? (
            <Box paddingTop={2}>
              <Flex gap={2} wrap="wrap">
                {REASONS.map((code) => (
                  <Button
                    key={code}
                    variant={reason === code ? 'default' : 'secondary'}
                    style={tall}
                    onClick={() => setReason(code)}
                  >
                    {t(`deliveries.failReason.${code}`)}
                  </Button>
                ))}
              </Flex>
              {reason === 'other' ? (
                <Box paddingTop={2}>
                  <Textarea
                    aria-label={t('dialog.note')}
                    value={note}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
                  />
                </Box>
              ) : null}
              <Box paddingTop={2}>
                <Button
                  variant="danger"
                  style={wide}
                  disabled={!ready || busy}
                  loading={busy}
                  onClick={() => onFail(reason, note.trim())}
                >
                  {t('courier.failConfirm')}
                </Button>
              </Box>
            </Box>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
};

const CourierList = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const { toggleNotification } = useNotification();
  const inbox = useOrderingInbox();
  const [view, setView] = useState<'active' | 'done'>('active');
  const [data, setData] = useState<CourierList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [failingId, setFailingId] = useState<number | null>(null);
  const [collect, setCollect] = useState<CourierOrder | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: body } = await get(`/ordering/courier/deliveries?view=${view}`);
      setData(body as CourierList);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [get, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const unsubscribe = inbox?.subscribe(() => void load());
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [inbox, load]);

  const run = async (request: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await request();
      toggleNotification({ type: 'success', message });
      setFailingId(null);
      setCollect(null);
      await load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const dates = (data?.dates ?? []).map((date) => formatBusinessDate(date)).join(' · ');
  return (
    <>
      <Layouts.Header
        title={t('courier.title')}
        subtitle={[data?.actorName, dates].filter(Boolean).join(' · ')}
        primaryAction={
          <Button variant="secondary" onClick={() => void load()} style={tall}>
            {t('courier.refresh')}
          </Button>
        }
      />
      <Layouts.Content>
        <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', fontSize: 16 }}>
          <Flex gap={2} paddingBottom={4}>
            <Button
              variant={view === 'active' ? 'default' : 'secondary'}
              style={tall}
              onClick={() => setView('active')}
            >
              {t('courier.active', { count: data?.counts.active ?? 0 })}
            </Button>
            <Button
              variant={view === 'done' ? 'default' : 'secondary'}
              style={tall}
              onClick={() => setView('done')}
            >
              {t('courier.done', { count: data?.counts.done ?? 0 })}
            </Button>
          </Flex>
          {status === 'loading' && data === null ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status === 'error' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={t('common.error.title')}
              action={
                <Button onClick={() => void load()} style={tall}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t('courier.loadFailed')}
            </Alert>
          ) : !data || data.orders.length === 0 ? (
            <EmptyStateLayout content={t('courier.empty')} />
          ) : (
            data.orders.map((order) => (
              <Card
                key={order.id}
                order={order}
                busy={busy}
                failing={failingId === order.id}
                onOpenFail={() => {
                  setFailingId(order.id);
                }}
                onDelivered={() =>
                  void run(
                    () =>
                      post(`/ordering/orders/${order.id}/transition`, {
                        to: 'delivered',
                        notifyCustomer: true,
                      }),
                    t('action.saved'),
                  )
                }
                onCollect={() => setCollect(order)}
                onFail={(reason, note) => {
                  void run(
                    () =>
                      post(`/ordering/orders/${order.id}/transition`, {
                        to: 'failed',
                        reasonCode: reason,
                        ...(note ? { note } : {}),
                        notifyCustomer: true,
                      }),
                    t('action.saved'),
                  );
                }}
              />
            ))
          )}
        </div>
        {collect ? (
          <CollectDialog
            due={collect.due}
            busy={busy}
            onClose={() => setCollect(null)}
            onSubmit={() =>
              void run(
                () => post(`/ordering/orders/${collect.id}/cash-handover`, { method: 'cash' }),
                t('action.handedOver'),
              )
            }
          />
        ) : null}
      </Layouts.Content>
    </>
  );
};

/** `/plugins/ordering/courier`: "Giao của tôi" (screens E4). */
const CourierPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.process}>
      <Page.Title>{t('courier.title')}</Page.Title>
      <OrderingInboxProvider>
        <Page.Main>
          <CourierList />
        </Page.Main>
      </OrderingInboxProvider>
    </Page.Protect>
  );
};

export default CourierPage;
