import type { Core } from '@strapi/strapi';

import {
  createCanonicalRequestId,
  readCanonicalRequestId,
} from '../../domain/audit/request-correlation';
import { RESERVATION_STAFF_NOTE_MAX_LENGTH } from '../../shared/lead-status/lead-status';
import { subscribeReservationCreated } from '../../domain/reservation-request/reservation-inbox-events';
import { ReservationInboxError } from './reservation-inbox.error';
import { createReservationInboxService } from './reservation-inbox.service';
import {
  formatSseComment,
  formatSseEvent,
  SSE_EVENT_RESERVATION_CREATED,
  SSE_HEADERS,
  startSseHeartbeat,
} from './reservation-inbox.sse';
import {
  ReservationInboxErrorCode,
  RESERVATION_INBOX_SEARCH_MAX_LENGTH,
  RESERVATION_INBOX_SUMMARY_LIMIT,
  RESERVATION_STATUSES,
  type ApiReservationInboxController,
  type ApiReservationInboxRequestContext,
  type ReservationStatus,
} from './reservation-inbox.types';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9]{10,40}$/;

const handleControllerError = (
  strapi: Core.Strapi,
  context: ApiReservationInboxRequestContext,
  error: Error,
  requestId: string,
): void => {
  if (error instanceof ReservationInboxError) {
    switch (error.code) {
      case ReservationInboxErrorCode.InvalidQuery:
        context.badRequest(error.vietnameseMessage);
        return;
      case ReservationInboxErrorCode.NotFound:
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

  strapi.log.error('Reservation inbox controller error.', { error, requestId });
  context.internalServerError('Không thể tải hộp thư đặt bàn lúc này. Vui lòng thử lại sau.');
};

const readRequestId = (context: ApiReservationInboxRequestContext): string =>
  readCanonicalRequestId(context.state) ?? createCanonicalRequestId();

const parseSummaryQuery = (
  query: unknown,
): { since?: string; limit: number } => {
  const raw = (query ?? {}) as Record<string, unknown>;
  const since = raw.since;
  if (since === undefined || since === null || since === '') {
    return { limit: RESERVATION_INBOX_SUMMARY_LIMIT };
  }
  if (
    typeof since !== 'string' ||
    !ISO_DATE_PATTERN.test(since) ||
    Number.isNaN(Date.parse(since))
  ) {
    throw new ReservationInboxError(
      ReservationInboxErrorCode.InvalidQuery,
      `Invalid since query value: ${String(since)}.`,
      'Tham số thời gian không hợp lệ. Vui lòng dùng định dạng ISO.',
    );
  }
  return { since, limit: RESERVATION_INBOX_SUMMARY_LIMIT };
};

const invalidQuery = (reason: string, vietnameseMessage: string): ReservationInboxError =>
  new ReservationInboxError(ReservationInboxErrorCode.InvalidQuery, reason, vietnameseMessage);

const parseStatus = (value: unknown): ReservationStatus => {
  const status = RESERVATION_STATUSES.find((candidate) => candidate === value);
  if (!status) {
    throw invalidQuery(
      `Invalid status value: ${String(value)}.`,
      'Trạng thái không hợp lệ.',
    );
  }
  return status;
};

const parseNote = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalidQuery('Invalid staff note type.', 'Ghi chú không hợp lệ.');
  }
  if (value.length > RESERVATION_STAFF_NOTE_MAX_LENGTH) {
    throw invalidQuery(
      `Staff note too long: ${value.length}.`,
      `Ghi chú tối đa ${RESERVATION_STAFF_NOTE_MAX_LENGTH} ký tự.`,
    );
  }
  return value;
};

const parseListQuery = (
  query: unknown,
): { status?: ReservationStatus; search?: string; page: number } => {
  const raw = (query ?? {}) as Record<string, unknown>;

  const status =
    raw.status === undefined || raw.status === null || raw.status === ''
      ? undefined
      : parseStatus(raw.status);

  const search =
    typeof raw.search === 'string'
      ? raw.search.trim().slice(0, RESERVATION_INBOX_SEARCH_MAX_LENGTH)
      : '';

  const rawPage = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  if (!Number.isInteger(rawPage) || rawPage < 1) {
    throw invalidQuery(`Invalid page value: ${String(raw.page)}.`, 'Số trang không hợp lệ.');
  }

  return { status, search: search || undefined, page: rawPage };
};

const parseDocumentId = (documentId: unknown): string => {
  if (typeof documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new ReservationInboxError(
      ReservationInboxErrorCode.InvalidQuery,
      `Invalid reservation documentId: ${String(documentId)}.`,
      'Mã yêu cầu đặt bàn không hợp lệ.',
    );
  }
  return documentId;
};

export const createReservationInboxController = (
  strapi: Core.Strapi,
): ApiReservationInboxController => {
  const service = createReservationInboxService(strapi);

  return {
    async summary(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          context.body = { data: await service.summary(parseSummaryQuery(context.query)) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    stream(context): void {
      // Raw SSE: Koa must not close or transform the response body.
      context.respond = false;
      context.status = 200;
      context.res.writeHead(200, { ...SSE_HEADERS });
      context.res.write(formatSseComment('connected'));

      const stopHeartbeat = startSseHeartbeat((chunk) => {
        try {
          context.res.write(chunk);
        } catch (error) {
          strapi.log.error('Reservation inbox heartbeat write failed.', { error });
        }
      });
      const unsubscribe = subscribeReservationCreated((item) => {
        try {
          context.res.write(formatSseEvent(SSE_EVENT_RESERVATION_CREATED, item));
        } catch (error) {
          strapi.log.error('Reservation inbox event write failed.', { error });
        }
      });

      // res 'close' fires reliably on client disconnect (req 'close' semantics
      // changed in Node 16 and may not fire for completed requests).
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        stopHeartbeat();
        unsubscribe();
        try {
          context.res.end();
        } catch {
          // Socket already closed; nothing to clean up.
        }
      };
      context.res.on('close', cleanup);
    },

    async list(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          context.body = { data: await service.list(parseListQuery(context.query)) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async detail(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const documentId = parseDocumentId(context.params?.documentId);
          context.body = { data: await service.detail(documentId) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async setStatus(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const documentId = parseDocumentId(context.params?.documentId);
          const body = (context.request?.body ?? {}) as Record<string, unknown>;
          context.body = {
            data: await service.setStatus(documentId, parseStatus(body.status)),
          };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async setNote(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const documentId = parseDocumentId(context.params?.documentId);
          const body = (context.request?.body ?? {}) as Record<string, unknown>;
          context.body = { data: await service.setNote(documentId, parseNote(body.note)) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },

    async markRead(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const documentId = parseDocumentId(context.params?.documentId);
          context.body = { data: await service.markRead(documentId) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },
  };
};
