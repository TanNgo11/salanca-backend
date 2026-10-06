import { useState } from 'react';

import { Box, Flex, Typography } from '@strapi/design-system';
import { Widget } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';

import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import { contactMessageUid } from '../lead-shortcuts/lead-shortcuts.helper';
import {
  buildLatestContactsUrl,
  leadEditHref,
  leadStatusLabel,
  leadStatusTone,
  truncate,
  type LeadStatus,
} from './dashboard-widgets.helper';
import { useAdminLists } from './useAdminList';

const LIMIT = 5;

interface ContactRow {
  documentId: string;
  fullName: string;
  topic?: string | null;
  message: string;
  leadStatus: LeadStatus;
  createdAt: string;
}

export const LatestContactMessagesWidget = () => {
  const { formatDate } = useIntl();
  const [urls] = useState(() => ({ latest: buildLatestContactsUrl(LIMIT) }));
  const { data, loading, failed } = useAdminLists<ContactRow>(urls);

  if (loading) {
    return <Widget.Loading />;
  }
  if (failed || !data) {
    return <Widget.Error />;
  }

  const rows = data.latest?.results ?? [];
  if (rows.length === 0) {
    return <Widget.NoData>Chưa có tin nhắn liên hệ nào</Widget.NoData>;
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={0}>
      {rows.map((row) => (
        <Box
          key={row.documentId}
          tag={Link}
          to={leadEditHref(contactMessageUid, row.documentId)}
          paddingTop={3}
          paddingBottom={3}
          borderColor="neutral150"
          style={{
            textDecoration: 'none',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: '12px',
            borderWidth: '0 0 1px 0',
          }}
        >
          <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
            <Typography variant="omega" fontWeight="semiBold" textColor="neutral800" ellipsis>
              {row.fullName}
              {row.topic ? ` · ${row.topic}` : ''}
            </Typography>
            <Typography variant="pi" textColor="neutral600" ellipsis>
              {truncate(row.message.replace(/\s+/g, ' '), 90)}
            </Typography>
          </Flex>
          <Flex direction="column" alignItems="flex-end" gap={1}>
            <InformationStatusChip
              color={informationStatusChipColor(leadStatusTone(row.leadStatus))}
              label={leadStatusLabel[row.leadStatus] ?? row.leadStatus}
            />
            <Typography variant="pi" textColor="neutral500">
              {formatDate(row.createdAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </Typography>
          </Flex>
        </Box>
      ))}
    </Flex>
  );
};

export default LatestContactMessagesWidget;
