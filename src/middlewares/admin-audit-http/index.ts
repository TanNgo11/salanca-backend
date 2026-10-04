import type { Core } from '@strapi/strapi';

import {
  classifyAdminAuditHttpRequest,
  readNumericPathTargetId,
  type AdminAuditHttpClassification,
} from '../../domain/audit/admin-audit-http.classifier';
import { toAdminAuditActor } from '../../domain/audit/admin-audit-actor';
import { writeAdminAuditEvent } from '../../domain/audit/admin-audit-writer';
import { AuditActorType } from '../../domain/audit/audit-event.types';
import {
  createAuditIdentifierFingerprint,
  readFailedLoginIdentifier,
} from '../../domain/audit/audit-identifier';
import { maskAuditIdentifier } from '../../domain/audit/audit-payload';
import { resolveAuditTargetLabel } from '../../domain/audit/audit-target-label';
import {
  createCanonicalRequestId,
  readCanonicalRequestId,
} from '../../domain/audit/request-correlation';

export interface AdminAuditHttpMiddlewareConfig {
  identifierHashSecret: string;
}

const capturesHttpFailure = (classification: AdminAuditHttpClassification): boolean =>
  classification.captureOn === 'failure' || classification.captureOn === 'outcome';

const capturesHttpSuccess = (classification: AdminAuditHttpClassification): boolean =>
  classification.captureOn === 'success' || classification.captureOn === 'outcome';

const readErrorStatus = (error: unknown): number => {
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : candidate.statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599
    ? status
    : 500;
};

export default (
  config: AdminAuditHttpMiddlewareConfig,
  { strapi }: { strapi: Core.Strapi },
): Core.MiddlewareHandler => {
  if (!config.identifierHashSecret.trim()) {
    throw new Error('AUDIT_IDENTIFIER_HASH_SECRET is required.');
  }

  return async (ctx, next): Promise<void> => {
    const classification = classifyAdminAuditHttpRequest(ctx.method, ctx.path);
    if (!classification) {
      await next();
      return;
    }

    // The http-log middleware already owns ctx.state.requestId and
    // X-Request-ID. When it is missing/invalid, the audit row gets its own
    // UUID without touching request state or headers.
    const requestId =
      readCanonicalRequestId(ctx.state) ?? createCanonicalRequestId();
    const identifier = capturesHttpFailure(classification)
      ? readFailedLoginIdentifier(ctx.request.body)
      : null;

    const writeFailure = async (statusCode: number): Promise<void> => {
      await writeAdminAuditEvent(strapi, {
        action: classification.action,
        actor: { type: AuditActorType.Anonymous },
        afterValues: identifier
          ? { maskedIdentifier: maskAuditIdentifier(identifier) }
          : undefined,
        httpMethod: ctx.method,
        identifierFingerprint: identifier
          ? createAuditIdentifierFingerprint(identifier, config.identifierHashSecret)
          : undefined,
        occurredAt: new Date().toISOString(),
        requestId,
        requestPath: ctx.path,
        statusCode,
        success: false,
        targetType: classification.targetType,
        targetUid: classification.targetUid,
      });
    };

    try {
      await next();
    } catch (error) {
      if (capturesHttpFailure(classification)) {
        await writeFailure(readErrorStatus(error));
      }
      throw error;
    }

    const success = ctx.status >= 200 && ctx.status < 400;
    if (!success) {
      if (capturesHttpFailure(classification)) {
        await writeFailure(ctx.status);
      }
      return;
    }

    if (!capturesHttpSuccess(classification)) {
      return;
    }

    const actor = toAdminAuditActor(ctx.state.user) ?? {
      type: AuditActorType.Anonymous,
    };
    const isLoginOutcome = classification.captureOn === 'outcome';

    await writeAdminAuditEvent(strapi, {
      action: classification.successAction ?? classification.action,
      actor,
      httpMethod: ctx.method,
      occurredAt: new Date().toISOString(),
      requestId,
      requestPath: ctx.path,
      statusCode: ctx.status,
      success: true,
      targetDocumentId: isLoginOutcome
        ? actor.documentId
        : readNumericPathTargetId(ctx.path),
      targetLabel: isLoginOutcome
        ? resolveAuditTargetLabel(ctx.state.user) ?? actor.label
        : undefined,
      targetType: classification.targetType,
      targetUid: classification.targetUid,
    });
  };
};
