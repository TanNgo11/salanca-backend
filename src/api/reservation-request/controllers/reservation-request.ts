import type { Core } from '@strapi/strapi';
import { factories } from '@strapi/strapi';

import {
  handleReservationCreate,
  RESERVATION_REQUEST_UID,
} from '../../../domain/reservation-request/handle-reservation-create';

export default factories.createCoreController(
  RESERVATION_REQUEST_UID,
  ({ strapi }: { strapi: Core.Strapi }) => ({
    /** Public reservation lead intake — behavior lives in the domain handler. */
    async create(ctx) {
      await handleReservationCreate(strapi, ctx);
    },
  }),
);
