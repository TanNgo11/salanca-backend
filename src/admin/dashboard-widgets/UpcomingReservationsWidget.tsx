import { useState } from 'react';

import { Box, Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import { reservationRequestUid } from '../lead-shortcuts/lead-shortcuts.helper';
import {
  buildUpcomingReservationsUrl,
  formatReservationDay,
  leadEditHref,
  leadStatusLabel,
  leadStatusTone,
  type LeadStatus,
} from './dashboard-widgets.helper';
import { useAdminLists } from './useAdminList';

const LIMIT = 6;

interface ReservationRow {
  documentId: string;
  fullName: string;
  phone: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
  status: LeadStatus;
  overlapCount?: number;
}

export const UpcomingReservationsWidget = () => {
  const [now] = useState(() => new Date());
  const [urls] = useState(() => ({ upcoming: buildUpcomingReservationsUrl(now, LIMIT) }));
  const { data, loading, failed } = useAdminLists<ReservationRow>(urls);

  if (loading) {
    return <Widget.Loading />;
  }
  if (failed || !data) {
    return <Widget.Error />;
  }

  const rows = data.upcoming?.results ?? [];
  if (rows.length === 0) {
    return <Widget.NoData>Chưa có bàn nào được đặt cho những ngày tới</Widget.NoData>;
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={0}>
      {rows.map((row) => (
        <Box
          key={row.documentId}
          tag={Link}
          to={leadEditHref(reservationRequestUid, row.documentId)}
          paddingTop={3}
          paddingBottom={3}
          borderColor="neutral150"
          style={{
            textDecoration: 'none',
            display: 'grid',
            gridTemplateColumns: '96px 1fr auto',
            alignItems: 'center',
            gap: '12px',
            borderWidth: '0 0 1px 0',
          }}
        >
          <Flex direction="column" alignItems="flex-start">
            <Typography variant="omega" fontWeight="bold" textColor="neutral800">
              {row.preferredTime}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {formatReservationDay(row.preferredDate, now)}
            </Typography>
          </Flex>
          <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
            <Typography variant="omega" textColor="neutral800" ellipsis>
              {row.fullName}
            </Typography>
            <Typography variant="pi" textColor="neutral600" ellipsis>
              {row.guestCount} khách · {row.phone}
              {(row.overlapCount ?? 0) > 0 ? ' · trùng giờ' : ''}
            </Typography>
          </Flex>
          <InformationStatusChip
            color={informationStatusChipColor(leadStatusTone(row.status))}
            label={leadStatusLabel[row.status] ?? row.status}
          />
        </Box>
      ))}
    </Flex>
  );
};

export default UpcomingReservationsWidget;
