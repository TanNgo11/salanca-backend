import type { Core } from '@strapi/strapi';

import {
  createCanonicalRequestId,
  readCanonicalRequestId,
} from '../../domain/audit/request-correlation';
import { AuditLogError } from './audit-log.error';
import { parseAuditLogEventId, parseAuditLogExportQuery, parseAuditLogListQuery } from './audit-log.query';
import { createAuditLogService } from './audit-log.service';
import {
  AuditLogErrorCode,
  type ApiAuditLogController,
  type ApiAuditLogRequestContext,
} from './audit-log.types';

const handleControllerError = (
  strapi: Core.Strapi,
  context: ApiAuditLogRequestContext,
  error: Error,
  requestId: string,
): void => {
  if (error instanceof AuditLogError) {
    switch (error.code) {
      case AuditLogErrorCode.InvalidQuery:
      case AuditLogErrorCode.ExportTooLarge:
        context.badRequest(error.vietnameseMessage);
        return;
      case AuditLogErrorCode.Forbidden:
        context.forbidden(error.vietnameseMessage);
        return;
      case AuditLogErrorCode.NotFound:
        if (context.notFound) {
          context.notFound(error.vietnameseMessage);
        } else {
          context.badRequest(error.vietnameseMessage);
        }
        return;
      default:
        break;
    }
  }

  strapi.log.error('Audit log controller error.', { error, requestId });
  context.internalServerError('Không thể tải nhật ký lúc này. Vui lòng thử lại sau.');
};

const readRequestId = (context: ApiAuditLogRequestContext): string =>
  readCanonicalRequestId(context.state) ?? createCanonicalRequestId();

export const createAuditLogController = (strapi: Core.Strapi): ApiAuditLogController => {
  const service = createAuditLogService(strapi);

  return {
    async find(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          context.body = await service.find(parseAuditLogListQuery(context.query));
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async findOne(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const eventId = parseAuditLogEventId(context.params?.eventId);
          context.body = { data: await service.findOne(eventId) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async exportCsv(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const csv = await service.exportCsv(parseAuditLogExportQuery(context.query));
          context.set('Content-Type', 'text/csv; charset=utf-8');
          context.set(
            'Content-Disposition',
            'attachment; filename="nhat-ky-hoat-dong.csv"',
          );
          context.body = csv;
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },
  };
};
