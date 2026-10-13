import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  EmptyStateLayout,
  Flex,
  Loader,
  ProgressBar,
  Searchbar,
  Switch,
  Table,
  Tabs,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient } from '@strapi/strapi/admin';
import { Route, Routes, useNavigate } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useLocale, useT, type Translate } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { PromotionEditor } from './PromotionEditor';

export type PromotionRow = {
  id: number;
  name: { vi: string; en?: string };
  internalNote: string | null;
  kind: 'code' | 'auto';
  discountType: 'percent' | 'amount' | 'free-delivery' | 'delivery-amount';
  value: number | null;
  maxDiscount: number | null;
  target: { kind: 'order' | 'products' | 'categories'; refs: string[] };
  minSubtotal: number;
  locationRefs: string[] | null;
  receiveKinds: Array<'pickup' | 'delivery'>;
  startsAt: string;
  endsAt: string | null;
  weekdays: string[];
  timeRanges: Array<{ start: string; end: string }>;
  firstOrderOnly: boolean;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  stackable: boolean;
  priority: number;
  active: boolean;
  usedCount: number;
  status: 'running' | 'scheduled' | 'off' | 'expired';
  orders: number;
  discountTotal: number;
};

const TABS = ['running', 'scheduled', 'off', 'expired', 'all'] as const;

/** "10% tối đa 30.000đ", "20.000đ", "Miễn phí giao" — the K1 "Giảm" column and the K2 summary. */
export const discountText = (row: Pick<PromotionRow, 'discountType' | 'value' | 'maxDiscount'>, t: Translate): string => {
  if (row.discountType === 'free-delivery') return t('promo.discount.freeDelivery');
  if (row.discountType === 'delivery-amount') return t('promo.discount.deliveryAmount', { amount: formatMoney(row.value ?? 0) });
  if (row.discountType === 'percent') {
    return row.maxDiscount
      ? t('promo.discount.percentCap', { value: row.value ?? 0, cap: formatMoney(row.maxDiscount) })
      : t('promo.discount.percent', { value: row.value ?? 0 });
  }
  return formatMoney(row.value ?? 0);
};

/** "Đơn từ 100.000đ · Q1 · Giao" */
export const conditionText = (
  row: Pick<PromotionRow, 'minSubtotal' | 'locationRefs' | 'receiveKinds' | 'firstOrderOnly'>,
  t: Translate,
): string => {
  const parts: string[] = [];
  if (row.minSubtotal > 0) parts.push(t('promo.cond.min', { amount: formatMoney(row.minSubtotal) }));
  if (row.locationRefs && row.locationRefs.length > 0) parts.push(row.locationRefs.join(', '));
  if (row.receiveKinds.length === 1) parts.push(t(`promo.receive.${row.receiveKinds[0]}`));
  if (row.firstOrderOnly) parts.push(t('promo.cond.firstOrder'));
  return parts.length > 0 ? parts.join(' · ') : t('promo.cond.none');
};

const shortDate = (iso: string | null): string => {
  if (!iso) return '…';
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const PromotionList = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>('running');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PromotionRow[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [confirmOff, setConfirmOff] = useState<PromotionRow | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ status: tab, ...(q.trim() ? { q: q.trim() } : {}) });
      const { data } = await get(`/ordering/promotions?${query.toString()}`);
      setRows((data as { items: PromotionRow[] }).items);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [get, q, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: PromotionRow, active: boolean) => {
    setConfirmOff(null);
    try {
      await post(`/ordering/promotions/${row.id}/active`, { active });
      void load();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <>
      <Layouts.Header
        title={t('promo.title')}
        subtitle={t('promo.subtitle')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('promo.add')}
          </Button>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Flex justifyContent="space-between" gap={4} wrap="wrap">
            <Tabs.Root value={tab} onValueChange={(value: string) => setTab(value as (typeof TABS)[number])}>
              <Tabs.List aria-label={t('promo.title')}>
                {TABS.map((item) => (
                  <Tabs.Trigger key={item} value={item}>
                    {t(`promo.tab.${item}`)}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
            <Box style={{ minWidth: 260 }}>
              <Searchbar
                name="q"
                value={q}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQ(event.target.value)}
                onClear={() => setQ('')}
                clearLabel={t('common.clear')}
                placeholder={t('promo.search')}
              >
                {t('promo.search')}
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
              title={status === 'forbidden' ? t('common.forbidden.title') : t('common.error.title')}
              action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
            >
              {t('promo.loadFailed')}
            </Alert>
          ) : !rows || rows.length === 0 ? (
            <EmptyStateLayout content={t('promo.empty')} />
          ) : (
            <Table colCount={7} rowCount={rows.length + 1}>
              <Thead>
                <Tr>
                  {['name', 'discount', 'conditions', 'time', 'used', 'total', 'active'].map((column) => (
                    <Th key={column}>
                      <Typography variant="sigma">{t(`promo.col.${column}`)}</Typography>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => {
                  const open = () => navigate(String(row.id));
                  return (
                    <Tr key={row.id}>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Flex gap={2}>
                          <Typography fontWeight="semiBold">
                            {(locale === 'en' && row.name.en) || row.name.vi}
                          </Typography>
                          <Badge>{t(`promo.kind.${row.kind}`)}</Badge>
                        </Flex>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Typography>{discountText(row, t)}</Typography>
                      </Td>
                      <Td onClick={open} style={{ cursor: 'pointer' }}>
                        <Typography textColor="neutral600">{conditionText(row, t)}</Typography>
                      </Td>
                      <Td>
                        <Typography>{`${shortDate(row.startsAt)} – ${shortDate(row.endsAt)}`}</Typography>
                      </Td>
                      <Td>
                        <Flex direction="column" alignItems="stretch" gap={1}>
                          <Typography>
                            {`${row.usedCount} / ${row.usageLimit ?? '∞'}`}
                          </Typography>
                          {row.usageLimit ? (
                            <ProgressBar value={Math.min(100, Math.round((row.usedCount / row.usageLimit) * 100))} size="S" />
                          ) : null}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography>{formatMoney(row.discountTotal)}</Typography>
                      </Td>
                      <Td>
                        <Switch
                          checked={row.active}
                          aria-label={t('promo.col.active')}
                          onCheckedChange={(value: boolean) =>
                            !value && row.status === 'running' ? setConfirmOff(row) : void setActive(row, value)
                          }
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </Flex>
      </Layouts.Content>
      <Dialog.Root open={confirmOff !== null} onOpenChange={(open: boolean) => !open && setConfirmOff(null)}>
        <Dialog.Content>
          <Dialog.Header>{t('promo.off.title')}</Dialog.Header>
          <Dialog.Body>{t('promo.off.body')}</Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="danger" onClick={() => confirmOff && void setActive(confirmOff, false)}>
                {t('promo.off.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

/** `/plugins/ordering/promotions/*` (screens K1–K4). */
const PromotionsPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.promotion}>
      <Page.Title>{t('promo.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<PromotionList />} />
          <Route path="new" element={<PromotionEditor />} />
          <Route path=":id" element={<PromotionEditor />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default PromotionsPage;
