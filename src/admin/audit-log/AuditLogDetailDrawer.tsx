import type { ReactNode } from 'react';
import {
  Accordion,
  Box,
  Button,
  Flex,
  FocusTrap,
  IconButton,
  Typography,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { Link as RouterLink } from 'react-router-dom';

import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import {
  allowlistedTargetPath,
  auditLogResultTone,
  formatAuditLogAction,
  formatAuditLogActor,
  formatAuditLogDateTime,
  formatAuditLogSource,
  formatAuditLogTarget,
  readAuditLogValueRows,
  readChangedFields,
} from './audit-log.helper';
import type { ApiAuditLogDetail } from './audit-log.types';

export interface AuditLogDetailDrawerProps {
  canReadDetails: boolean;
  detail: ApiAuditLogDetail;
  labels: {
    action: string;
    actor: string;
    after: string;
    before: string;
    changedFields: string;
    close: string;
    method: string;
    noPermission: string;
    openTarget: string;
    path: string;
    requestId: string;
    result: string;
    resultFailure: string;
    resultSuccess: string;
    source: string;
    status: string;
    target: string;
    targetId: string;
    technical: string;
    time: string;
    title: string;
  };
  loading: boolean;
  onClose: () => void;
}

const DetailField = ({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) => (
  <Flex alignItems="flex-start" direction="column" gap={1}>
    <Typography textColor="neutral600" variant="pi">
      {label}
    </Typography>
    {typeof children === 'string' || typeof children === 'number' ? (
      <Typography className="audit-log__detail-value" variant="omega">
        {children}
      </Typography>
    ) : (
      children
    )}
  </Flex>
);

const ValueRows = ({
  label,
  rows,
}: Readonly<{
  label: string;
  rows: ReadonlyArray<{ key: string; value: string }>;
}>) => (
  <Box background="neutral100" hasRadius padding={3}>
    <Typography fontWeight={600} variant="pi">
      {label}
    </Typography>
    <Flex alignItems="stretch" className="audit-log__value-rows" direction="column" gap={2}>
      {rows.map((row) => (
        <div className="audit-log__value-row" key={`${label}-${row.key}`}>
          <Typography textColor="neutral600" variant="pi">{row.key}</Typography>
          <Typography className="audit-log__technical-value" variant="pi">{row.value}</Typography>
        </div>
      ))}
    </Flex>
  </Box>
);

export const AuditLogDetailDrawer = ({
  canReadDetails,
  detail,
  labels,
  loading,
  onClose,
}: AuditLogDetailDrawerProps) => {
  const targetPath = allowlistedTargetPath(detail.targetUid, detail.targetId);
  const target = formatAuditLogTarget(detail);
  const changedFields = readChangedFields(detail.afterValues);
  const beforeRows = readAuditLogValueRows(detail.beforeValues);
  const afterRows = readAuditLogValueRows(detail.afterValues);

  return (
    <>
      <button
        aria-label={labels.close}
        className="audit-log__backdrop"
        onClick={onClose}
        type="button"
      />
      <aside aria-labelledby="audit-log-detail-title" aria-modal="true" className="audit-log__drawer" role="dialog">
        <FocusTrap className="audit-log__drawer-focus" onEscape={onClose} restoreFocus>
          <Flex alignItems="stretch" className="audit-log__drawer-layout" direction="column">
            <Flex
              alignItems="center"
              className="audit-log__drawer-header"
              justifyContent="space-between"
            >
              <Typography id="audit-log-detail-title" variant="beta">
                {labels.title}
              </Typography>
              <IconButton label={labels.close} onClick={onClose} size="S" variant="tertiary">
                <Cross />
              </IconButton>
            </Flex>

            <Flex alignItems="stretch" className="audit-log__drawer-body" direction="column" gap={5}>
              {loading ? (
                <Typography textColor="neutral600">…</Typography>
              ) : (
                <>
                  <Flex alignItems="flex-start" direction="column" gap={2}>
                    <Typography fontWeight={600} variant="delta">
                      {formatAuditLogAction(detail.action, detail.targetType)}
                    </Typography>
                    <InformationStatusChip
                      color={informationStatusChipColor(auditLogResultTone(detail.success))}
                      label={detail.success ? labels.resultSuccess : labels.resultFailure}
                    />
                  </Flex>

                  <div className="audit-log__detail-grid">
                    <DetailField label={labels.actor}>
                      {formatAuditLogActor(detail.actorLabel)}
                    </DetailField>
                    <DetailField label={labels.time}>
                      {formatAuditLogDateTime(detail.occurredAt)}
                    </DetailField>
                    <DetailField label={labels.target}>
                      <Flex alignItems="flex-start" direction="column" gap={1}>
                        <Typography fontWeight={600} variant="omega">
                          {target.typeLabel}
                        </Typography>
                        {target.detail ? (
                          <Typography textColor="neutral600" variant="pi">
                            {target.detail}
                          </Typography>
                        ) : null}
                      </Flex>
                    </DetailField>
                    <DetailField label={labels.result}>
                      {detail.success ? labels.resultSuccess : labels.resultFailure}
                    </DetailField>
                  </div>

                  {targetPath ? (
                    <Button size="S" tag={RouterLink} to={targetPath} variant="secondary">
                      {labels.openTarget}
                    </Button>
                  ) : null}

                  <Accordion.Root collapsible>
                    <Accordion.Item value="technical">
                      <Accordion.Header>
                        <Accordion.Trigger caretPosition="right">
                          {labels.technical}
                        </Accordion.Trigger>
                      </Accordion.Header>
                      <Accordion.Content>
                        <Box padding={4}>
                          {canReadDetails ? (
                            <Flex alignItems="stretch" direction="column" gap={4}>
                              <div className="audit-log__technical-grid">
                                <DetailField label={labels.requestId}>{detail.requestId}</DetailField>
                                <DetailField label={labels.method}>{detail.httpMethod}</DetailField>
                                <DetailField label={labels.path}>{detail.requestPath}</DetailField>
                                <DetailField label={labels.status}>{detail.statusCode}</DetailField>
                                <DetailField label={labels.source}>
                                  {formatAuditLogSource(detail.eventSource)}
                                </DetailField>
                                {target.fullIdentifier ? (
                                  <DetailField label={labels.targetId}>
                                    {target.fullIdentifier}
                                  </DetailField>
                                ) : null}
                              </div>
                              {changedFields.length > 0 ? (
                                <DetailField label={labels.changedFields}>
                                  {changedFields.join(', ')}
                                </DetailField>
                              ) : null}
                              {beforeRows.length > 0 ? (
                                <ValueRows label={labels.before} rows={beforeRows} />
                              ) : null}
                              {afterRows.length > 0 ? (
                                <ValueRows label={labels.after} rows={afterRows} />
                              ) : null}
                            </Flex>
                          ) : (
                            <Typography textColor="neutral600">{labels.noPermission}</Typography>
                          )}
                        </Box>
                      </Accordion.Content>
                    </Accordion.Item>
                  </Accordion.Root>
                </>
              )}
            </Flex>
          </Flex>
        </FocusTrap>
      </aside>
    </>
  );
};
