import { useState } from 'react';

import { Box, Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { contactMessageUid, reservationRequestUid } from '../lead-shortcuts/lead-shortcuts.helper';
import {
  buildLeadOverviewFilters,
  buildLeadOverviewQueries,
  leadListViewHref,
  sumGuests,
} from './dashboard-widgets.helper';
import { useAdminLists } from './useAdminList';

interface ReservationRow {
  guestCount?: number | null;
}

interface StatTileProps {
  value: number;
  label: string;
  hint: string;
  href: string;
  highlight?: boolean;
}

const StatTile = ({ value, label, hint, href, highlight = false }: StatTileProps) => (
  <Box
    tag={Link}
    to={href}
    background={highlight ? 'primary100' : 'neutral100'}
    borderColor={highlight ? 'primary200' : 'neutral200'}
    hasRadius
    padding={4}
    style={{ textDecoration: 'none', display: 'block' }}
  >
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="alpha" textColor={highlight ? 'primary700' : 'neutral800'}>
        {value}
      </Typography>
      <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
        {label}
      </Typography>
      <Typography variant="pi" textColor="neutral600">
        {hint}
      </Typography>
    </Flex>
  </Box>
);

export const LeadOverviewWidget = () => {
  const [now] = useState(() => new Date());
  const [queries] = useState(() => buildLeadOverviewQueries(now));
  const filters = buildLeadOverviewFilters(now);
  const { data, loading, failed } = useAdminLists<ReservationRow>({ ...queries });

  if (loading) {
    return <Widget.Loading />;
  }
  if (failed || !data) {
    return <Widget.Error />;
  }

  const newReservations = data.newReservations?.pagination.total ?? 0;
  const todayRows = data.guestsToday?.results ?? [];
  const todayCount = data.guestsToday?.pagination.total ?? 0;
  const newContacts = data.newContacts?.pagination.total ?? 0;
  const thisWeek = data.reservationsThisWeek?.pagination.total ?? 0;

  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '12px',
      }}
    >
      <StatTile
        value={newReservations}
        label="Đặt bàn chưa xử lý"
        hint="Trạng thái Mới, cần gọi xác nhận"
        href={leadListViewHref(reservationRequestUid, filters.newReservations)}
        highlight={newReservations > 0}
      />
      <StatTile
        value={todayCount}
        label="Bàn đặt hôm nay"
        hint={`${sumGuests(todayRows)} khách dự kiến`}
        href={leadListViewHref(reservationRequestUid, filters.today)}
      />
      <StatTile
        value={newContacts}
        label="Tin nhắn chưa đọc"
        hint="Từ form liên hệ trên website"
        href={leadListViewHref(contactMessageUid, filters.newContacts)}
        highlight={newContacts > 0}
      />
      <StatTile
        value={thisWeek}
        label="Đặt bàn 7 ngày qua"
        hint="Yêu cầu gửi về từ website"
        href={leadListViewHref(reservationRequestUid, filters.lastSevenDays)}
      />
    </Box>
  );
};

export default LeadOverviewWidget;
