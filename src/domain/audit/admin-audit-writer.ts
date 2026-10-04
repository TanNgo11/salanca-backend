import type { Core } from '@strapi/strapi';

import { createAuditEvent } from './audit-event.service';
import {
  AuditEventSource,
  AuditHttpMethod,
  type CreateAuditEventInput,
} from './audit-event.types';
import { AuditPayloadRejectedError, normalizeAuditPayload } from './audit-payload';

const resolveHttpMethod = (method: string | undefined): AuditHttpMethod => {
  switch (method?.toUpperCase()) {
    case AuditHttpMethod.Delete:
      return AuditHttpMethod.Delete;
    case AuditHttpMethod.Patch:
      return AuditHttpMethod.Patch;
    case AuditHttpMethod.Put:
      return AuditHttpMethod.Put;
    case AuditHttpMethod.Get:
      return AuditHttpMethod.Get;
    default:
      return AuditHttpMethod.Post;
  }
};

export const writeAdminAuditEvent = async (
  strapi: Core.Strapi,
  input: Omit<CreateAuditEventInput, 'eventSource' | 'httpMethod'> & {
    eventName?: string;
    httpMethod?: string;
  },
): Promise<void> => {
  let afterValues = input.afterValues;
  let beforeValues = input.beforeValues;
  try {
    if (afterValues !== undefined) {
      afterValues = normalizeAuditPayload(afterValues) as CreateAuditEventInput['afterValues'];
    }
    if (beforeValues !== undefined) {
      beforeValues = normalizeAuditPayload(beforeValues) as CreateAuditEventInput['beforeValues'];
    }
  } catch (error) {
    if (error instanceof AuditPayloadRejectedError) {
      afterValues = undefined;
      beforeValues = undefined;
    } else {
      throw error;
    }
  }

  try {
    await createAuditEvent(strapi, {
      ...input,
      afterValues,
      beforeValues,
      eventSource: AuditEventSource.AdminPanel,
      httpMethod: resolveHttpMethod(input.httpMethod),
    });
  } catch (error) {
    strapi.log.error('Best-effort admin audit capture failed after the source mutation committed.', {
      action: input.action,
      error,
      eventName: input.eventName,
      requestId: input.requestId,
      targetDocumentId: input.targetDocumentId,
      targetUid: input.targetUid,
    });
  }
};
