import type { Core } from '@strapi/strapi';

import { provisionContentLocales } from './bootstrap/content-locales';
import { provisionPublicContentPermissions } from './bootstrap/public-content-permissions';
import { registerDocumentInvariants } from './domain/document-invariants/register-document-invariants';

export default {
  /**
   * Extends Strapi before initialization (Document Service middleware, etc.).
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    registerDocumentInvariants(strapi);
  },

  /**
   * Idempotent startup provisioning.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await provisionContentLocales(strapi);
    await provisionPublicContentPermissions(strapi);
  },
};
