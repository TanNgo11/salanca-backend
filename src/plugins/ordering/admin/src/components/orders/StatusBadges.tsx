import { Badge } from '@strapi/design-system';

import { useT } from '../../lib/i18n';

const paymentTone: Record<string, { textColor: string; backgroundColor: string }> = {
  paid: { textColor: 'success700', backgroundColor: 'success100' },
  unpaid: { textColor: 'warning700', backgroundColor: 'warning100' },
  'partially-paid': { textColor: 'warning700', backgroundColor: 'warning100' },
  'partially-refunded': { textColor: 'neutral700', backgroundColor: 'neutral150' },
  refunded: { textColor: 'neutral700', backgroundColor: 'neutral150' },
  overpaid: { textColor: 'danger700', backgroundColor: 'danger100' },
};

const stateTone: Record<string, { textColor: string; backgroundColor: string }> = {
  'awaiting-acceptance': { textColor: 'warning700', backgroundColor: 'warning100' },
  'awaiting-payment': { textColor: 'warning700', backgroundColor: 'warning100' },
  preparing: { textColor: 'primary700', backgroundColor: 'primary100' },
  ready: { textColor: 'secondary700', backgroundColor: 'secondary100' },
  'out-for-delivery': { textColor: 'primary700', backgroundColor: 'primary100' },
  delivered: { textColor: 'success700', backgroundColor: 'success100' },
  failed: { textColor: 'danger700', backgroundColor: 'danger100' },
  rejected: { textColor: 'danger700', backgroundColor: 'danger100' },
  canceled: { textColor: 'danger700', backgroundColor: 'danger100' },
  expired: { textColor: 'neutral700', backgroundColor: 'neutral150' },
};

/** "Trả khi nhận" for unpaid cash orders, otherwise the payment status label. */
export const PaymentBadge = ({ status }: { status: string }) => {
  const t = useT();
  const tone = paymentTone[status] ?? paymentTone.unpaid;
  return <Badge {...tone}>{t(`payment.${status}`)}</Badge>;
};

export const StateBadge = ({ status }: { status: string | null }) => {
  const t = useT();
  if (!status) return null;
  const tone = stateTone[status] ?? { textColor: 'neutral700', backgroundColor: 'neutral150' };
  return <Badge {...tone}>{t(`state.${status}`)}</Badge>;
};
