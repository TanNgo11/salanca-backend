import type { Core } from '@strapi/strapi';

import { toAdminAuditActor } from './admin-audit-actor';
import { isAdminRouteContext } from './admin-audit-coverage';
import { writeAdminAuditEvent } from './admin-audit-writer';
import type { AuditAction, AuditTargetType } from './audit-event.types';
import { isGenericAuditCaptureSuppressed } from './audit-event.suppression';
import {
  createCanonicalRequestId,
  readCanonicalRequestId,
  type CanonicalRequestState,
} from './request-correlation';

export interface AdminAuditRequestState extends CanonicalRequestState {
  route?: { info?: { type?: string } };
  user?: {
    email?: unknown;
    firstname?: unknown;
    id?: unknown;
    lastname?: unknown;
    username?: unknown;
  };
}

export interface AdminAuditRequestContext {
  body?: unknown;
  hasUser: boolean;
  method?: string;
  path?: string;
  routeType?: string;
  state?: AdminAuditRequestState;
}

/**
 * Reads the Koa context attached to the current request via
 * strapi.requestContext. Used by both the EventHub subscriber and the upload
 * extension wrappers so every audit row shares the same route/user gating.
 */
export const readAdminAuditRequestContext = (
  strapi: Core.Strapi,
): AdminAuditRequestContext => {
  const context = strapi.requestContext.get() as
    | {
        method?: string;
        path?: string;
        request?: { body?: unknown; method?: string };
        state?: AdminAuditRequestState;
      }
    | undefined;

  const state = context?.state;
  return {
    body: context?.request?.body,
    hasUser: Boolean(state?.user && (typeof state.user.id === 'number' || typeof state.user.id === 'string')),
    method: context?.method ?? context?.request?.method,
    path: context?.path,
    routeType: state?.route?.info?.type,
    state,
  };
};

/**
 * Writes one admin-panel audit row for the in-flight request when (and only
 * when) it is an authenticated Admin route. Used by the upload extension
 * wrappers after the wrapped service call resolves.
 */
export const writeAdminAuditForCurrentRequest = (
  strapi: Core.Strapi,
  input: Readonly<{
    action: AuditAction;
    eventName?: string;
    targetDocumentId?: string;
    targetLabel?: string;
    targetType: AuditTargetType;
    targetUid?: string;
  }>,
): void => {
  if (isGenericAuditCaptureSuppressed()) {
    return;
  }

  const request = readAdminAuditRequestContext(strapi);
  if (!isAdminRouteContext(request.routeType, request.hasUser)) {
    return;
  }

  const actor = toAdminAuditActor(request.state?.user);
  if (!actor) {
    return;
  }

  const requestId =
    readCanonicalRequestId(request.state) ?? createCanonicalRequestId();

  void writeAdminAuditEvent(strapi, {
    action: input.action,
    actor,
    eventName: input.eventName,
    httpMethod: request.method,
    occurredAt: new Date().toISOString(),
    requestId,
    requestPath: request.path ?? '/admin',
    statusCode: 200,
    success: true,
    targetDocumentId: input.targetDocumentId,
    targetLabel: input.targetLabel,
    targetType: input.targetType,
    targetUid: input.targetUid,
  });
};
