import { logProcessWarnings } from '@tanngo11/log';
import { strapiServerErrors } from '@tanngo11/log/strapi';
import type { Core } from '@strapi/strapi';

import {
  backfillAdminUserLanguage,
  registerAdminUserLanguageDefault,
} from './bootstrap/admin-user-language';
import { synchronizeContentManagerLabels } from './bootstrap/content-manager-labels';
import { warnIfFormIntakeSecretMissing } from './bootstrap/form-intake-secret-warning';
import { provisionContentLocales } from './bootstrap/content-locales';
import { provisionPublicContentPermissions } from './bootstrap/public-content-permissions';
import { provisionPublicFormPermissions } from './bootstrap/public-form-permissions';
import {
  bootstrapAuditLogPermissions,
  registerAuditLogAdminRoutes,
  registerAuditLogPermissions,
} from './api/audit-log';
import { registerHealthRoutes } from './api/health';
import {
  bootstrapLeadExportPermissions,
  registerLeadExportAdminRoutes,
  registerLeadExportPermissions,
} from './api/lead-export';
import {
  bootstrapNotificationSettingsPermissions,
  registerNotificationSettingsAdminRoutes,
  registerNotificationSettingsPermissions,
} from './api/notification-settings';
import {
  bootstrapReservationInboxPermissions,
  registerReservationInboxAdminRoutes,
  registerReservationInboxPermissions,
} from './api/reservation-inbox';
import { registerAdminAuditEventHub } from './domain/audit/admin-audit-eventhub.register';
import { registerDocumentInvariants } from './domain/document-invariants/register-document-invariants';
import { getOrCreateMediaProcessingRuntime } from './domain/media-processing/runtime';
import { enforceMediaProcessingUploadSettings } from './domain/media-processing/upload-optimize';
import { recordOrderingAppBootstrap, registerOrderingAdapters } from './ordering/register-ordering-adapters';
import { log } from './shared/log';

export default {
  /**
   * Extends Strapi before initialization (Document Service middleware, etc.).
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Node warnings (deprecations...) as JSON with the call-site stack.
    logProcessWarnings(log);
    // Koa stream errors (client aborted, parse error) as one JSON line, not raw stderr frames.
    strapiServerErrors(strapi.server.app, log);
    getOrCreateMediaProcessingRuntime(strapi);
    registerDocumentInvariants(strapi);
    registerHealthRoutes(strapi);
    registerOrderingAdapters(strapi);
    registerAuditLogPermissions(strapi);
    registerAuditLogAdminRoutes(strapi);
    registerReservationInboxPermissions(strapi);
    registerReservationInboxAdminRoutes(strapi);
    registerLeadExportPermissions(strapi);
    registerLeadExportAdminRoutes(strapi);
    registerNotificationSettingsPermissions(strapi);
    registerNotificationSettingsAdminRoutes(strapi);
    registerAdminAuditEventHub(strapi);
    registerAdminUserLanguageDefault(strapi);
  },

  /**
   * Idempotent startup provisioning.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    warnIfFormIntakeSecretMissing(strapi);
    await provisionContentLocales(strapi);
    await provisionPublicContentPermissions(strapi);
    await provisionPublicFormPermissions(strapi);
    await synchronizeContentManagerLabels(strapi);
    await enforceMediaProcessingUploadSettings(strapi);
    await bootstrapAuditLogPermissions(strapi);
    await bootstrapReservationInboxPermissions(strapi);
    await bootstrapLeadExportPermissions(strapi);
    await bootstrapNotificationSettingsPermissions(strapi);
    await backfillAdminUserLanguage(strapi);
    recordOrderingAppBootstrap(strapi);
  },
};
