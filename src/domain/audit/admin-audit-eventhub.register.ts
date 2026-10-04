import type { Core } from '@strapi/strapi';

import { shouldCaptureAdminAuditEventHub } from './admin-audit-eventhub';
import { toAdminAuditActor } from './admin-audit-actor';
import { readAdminAuditRequestContext } from './admin-audit-request';
import { writeAdminAuditEvent } from './admin-audit-writer';
import { AUDIT_PAYLOAD_MAX_ARRAY_LENGTH, readContentManagerChangedFields } from './audit-payload';
import {
  createCanonicalRequestId,
  readCanonicalRequestId,
} from './request-correlation';

export const registerAdminAuditEventHub = (strapi: Core.Strapi): void => {
  strapi.eventHub.subscribe(async (eventName: string, ...args: unknown[]) => {
    const payload = args[0];
    const request = readAdminAuditRequestContext(strapi);
    const decisions = shouldCaptureAdminAuditEventHub(eventName, payload, {
      body: request.body,
      hasUser: request.hasUser,
      path: request.path,
      routeType: request.routeType,
    });

    if (decisions.length === 0) {
      return;
    }

    const actor = toAdminAuditActor(request.state?.user);
    if (!actor) {
      return;
    }

    const requestId =
      readCanonicalRequestId(request.state) ?? createCanonicalRequestId();
    const changedFields =
      eventName === 'entry.update'
        ? readContentManagerChangedFields(request.body)
        : [];

    const boundedChangedFields = changedFields.slice(0, AUDIT_PAYLOAD_MAX_ARRAY_LENGTH);
    for (const decision of decisions) {
      void writeAdminAuditEvent(strapi, {
        action: decision.action,
        actor,
        afterValues:
          eventName === 'entry.update'
            ? {
                changedFields: boundedChangedFields,
                locale: decision.locale,
                publicationStatus: decision.publicationStatus,
              }
            : {
                locale: decision.locale,
                publicationStatus: decision.publicationStatus,
              },
        eventName,
        httpMethod: request.method,
        occurredAt: new Date().toISOString(),
        requestId,
        requestPath: request.path ?? '/admin',
        statusCode: 200,
        success: true,
        targetDocumentId: decision.targetDocumentId,
        targetLabel: decision.targetLabel,
        targetType: decision.targetType,
        targetUid: decision.targetUid,
      });
    }
  });
};
