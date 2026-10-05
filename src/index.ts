import { logProcessWarnings } from '@tanngo11/log';
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
import { registerExperienceStoryRoutes } from './api/experience-story';
import {
  bootstrapReservationInboxPermissions,
  registerReservationInboxAdminRoutes,
  registerReservationInboxPermissions,
} from './api/reservation-inbox';
import { registerAdminAuditEventHub } from './domain/audit/admin-audit-eventhub.register';
import { registerDocumentInvariants } from './domain/document-invariants/register-document-invariants';
import { getOrCreateMediaProcessingRuntime } from './domain/media-processing/runtime';
import { enforceMediaProcessingUploadSettings } from './domain/media-processing/upload-optimize';
import { log } from './shared/log';

export default {
  /**
   * Extends Strapi before initialization (Document Service middleware, etc.).
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Node warnings (deprecations...) as JSON with the call-site stack.
    logProcessWarnings(log);
    getOrCreateMediaProcessingRuntime(strapi);
    registerDocumentInvariants(strapi);
    registerHealthRoutes(strapi);
    registerExperienceStoryRoutes(strapi);
    registerAuditLogPermissions(strapi);
    registerAuditLogAdminRoutes(strapi);
    registerReservationInboxPermissions(strapi);
    registerReservationInboxAdminRoutes(strapi);
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
    await backfillAdminUserLanguage(strapi);
  },
};
