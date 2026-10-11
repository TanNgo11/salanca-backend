import { Badge, Box, Flex, Typography } from '@strapi/design-system';

import { formatMoney, formatTime, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import type { OrderDetail } from '../../lib/types';
import { PaymentBadge } from './StatusBadges';

/** Compact order card used by the new-order dialog (S2) and the quick preview (S3). */
export const OrderSummary = ({ detail }: { detail: OrderDetail }) => {
  const t = useT();
  const locale = useLocale();
  const { order } = detail;
  const timezone = order.branch.timezone;
  const timing = order.receiveMethod.timing;
  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex gap={2} wrap="wrap">
        <Typography variant="omega" textColor="neutral600">
          {localized(order.branch.name, locale) || order.locationRef}
        </Typography>
        <Typography variant="delta" fontWeight="bold">
          {order.code}
        </Typography>
        {timing?.slot ? (
          <Typography>{t('summary.pickupAt', { time: formatTime(timing.slot.startsAt, timezone) })}</Typography>
        ) : (
          <Badge>{t('summary.asap')}</Badge>
        )}
      </Flex>
      <Box>
        {detail.lines.map((line) => (
          <Box key={line.id} paddingBottom={1}>
            <Typography>
              {line.quantity - line.canceledQuantity} × {line.title}
            </Typography>
            {line.options.length > 0 || line.note ? (
              <Typography variant="pi" textColor="neutral600" tag="p">
                {[...line.options.map((option) => option.name), line.note ? `"${line.note}"` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
      {order.customerNote ? (
        <Typography variant="pi" textColor="neutral700">
          {t('summary.note', { note: order.customerNote })}
        </Typography>
      ) : null}
      <Flex justifyContent="space-between">
        <Typography fontWeight="bold">{t('summary.total', { total: formatMoney(detail.totals.total) })}</Typography>
        <PaymentBadge status={order.paymentStatus} />
      </Flex>
    </Flex>
  );
};
