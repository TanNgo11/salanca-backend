import { useState } from 'react';
import { Box, Button, Field, Flex, MenuItem, Modal, SimpleMenu, Textarea, Typography } from '@strapi/design-system';

import { OrderSummary } from '../components/orders/OrderSummary';
import { localized } from '../lib/format';
import { useLocale, useT } from '../lib/i18n';
import type { InboxSettings, OrderDetail } from '../lib/types';
import { useOrderActions } from '../lib/useOrderActions';

/**
 * "Đơn mới" dialog on every Admin page (screens S2, TastyIgniter status workflow modal): Nhận /
 * Nhận và lùi N phút / Từ chối with a reason / Để sau. It does not close on an outside click.
 */
export const NewOrderDialog = ({
  detail,
  position,
  total,
  settings,
  onDone,
}: {
  detail: OrderDetail;
  position: number;
  total: number;
  settings: InboxSettings | null;
  onDone: () => void;
}) => {
  const t = useT();
  const locale = useLocale();
  const actions = useOrderActions(() => onDone());
  const [otherReason, setOtherReason] = useState<string | null>(null);
  const accept = detail.nextTransitions.find((item) => item.kind === 'primary');
  const reject = detail.nextTransitions.find((item) => item.kind === 'danger');
  const id = detail.order.id;
  const reasons = settings?.rejectReasons ?? [];
  const delays = settings?.delayMinutes ?? [];

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open ? onDone() : undefined)}>
      <Modal.Content onPointerDownOutside={(event: Event) => event.preventDefault()}>
        <Modal.Header>
          <Modal.Title>
            {t('dialog.newOrder.title')}
            {total > 1 ? ` · ${position}/${total}` : ''}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <OrderSummary detail={detail} />
          {otherReason !== null ? (
            <Box paddingTop={4}>
              <Field.Root required>
                <Field.Label>{t('dialog.reject.other')}</Field.Label>
                <Textarea value={otherReason} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setOtherReason(event.target.value)} />
              </Field.Root>
            </Box>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onDone}>
            {t('dialog.later')}
          </Button>
          <Flex gap={2}>
            {otherReason !== null && reject ? (
              <Button
                variant="danger"
                disabled={otherReason.trim().length < 3}
                loading={actions.busy !== null}
                onClick={() => void actions.transition(id, { to: reject.to, reasonCode: 'other', note: otherReason.trim() })}
              >
                {t('dialog.reject.confirm')}
              </Button>
            ) : (
              <>
                {reject ? (
                  <SimpleMenu label={t('dialog.reject')} variant="danger-light" disabled={actions.busy !== null}>
                    {reasons.map((reason) => (
                      <MenuItem
                        key={reason.code}
                        onSelect={() => void actions.transition(id, { to: reject.to, reasonCode: reason.code })}
                      >
                        {localized(reason.label, locale)}
                      </MenuItem>
                    ))}
                    <MenuItem onSelect={() => setOtherReason('')}>{t('dialog.reject.other')}</MenuItem>
                  </SimpleMenu>
                ) : null}
                {accept && delays.length > 0 ? (
                  <SimpleMenu label={t('dialog.acceptDelay')} variant="secondary" disabled={actions.busy !== null}>
                    {delays.map((minutes) => (
                      <MenuItem
                        key={minutes}
                        onSelect={() =>
                          void actions.transition(id, { to: accept.to, delayMinutes: minutes, notifyCustomer: true })
                        }
                      >
                        {t('dialog.delayMinutes', { minutes })}
                      </MenuItem>
                    ))}
                  </SimpleMenu>
                ) : null}
                {accept ? (
                  <Button
                    loading={actions.busy === `transition:${accept.to}`}
                    disabled={actions.busy !== null}
                    onClick={() => void actions.transition(id, { to: accept.to, notifyCustomer: true })}
                  >
                    {t('dialog.accept')}
                  </Button>
                ) : (
                  <Typography>{t('dialog.alreadyHandled')}</Typography>
                )}
              </>
            )}
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
