import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Loader,
  Modal,
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
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { fieldErrors, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type Detail = {
  enabled: boolean;
  balance: number;
  value: number;
  tier: { code: string; name: Record<string, string>; multiplier: number } | null;
  nextTier: { name: Record<string, string>; missing: number } | null;
  expiringSoon: Array<{ points: number; expiresAt: string }>;
  lots: Array<{ id: number; source: string; points: number; remaining: number; expiresAt: string }>;
  ledger: Array<{
    at: string;
    kind: string;
    points: number;
    balanceAfter: number;
    orderCode: string | null;
    actor: string | null;
    reason: string | null;
  }>;
};

const signed = (points: number): string => (points > 0 ? `+${points}` : String(points));

/** Y3: the "Điểm" tab of customer detail — balance, tier, lots, ledger and the logged adjustment. */
export const CustomerLoyalty = ({ customerId }: { customerId: string }) => {
  const t = useT();
  const locale = useLocale();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toast = useErrorToast();
  const adjustRbac = useRBAC(PERMISSIONS.loyaltyAdjust);
  const canAdjust = !adjustRbac.isLoading && Object.values(adjustRbac.allowedActions).some(Boolean);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [points, setPoints] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get(`/ordering/customers/${customerId}/loyalty`);
      setDetail(data as Detail);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      toast(error);
    }
  }, [customerId, get, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const { data } = await post(`/ordering/customers/${customerId}/loyalty/adjust`, {
        points,
        reason,
        ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59+07:00`).toISOString() } : {}),
      });
      setDetail(data as Detail);
      toggleNotification({ type: 'success', message: t('loyalty.adjust.done') });
      setAdjustOpen(false);
      setPoints(undefined);
      setReason('');
      setExpiresAt('');
    } catch (error) {
      setErrors(fieldErrors(error, t));
      toast(error);
    } finally {
      setSaving(false);
    }
  };

  if (failed) {
    return (
      <Alert closeLabel={t('common.close')} title={t('common.error.title')} variant="danger">
        {t('loyalty.loadFailed')}
      </Alert>
    );
  }
  if (!detail) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }

  const tierName = detail.tier ? localized(detail.tier.name, locale) : t('loyalty.customer.noTier');

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {!detail.enabled ? (
        <Alert closeLabel={t('common.close')} title={t('loyalty.off.title')} variant="warning">
          {t('loyalty.customer.off')}
        </Alert>
      ) : null}
      <Grid.Root gap={4}>
        <Grid.Item col={4} s={12}>
          <Box padding={4} background="neutral0" shadow="tableShadow" borderRadius="4px" width="100%">
            <Typography variant="sigma" textColor="neutral600">
              {t('loyalty.customer.balance')}
            </Typography>
            <Typography variant="alpha" tag="p">
              {detail.balance}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t('loyalty.customer.worth', { amount: formatMoney(Math.max(0, detail.balance) * detail.value) })}
            </Typography>
          </Box>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Box padding={4} background="neutral0" shadow="tableShadow" borderRadius="4px" width="100%">
            <Typography variant="sigma" textColor="neutral600">
              {t('loyalty.customer.tier')}
            </Typography>
            <Typography variant="alpha" tag="p">
              {tierName}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {detail.nextTier
                ? t('loyalty.customer.next', { missing: formatMoney(detail.nextTier.missing), name: localized(detail.nextTier.name, locale) })
                : t('loyalty.customer.top')}
            </Typography>
          </Box>
        </Grid.Item>
        <Grid.Item col={4} s={12}>
          <Box padding={4} background="neutral0" shadow="tableShadow" borderRadius="4px" width="100%">
            <Typography variant="sigma" textColor="neutral600">
              {t('loyalty.customer.expiring')}
            </Typography>
            {detail.expiringSoon.length === 0 ? (
              <Typography variant="pi" tag="p">
                {t('loyalty.customer.noExpiring')}
              </Typography>
            ) : (
              detail.expiringSoon.map((row) => (
                <Typography key={`${row.expiresAt}-${row.points}`} variant="omega" tag="p">
                  {row.points} · {formatDateTime(row.expiresAt)}
                </Typography>
              ))
            )}
          </Box>
        </Grid.Item>
      </Grid.Root>
      {canAdjust ? (
        <Flex>
          <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
            {t('loyalty.adjust.button')}
          </Button>
        </Flex>
      ) : null}

      <Typography variant="delta">{t('loyalty.customer.lots')}</Typography>
      {detail.lots.length === 0 ? (
        <Typography variant="pi">{t('loyalty.customer.empty')}</Typography>
      ) : (
        <Table colCount={4} rowCount={detail.lots.length + 1}>
          <Thead>
            <Tr>
              {['points', 'remaining', 'expires', 'source'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`loyalty.customer.col.${column}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {detail.lots.map((lot) => (
              <Tr key={lot.id}>
                <Td><Typography>{lot.points}</Typography></Td>
                <Td><Typography>{lot.remaining}</Typography></Td>
                <Td><Typography>{formatDateTime(lot.expiresAt)}</Typography></Td>
                <Td><Typography>{t(`loyalty.source.${lot.source}`)}</Typography></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Typography variant="delta">{t('loyalty.customer.ledger')}</Typography>
      {detail.ledger.length === 0 ? (
        <Typography variant="pi">{t('loyalty.customer.empty')}</Typography>
      ) : (
        <Table colCount={7} rowCount={detail.ledger.length + 1}>
          <Thead>
            <Tr>
              {['at', 'kind', 'points', 'balanceAfter', 'order', 'actor', 'reason'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`loyalty.customer.col.${column}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {detail.ledger.map((row, index) => (
              <Tr key={`${row.at}-${index}`}>
                <Td><Typography>{formatDateTime(row.at)}</Typography></Td>
                <Td><Typography>{t(`loyalty.kind.${row.kind}`)}</Typography></Td>
                <Td><Typography textColor={row.points < 0 ? 'danger600' : 'success600'}>{signed(row.points)}</Typography></Td>
                <Td><Typography>{row.balanceAfter}</Typography></Td>
                <Td>
                  {row.orderCode ? (
                    <Link to={`/plugins/ordering/orders?q=${encodeURIComponent(row.orderCode)}`}>{row.orderCode}</Link>
                  ) : (
                    <Typography>—</Typography>
                  )}
                </Td>
                <Td><Typography>{row.actor ?? '—'}</Typography></Td>
                <Td><Typography>{row.reason ?? '—'}</Typography></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal.Root open={adjustOpen} onOpenChange={(next: boolean) => (!next && !saving ? setAdjustOpen(false) : undefined)}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('loyalty.adjust.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Field.Root required error={errors.points}>
                <Field.Label>{t('loyalty.adjust.points')}</Field.Label>
                <NumberInput value={points} onValueChange={(value?: number) => setPoints(value)} />
                <Field.Error />
              </Field.Root>
              <Field.Root required error={errors.reason}>
                <Field.Label>{t('loyalty.adjust.reason')}</Field.Label>
                <Textarea value={reason} onChange={(event: { target: { value: string } }) => setReason(event.target.value)} />
                <Field.Error />
              </Field.Root>
              <Field.Root error={errors.expiresAt}>
                <Field.Label>{t('loyalty.adjust.expires')}</Field.Label>
                <TextInput type="date" value={expiresAt} onChange={(event: { target: { value: string } }) => setExpiresAt(event.target.value)} />
                <Field.Error />
              </Field.Root>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button loading={saving} disabled={!points || reason.trim().length < 3} onClick={() => void submit()}>
              {t('loyalty.adjust.submit')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </Flex>
  );
};

export default CustomerLoyalty;
