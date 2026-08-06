import type { Core } from '@strapi/strapi';
import { factories } from '@strapi/strapi';

import {
  CONTACT_MESSAGE_UID,
  handleContactCreate,
} from '../../../domain/contact-message/handle-contact-create';

export default factories.createCoreController(
  CONTACT_MESSAGE_UID,
  ({ strapi }: { strapi: Core.Strapi }) => ({
    /** Public contact form intake — behavior lives in the domain handler. */
    async create(ctx) {
      await handleContactCreate(strapi, ctx);
    },
  }),
);
