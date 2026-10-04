import {
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';

import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import {
  auditLogResultTone,
  formatAuditLogAction,
  formatAuditLogActor,
  formatAuditLogDateTime,
  formatAuditLogSource,
  formatAuditLogTarget,
} from './audit-log.helper';
import type { ApiAuditLogSummary } from './audit-log.types';

export interface AuditLogTableProps {
  emptyLabel: string;
  items: readonly ApiAuditLogSummary[];
  labels: {
    action: string;
    actor: string;
    result: string;
    source: string;
    target: string;
    time: string;
  };
  onOpen: (eventId: string) => void;
  resultFailure: string;
  resultSuccess: string;
}

const AuditLogTarget = ({ item }: Readonly<{ item: ApiAuditLogSummary }>) => {
  const target = formatAuditLogTarget(item);
  return (
    <Flex alignItems="flex-start" direction="column" gap={1}>
      <Typography fontWeight={600} variant="omega">
        {target.typeLabel}
      </Typography>
      {target.detail ? (
        <Typography
          className="audit-log__target-detail"
          textColor="neutral600"
          title={target.fullIdentifier ?? undefined}
          variant="pi"
        >
          {target.detail}
        </Typography>
      ) : null}
    </Flex>
  );
};

export const AuditLogTable = ({
  emptyLabel,
  items,
  labels,
  onOpen,
  resultFailure,
  resultSuccess,
}: AuditLogTableProps) => (
  <>
    <div className="audit-log__table-wrap">
      <Table colCount={6} rowCount={items.length}>
        <Thead>
          <Tr>
            <Th><Typography variant="omega">{labels.time}</Typography></Th>
            <Th><Typography variant="omega">{labels.actor}</Typography></Th>
            <Th><Typography variant="omega">{labels.source}</Typography></Th>
            <Th><Typography variant="omega">{labels.action}</Typography></Th>
            <Th><Typography variant="omega">{labels.target}</Typography></Th>
            <Th><Typography variant="omega">{labels.result}</Typography></Th>
          </Tr>
        </Thead>
        <Tbody>
          {items.length === 0 ? (
            <Tr>
              <Td colSpan={6}>
                <Typography textColor="neutral600" variant="omega">
                  {emptyLabel}
                </Typography>
              </Td>
            </Tr>
          ) : (
            items.map((item) => {
              const target = formatAuditLogTarget(item);
              return (
                <Tr
                aria-label={`${formatAuditLogAction(item.action, item.targetType)} - ${formatAuditLogActor(item.actorLabel)} - ${target.accessibleLabel}`}
                className="audit-log__row"
                key={item.eventId}
                onClick={() => onOpen(item.eventId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(item.eventId);
                  }
                }}
                tabIndex={0}
              >
                <Td>
                  <Typography variant="omega">
                    {formatAuditLogDateTime(item.occurredAt)}
                  </Typography>
                </Td>
                <Td>
                  <Typography fontWeight="semiBold" variant="omega">
                    {formatAuditLogActor(item.actorLabel)}
                  </Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral700" variant="omega">
                    {formatAuditLogSource(item.eventSource)}
                  </Typography>
                </Td>
                <Td>
                  <Typography variant="omega">
                    {formatAuditLogAction(item.action, item.targetType)}
                  </Typography>
                </Td>
                <Td>
                  <AuditLogTarget item={item} />
                </Td>
                <Td>
                  <InformationStatusChip
                    color={informationStatusChipColor(auditLogResultTone(item.success))}
                    label={item.success ? resultSuccess : resultFailure}
                  />
                </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>
    </div>

    <div className="audit-log__mobile-list">
      {items.map((item) => (
        <button
          aria-haspopup="dialog"
          className="audit-log__mobile-card"
          key={item.eventId}
          onClick={() => onOpen(item.eventId)}
          type="button"
        >
          <Flex alignItems="flex-start" gap={3} justifyContent="space-between">
            <Typography fontWeight="semiBold">
              {formatAuditLogAction(item.action, item.targetType)}
            </Typography>
            <InformationStatusChip
              color={informationStatusChipColor(auditLogResultTone(item.success))}
              label={item.success ? resultSuccess : resultFailure}
            />
          </Flex>
          <Typography fontWeight="semiBold" variant="omega">
            {formatAuditLogActor(item.actorLabel)}
          </Typography>
          <Typography textColor="neutral700" variant="pi">
            {formatAuditLogSource(item.eventSource)}
          </Typography>
          <AuditLogTarget item={item} />
          <Typography textColor="neutral600" variant="pi">
            {formatAuditLogDateTime(item.occurredAt)}
          </Typography>
        </button>
      ))}
    </div>
  </>
);
