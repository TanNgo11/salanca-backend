import type { Core } from '@strapi/strapi';

import { synchronizeContentManagerLabels } from './bootstrap/content-manager-labels';
import { provisionContentLocales } from './bootstrap/content-locales';
import { provisionPublicContentPermissions } from './bootstrap/public-content-permissions';
import { provisionPublicFormPermissions } from './bootstrap/public-form-permissions';
import { registerDocumentInvariants } from './domain/document-invariants/register-document-invariants';
import { getOrCreateMediaProcessingRuntime } from './domain/media-processing/runtime';
import { enforceMediaProcessingUploadSettings } from './domain/media-processing/upload-optimize';

export default {
  /**
   * Extends Strapi before initialization (Document Service middleware, etc.).
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    getOrCreateMediaProcessingRuntime(strapi);
    registerDocumentInvariants(strapi);
  },

  /**
   * Idempotent startup provisioning.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await provisionContentLocales(strapi);
    await provisionPublicContentPermissions(strapi);
    await provisionPublicFormPermissions(strapi);
    await synchronizeContentManagerLabels(strapi);
    await enforceMediaProcessingUploadSettings(strapi);
  },
};
