import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { useSearchParams } from 'react-router-dom';

import { safeVietnameseAdminMessage } from '../safe-admin-message.helper';

import {
  auditLogPermissions,
  draftFiltersToQuery,
  draftFiltersToUrlParams,
  formatAuditLogMessage,
  parseAuditLogDetailResponse,
  parseAuditLogListResponse,
  queryParamsToDraftFilters,
  toggleAuditLogQuickCategory,
} from './audit-log.helper';
import {
  AuditLogScreenStatus,
  AuditLogTranslationKey,
  type ApiAuditLogDetail,
  type ApiAuditLogSummary,
  type AuditLogDraftFilters,
} from './audit-log.types';

export interface UseAuditLogScreenResult {
  canExport: boolean;
  canReadDetails: boolean;
  detail: ApiAuditLogDetail | null;
  detailLoading: boolean;
  draft: AuditLogDraftFilters;
  isExporting: boolean;
  isPermissionLoading: boolean;
  items: readonly ApiAuditLogSummary[];
  onApplyFilters: () => void;
  onCloseDetail: () => void;
  onDraftChange: (patch: Partial<AuditLogDraftFilters>) => void;
  onExport: () => Promise<void>;
  onOpenDetail: (eventId: string) => void;
  onQuickCategory: (category: string) => void;
  onRetry: () => void;
  page: number;
  pageCount: number;
  status: AuditLogScreenStatus;
  total: number;
}

const readErrorMessage = (error: unknown, fallback: string): string => {
  if (!error || typeof error !== 'object') {
    return fallback;
  }
  const candidate = error as {
    response?: { data?: { error?: { message?: unknown } } };
  };
  const message = candidate.response?.data?.error?.message;
  return safeVietnameseAdminMessage(message, fallback);
};

export const useAuditLogScreen = (): UseAuditLogScreenResult => {
  const intl = useIntl();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowedActions: detailActions, isLoading: isDetailPermissionLoading } = useRBAC(
    auditLogPermissions.details,
  );
  const { allowedActions: exportActions, isLoading: isExportPermissionLoading } = useRBAC(
    auditLogPermissions.export,
  );
  const canReadDetails = detailActions.canDetails === true;
  const canExport = exportActions.canExport === true;
  const searchParamsKey = searchParams.toString();
  const parsed = useMemo(
    () => queryParamsToDraftFilters(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const [draft, setDraft] = useState<AuditLogDraftFilters>(parsed.draft);
  const [items, setItems] = useState<readonly ApiAuditLogSummary[]>([]);
  const [status, setStatus] = useState<AuditLogScreenStatus>(AuditLogScreenStatus.Loading);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<ApiAuditLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const requestIdRef = useRef(0);
  const page = parsed.page;

  const load = useCallback(
    (nextDraft: AuditLogDraftFilters, nextPage: number): void => {
      const requestId = ++requestIdRef.current;
      setStatus(AuditLogScreenStatus.Loading);
      const params = new URLSearchParams(draftFiltersToQuery(nextDraft, nextPage));
      get(`/audit-log/events?${params.toString()}`)
        .then((response) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          const parsed = parseAuditLogListResponse(response.data);
          setItems(parsed.items);
          setPageCount(parsed.pageCount);
          setTotal(parsed.total);
          setStatus(
            parsed.items.length === 0
              ? AuditLogScreenStatus.Empty
              : AuditLogScreenStatus.Ready,
          );
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setStatus(AuditLogScreenStatus.Error);
        });
    },
    [get],
  );

  useEffect(() => {
    setDraft(parsed.draft);
  }, [parsed.draft]);

  useEffect(() => {
    load(parsed.draft, parsed.page);
  }, [load, parsed.draft, parsed.page]);

  const onApplyFilters = (): void => {
    setSearchParams(draftFiltersToUrlParams(draft, 1));
  };

  const onDraftChange = (patch: Partial<AuditLogDraftFilters>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const onQuickCategory = (category: string): void => {
    const next = toggleAuditLogQuickCategory(draft, category);
    setDraft(next);
    setSearchParams(draftFiltersToUrlParams(next, 1));
  };

  const onOpenDetail = (eventId: string): void => {
    const summary = items.find((item) => item.eventId === eventId);
    if (!canReadDetails) {
      setDetail({
        action: summary?.action ?? '',
        actorLabel: summary?.actorLabel ?? '',
        actorType: summary?.actorType ?? null,
        afterValues: null,
        beforeValues: null,
        category: summary?.category ?? '',
        eventId,
        eventSource: summary?.eventSource ?? '',
        httpMethod: '',
        occurredAt: summary?.occurredAt ?? '',
        requestId: '',
        requestPath: '',
        statusCode: 0,
        success: summary?.success ?? true,
        targetId: summary?.targetId ?? null,
        targetLabel: summary?.targetLabel ?? '',
        targetType: summary?.targetType ?? null,
        targetUid: summary?.targetUid ?? null,
      });
      return;
    }
    setDetailLoading(true);
    get(`/audit-log/events/${encodeURIComponent(eventId)}`)
      .then((response) => {
        const parsed = parseAuditLogDetailResponse(response.data);
        if (!parsed) {
          throw new Error('Invalid detail');
        }
        setDetail(parsed);
      })
      .catch((error: unknown) => {
        toggleNotification({
          type: 'danger',
          message: readErrorMessage(
            error,
            formatAuditLogMessage(intl, AuditLogTranslationKey.Error),
          ),
        });
      })
      .finally(() => setDetailLoading(false));
  };

  const onExport = async (): Promise<void> => {
    setIsExporting(true);
    const params = new URLSearchParams(draftFiltersToQuery(parsed.draft, 1));
    try {
      const response = await get(`/audit-log/export?${params.toString()}`, {
        responseType: 'blob',
      } as never);
      const blob = new Blob([response.data as BlobPart], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'nhat-ky-hoat-dong.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      toggleNotification({
        type: 'danger',
        message: readErrorMessage(
          error,
          formatAuditLogMessage(intl, AuditLogTranslationKey.ExportError),
        ),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return {
    canExport,
    canReadDetails,
    detail,
    detailLoading,
    draft,
    isExporting,
    isPermissionLoading: isDetailPermissionLoading || isExportPermissionLoading,
    items,
    onApplyFilters,
    onCloseDetail: () => setDetail(null),
    onDraftChange,
    onExport,
    onOpenDetail,
    onQuickCategory,
    onRetry: () => load(parsed.draft, parsed.page),
    page,
    pageCount,
    status,
    total,
  };
};
