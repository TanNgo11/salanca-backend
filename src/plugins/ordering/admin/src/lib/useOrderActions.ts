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
    preview: async (orderId: number, lineId: number, quantity: number) => {
      const { data } = await get(`/ordering/orders/${orderId}/lines/${lineId}/cancel-preview?quantity=${quantity}`);
      return data as { refundAmount: number; refundShortfall: number };
    },
  };
};
