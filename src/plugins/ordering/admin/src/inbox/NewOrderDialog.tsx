import { useState } from 'react';
import { Box, Button, Field, Flex, Modal, Textarea, Typography } from '@strapi/design-system';

import { OrderSummary } from '../components/orders/OrderSummary';
import { localized } from '../lib/format';
import { useLocale, useT } from '../lib/i18n';
import type { InboxSettings, OrderDetail } from '../lib/types';
import { useOrderActions } from '../lib/useOrderActions';

type Panel = 'none' | 'delay' | 'reject' | 'other';

/**
 * "Đơn mới" dialog on every Admin page (screens S2, TastyIgniter status workflow modal): Nhận /
 * Nhận và lùi N phút / Từ chối with a reason / Để sau. It does not close on an outside click.
 * Delay and reject choices open as button panels inside the dialog: a dropdown menu nested in the
 * modal froze the page (focus scopes fighting), so no SimpleMenu here.
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
  const [panel, setPanel] = useState<Panel>('none');
  const [otherReason, setOtherReason] = useState('');
  const accept = detail.nextTransitions.find((item) => item.kind === 'primary');
  const reject = detail.nextTransitions.find((item) => item.kind === 'danger');
  const id = detail.order.id;
  const reasons = settings?.rejectReasons ?? [];
  const delays = settings?.delayMinutes ?? [];
  const busy = actions.busy !== null;
  const toggle = (next: Panel) => setPanel((current) => (current === next ? 'none' : next));

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
          {panel === 'delay' && accept ? (
            <Flex gap={2} wrap="wrap" paddingTop={4}>
              {delays.map((minutes) => (
                <Button
                  key={minutes}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void actions.transition(id, { to: accept.to, delayMinutes: minutes, notifyCustomer: true })}
                >
                  {t('dialog.delayMinutes', { minutes })}
                </Button>
              ))}
            </Flex>
          ) : null}
          {panel === 'reject' && reject ? (
            <Flex gap={2} wrap="wrap" paddingTop={4}>
              {reasons.map((reason) => (
                <Button
                  key={reason.code}
                  variant="danger-light"
                  disabled={busy}
                  onClick={() => void actions.transition(id, { to: reject.to, reasonCode: reason.code })}
                >
                  {localized(reason.label, locale)}
                </Button>
              ))}
              <Button variant="tertiary" onClick={() => setPanel('other')}>
                {t('dialog.reject.other')}
              </Button>
            </Flex>
          ) : null}
          {panel === 'other' && reject ? (
            <Box paddingTop={4}>
              <Field.Root required>
                <Field.Label>{t('dialog.reject.other')}</Field.Label>
                <Textarea
                  value={otherReason}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setOtherReason(event.target.value)}
                />
              </Field.Root>
              <Flex justifyContent="flex-end" paddingTop={2}>
                <Button
                  variant="danger"
                  disabled={otherReason.trim().length < 3}
                  loading={busy}
                  onClick={() => void actions.transition(id, { to: reject.to, reasonCode: 'other', note: otherReason.trim() })}
                >
                  {t('dialog.reject.confirm')}
                </Button>
              </Flex>
            </Box>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onDone}>
            {t('dialog.later')}
          </Button>
          <Flex gap={2}>
            {reject ? (
              <Button variant="danger-light" disabled={busy} onClick={() => toggle('reject')}>
                {t('dialog.reject')}
              </Button>
            ) : null}
            {accept && delays.length > 0 ? (
              <Button variant="secondary" disabled={busy} onClick={() => toggle('delay')}>
                {t('dialog.acceptDelay')}
              </Button>
            ) : null}
            {accept ? (
              <Button
                loading={actions.busy === `transition:${accept.to}` && panel === 'none'}
                disabled={busy}
                onClick={() => void actions.transition(id, { to: accept.to, notifyCustomer: true })}
              >
                {t('dialog.accept')}
              </Button>
            ) : (
              <Typography>{t('dialog.alreadyHandled')}</Typography>
            )}
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
