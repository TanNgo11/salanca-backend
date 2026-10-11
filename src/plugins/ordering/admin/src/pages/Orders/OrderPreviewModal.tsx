import { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Loader, Modal } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';

import { OrderSummary } from '../../components/orders/OrderSummary';
import { useErrorToast } from '../../lib/api';
import { useT } from '../../lib/i18n';
import type { OrderDetail } from '../../lib/types';
import { useOrderActions } from '../../lib/useOrderActions';

/** Quick preview from the inbox (screens S3, WooCommerce Preview): summary + next step only. */
export const OrderPreviewModal = ({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: number;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const t = useT();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await get(`/ordering/orders/${orderId}`);
      setDetail(data as OrderDetail);
    } catch (error) {
      toastError(error);
      onClose();
    }
  }, [get, onClose, orderId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useOrderActions(() => {
    onChanged();
    void load();
  });
  const next = detail?.nextTransitions.find((item) => item.kind === 'primary');

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{detail?.order.code ?? t('common.loading')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detail ? (
            <OrderSummary detail={detail} />
          ) : (
            <Flex justifyContent="center">
              <Loader small>{t('common.loading')}</Loader>
            </Flex>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={() => navigate(String(orderId))}>
            {t('orders.openDetail')}
          </Button>
          {detail && next && !next.requires.includes('cash') ? (
            <Button
              loading={actions.busy !== null}
              onClick={() => void actions.transition(orderId, { to: next.to, notifyCustomer: true })}
            >
              {t(`transition.${next.to}`)}
            </Button>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
