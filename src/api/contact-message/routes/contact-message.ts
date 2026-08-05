import { factories } from '@strapi/strapi';

/** Public REST: create only (Admin triage uses Content Manager, not this router). */
export default factories.createCoreRouter('api::contact-message.contact-message', {
  only: ['create'],
});
