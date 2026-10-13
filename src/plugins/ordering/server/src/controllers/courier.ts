import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type courierFactory from '../services/courier';
import { adminAction } from './http';

type Courier = ReturnType<typeof courierFactory>;

/** GET /ordering/courier/deliveries?view=active|done — the signed-in courier's own day. */
const courier = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('courier') as Courier;
  return {
    deliveries: adminAction(strapi, async (ctx, serviceCtx) => {
      const raw = ctx.query.view;
      const view = raw === undefined || raw === 'active' ? 'active' : raw === 'done' ? 'done' : null;
      if (!view) {
        throw new OrderingError('VALIDATION_ERROR', 'view must be active or done', {
          details: { field: 'view' },
        });
      }
      return service().myDeliveries(serviceCtx, view);
    }),
  };
};

export default courier;
