import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';

import { useReservationInboxContext } from './reservation-inbox.context';
import {
  getReservationInboxTranslationId,
} from './reservation-inbox.helper';
import { ReservationInboxTranslationKey } from './reservation-inbox.types';

const INBOX_ROUTE = '/plugins/reservation-inbox';

export const ReservationInboxWidget = () => {
  const { unreadCount, mode } = useReservationInboxContext();
  const navigate = useNavigate();
  const { formatMessage } = useIntl();

  if (unreadCount <= 0) {
    return null;
  }

  const label = formatMessage({
    id: getReservationInboxTranslationId(ReservationInboxTranslationKey.PillUnread),
    defaultMessage: 'đặt bàn mới',
  });

  return (
    <button
      aria-label={formatMessage(
        {
          id: getReservationInboxTranslationId(ReservationInboxTranslationKey.PillAria),
          defaultMessage: '{count} đặt bàn mới',
        },
        { count: unreadCount },
      )}
      className="reservation-inbox__pill"
      onClick={() => navigate(INBOX_ROUTE)}
      type="button"
    >
      <span
        aria-hidden="true"
        className="reservation-inbox__pill-dot"
        data-mode={mode}
      />
      <span className="reservation-inbox__pill-count">{unreadCount}</span>
      <span className="reservation-inbox__pill-label">{label}</span>
    </button>
  );
};

export default ReservationInboxWidget;
