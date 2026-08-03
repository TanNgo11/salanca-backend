import type { Core } from '@strapi/strapi';

import { resolveRestApiPrefix } from './api-prefix.helper';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Api => ({
  rest: {
    prefix: resolveRestApiPrefix(env),
    defaultLimit: 25,
    maxLimit: 100,
    withCount: true,
    strictParams: true,
  },
  documents: {
    strictParams: true,
  },
});

export default config;
