import type { Core } from '@strapi/strapi';

import { checkHealth } from './health.service';

export const registerHealthRoutes = (strapi: Core.Strapi): void => {
  strapi.server.api('content-api').routes([
    {
      method: 'GET',
      path: '/health',
      handler: (async (ctx: {
        status: number;
        body: unknown;
        set: (name: string, value: string) => void;
      }) => {
        const report = await checkHealth(strapi);
        ctx.set('Cache-Control', 'no-store');
        ctx.status = report.statusCode;
        ctx.body = report.body;
      }) as never,
      config: { auth: false, policies: [], middlewares: [] },
    },
  ]);
};
