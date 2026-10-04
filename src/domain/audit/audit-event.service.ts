import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { withGenericAuditCaptureSuppressed } from './audit-event.suppression';
import {
  AuditEventSource,
  type CreateAuditEventInput,
} from './audit-event.types';
import { boundTargetLabel } from './audit-payload';
import { markAuditRequestCaptured } from './audit-request-capture';

export const createAuditEvent = async (
  strapi: Core.Strapi,
  input: CreateAuditEventInput,
): Promise<void> => {
  await withGenericAuditCaptureSuppressed(async () => {
    await strapi.documents('api::audit-event.audit-event').create({
      data: {
        eventId: randomUUID(),
        actorType: input.actor.type,
        actorDocumentId: input.actor.documentId,
        actorLabel: input.actor.label,
        action: input.action,
        targetType: input.targetType,
        targetDocumentId: input.targetDocumentId,
        targetUid: input.targetUid,
        targetLabel: boundTargetLabel(input.targetLabel),
        eventSource: input.eventSource ?? AuditEventSource.AdminPanel,
        occurredAt: input.occurredAt,
        requestId: input.requestId,
        httpMethod: input.httpMethod,
        requestPath: input.requestPath,
        statusCode: input.statusCode,
        success: input.success,
        identifierFingerprint: input.identifierFingerprint,
        beforeValues: input.beforeValues as never,
        afterValues: input.afterValues as never,
      },
      fields: ['documentId'],
    });
  });
  markAuditRequestCaptured(input.requestId);
};
