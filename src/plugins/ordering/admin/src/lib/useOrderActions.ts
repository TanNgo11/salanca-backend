import { useCallback, useState } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import { apiErrorOf, useErrorToast } from './api';
import { useT } from './i18n';
import type { OrderDetail } from './types';

/**
 * Order actions shared by the dialog, the quick preview and the detail page. A concurrent winner
 * (INVALID_TRANSITION) is reported as "already handled" and the caller reloads.
 */
export const useOrderActions = (onChanged?: (detail: OrderDetail | null) => void) => {
  const { post, get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, request: () => Promise<{ data: unknown }>, success: string) => {
      setBusy(key);
      try {
        const { data } = await request();
        const detail = ((data as { detail?: OrderDetail })?.detail ?? (data as OrderDetail)) ?? null;
        toggleNotification({ type: 'success', message: success });
        onChanged?.(detail && 'order' in detail ? detail : null);
        return true;
      } catch (error) {
        if (apiErrorOf(error).code === 'INVALID_TRANSITION') {
          toggleNotification({ type: 'warning', message: t('action.alreadyHandled') });
          onChanged?.(null);
        } else {
          toastError(error);
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onChanged, t, toastError, toggleNotification],
  );

  return {
    busy,
    transition: (orderId: number, body: Record<string, unknown>) =>
      run(
        `transition:${String(body.to)}`,
        () => post(`/ordering/orders/${orderId}/transition`, body),
        t('action.saved'),
      ),
    cashHandover: (orderId: number) =>
      run('cash', () => post(`/ordering/orders/${orderId}/cash-handover`, { method: 'cash' }), t('action.handedOver')),
    cancel: (orderId: number, body: { reasonCode?: string; note?: string }) =>
      run('cancel', () => post(`/ordering/orders/${orderId}/cancel`, body), t('action.canceled')),
    addNote: (orderId: number, text: string) =>
      run('note', () => post(`/ordering/orders/${orderId}/notes`, { text }), t('action.noteAdded')),
    cancelLine: (orderId: number, lineId: number, quantity: number, reason: string) =>
      run('line', () => post(`/ordering/orders/${orderId}/lines/${lineId}/cancel`, { quantity, reason }), t('action.lineCanceled')),
    refund: (orderId: number, amount: number, reason: string) =>
      run(
        'refund',
        () => post(`/ordering/orders/${orderId}/refunds`, { amount, reason, idempotencyKey: `admin-refund-${crypto.randomUUID()}` }),
        t('action.refunded'),
      ),
    refundBank: (orderId: number, amount: number, reason: string) =>
      run(
        'refund-bank',
        () =>
          post(`/ordering/orders/${orderId}/refunds`, {
            method: 'bank',
            amount,
            reason,
            idempotencyKey: `admin-refund-${crypto.randomUUID()}`,
          }),
        t('action.refundPending'),
      ),
    settleRefund: (refundId: number, reference: string, settledAt?: string) =>
      run(
        'settle-refund',
        () => post(`/ordering/refunds/${refundId}/settle`, { reference, ...(settledAt ? { settledAt } : {}) }),
        t('action.refundSettled'),
      ),
    preview: async (orderId: number, lineId: number, quantity: number) => {
      const { data } = await get(`/ordering/orders/${orderId}/lines/${lineId}/cancel-preview?quantity=${quantity}`);
      return data as { refundAmount: number; refundShortfall: number };
    },
    // O13 "Gọi xe": quote → book → cancel a carrier trip on the delivery leg.
    carrierQuote: async (orderId: number, serviceId?: string) => {
      const { data } = await post(`/ordering/orders/${orderId}/carrier/quote`, {
        ...(serviceId ? { serviceId } : {}),
      });
      return data as {
        providerCode: string;
        quotes: Array<{ providerCode: string; serviceId: string; fee: { amount: number; currency: string } }>;
        due: number;
        customerFee: number;
      };
    },
    carrierBook: (orderId: number, body: { serviceId?: string; note?: string }) =>
      run('carrier-book', () => post(`/ordering/orders/${orderId}/carrier/book`, body), t('carrier.booked')),
    carrierCancel: (orderId: number, reason?: string) =>
      run(
        'carrier-cancel',
        () => post(`/ordering/orders/${orderId}/carrier/cancel`, reason ? { reason } : {}),
        t('carrier.canceled'),
      ),
  };
};
