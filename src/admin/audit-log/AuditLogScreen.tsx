import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { FileCsv } from '@strapi/icons';
import { Layouts, Page, Pagination } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';

import { AuditLogDetailDrawer } from './AuditLogDetailDrawer';
import AuditLogFilters from './AuditLogFilters';
import { AuditLogTable } from './AuditLogTable';
import {
  auditLogPermissions,
  formatAuditLogMessage,
  listAuditLogActionOptions,
  listAuditLogSourceOptions,
} from './audit-log.helper';
import { AuditLogScreenStatus, AuditLogTranslationKey } from './audit-log.types';
import { useAuditLogScreen } from './useAuditLogScreen';

import './audit-log.css';

const AuditLogScreen = () => {
  const intl = useIntl();
  const screen = useAuditLogScreen();
  const translate = (key: AuditLogTranslationKey): string =>
    formatAuditLogMessage(intl, key);

  return (
    <Page.Protect permissions={auditLogPermissions.read}>
      <Page.Title>{translate(AuditLogTranslationKey.Title)}</Page.Title>
      <Page.Main className="audit-log">
        <Layouts.Header
          primaryAction={
            screen.canExport ? (
              <Button
                disabled={screen.isExporting || screen.status === AuditLogScreenStatus.Loading}
                loading={screen.isExporting}
                onClick={() => {
                  void screen.onExport();
                }}
                startIcon={<FileCsv />}
              >
                {translate(AuditLogTranslationKey.Export)}
              </Button>
            ) : null
          }
        >
          {translate(AuditLogTranslationKey.Title)}
        </Layouts.Header>
        <Layouts.Content>
          <AuditLogFilters
            actionOptions={listAuditLogActionOptions(screen.draft.category)}
            disabled={screen.status === AuditLogScreenStatus.Loading}
            draft={screen.draft}
            labels={{
              action: translate(AuditLogTranslationKey.Action),
              category: translate(AuditLogTranslationKey.Category),
              from: translate(AuditLogTranslationKey.From),
              result: translate(AuditLogTranslationKey.Result),
              search: translate(AuditLogTranslationKey.Search),
              searchPlaceholder: translate(AuditLogTranslationKey.SearchPlaceholder),
              source: translate(AuditLogTranslationKey.Source),
              to: translate(AuditLogTranslationKey.To),
            }}
            onApply={screen.onApplyFilters}
            onChange={screen.onDraftChange}
            onQuickCategory={screen.onQuickCategory}
            sourceOptions={listAuditLogSourceOptions()}
            quickLabels={[
              { code: 'content', label: translate(AuditLogTranslationKey.CategoryContent) },
              { code: 'account', label: translate(AuditLogTranslationKey.CategoryAccount) },
              { code: 'security', label: translate(AuditLogTranslationKey.CategorySecurity) },
              { code: 'error', label: translate(AuditLogTranslationKey.CategoryError) },
            ]}
          />

          {screen.status === AuditLogScreenStatus.Error ? (
            <Box background="neutral0" hasRadius padding={6}>
              <Typography textColor="danger600">
                {translate(AuditLogTranslationKey.Error)}
              </Typography>
              <Button onClick={screen.onRetry}>
                {translate(AuditLogTranslationKey.Retry)}
              </Button>
            </Box>
          ) : (
            <div className="audit-log__results">
              <AuditLogTable
                emptyLabel={translate(AuditLogTranslationKey.Empty)}
                items={screen.items}
                labels={{
                  action: translate(AuditLogTranslationKey.ColumnAction),
                  actor: translate(AuditLogTranslationKey.ColumnActor),
                  result: translate(AuditLogTranslationKey.ColumnResult),
                  source: translate(AuditLogTranslationKey.ColumnSource),
                  target: translate(AuditLogTranslationKey.ColumnTarget),
                  time: translate(AuditLogTranslationKey.ColumnTime),
                }}
                onOpen={screen.onOpenDetail}
                resultFailure={translate(AuditLogTranslationKey.ResultFailure)}
                resultSuccess={translate(AuditLogTranslationKey.ResultSuccess)}
              />
              {screen.pageCount > 1 ? (
                <Flex
                  alignItems="center"
                  className="audit-log__pagination"
                  justifyContent="flex-end"
                >
                  <Pagination.Root
                    page={screen.page}
                    pageCount={screen.pageCount}
                    total={screen.total}
                  >
                    <Pagination.Links />
                  </Pagination.Root>
                </Flex>
              ) : null}
            </div>
          )}

          {screen.detail ? (
            <AuditLogDetailDrawer
              canReadDetails={screen.canReadDetails}
              detail={screen.detail}
              labels={{
                action: translate(AuditLogTranslationKey.ColumnAction),
                actor: translate(AuditLogTranslationKey.ColumnActor),
                after: translate(AuditLogTranslationKey.DetailAfter),
                before: translate(AuditLogTranslationKey.DetailBefore),
                changedFields: translate(AuditLogTranslationKey.DetailChangedFields),
                close: translate(AuditLogTranslationKey.DetailClose),
                method: translate(AuditLogTranslationKey.DetailMethod),
                noPermission: translate(AuditLogTranslationKey.DetailNoPermission),
                openTarget: translate(AuditLogTranslationKey.OpenTarget),
                path: translate(AuditLogTranslationKey.DetailPath),
                requestId: translate(AuditLogTranslationKey.DetailRequestId),
                result: translate(AuditLogTranslationKey.DetailResult),
                resultFailure: translate(AuditLogTranslationKey.ResultFailure),
                resultSuccess: translate(AuditLogTranslationKey.ResultSuccess),
                source: translate(AuditLogTranslationKey.DetailSource),
                status: translate(AuditLogTranslationKey.DetailStatus),
                target: translate(AuditLogTranslationKey.ColumnTarget),
                targetId: translate(AuditLogTranslationKey.DetailTargetId),
                technical: translate(AuditLogTranslationKey.DetailTechnical),
                time: translate(AuditLogTranslationKey.ColumnTime),
                title: translate(AuditLogTranslationKey.DetailTitle),
              }}
              loading={screen.detailLoading}
              onClose={screen.onCloseDetail}
            />
          ) : null}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default AuditLogScreen;
