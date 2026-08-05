import { factories } from '@strapi/strapi';

/** Public REST: create only (Admin triage uses Content Manager, not this router). */
export default factories.createCoreRouter('api::reservation-request.reservation-request', {
  only: ['create'],
});
