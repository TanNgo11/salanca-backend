import type { Core } from '@strapi/strapi';

import { resolveFrontendOrigins } from './cors.helper';
import {
  isObjectStorageEnabled,
  resolveMediaCdnOrigin,
  resolveOptionalMediaCdnOrigin,
} from './media-storage.helper';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  const frontendOrigins = resolveFrontendOrigins(env);
  const mediaCdnOrigin = isObjectStorageEnabled(env)
    ? resolveMediaCdnOrigin(env)
    : resolveOptionalMediaCdnOrigin(env);

  const securityMiddleware: Core.Config.Middlewares[number] = mediaCdnOrigin
    ? {
        name: 'strapi::security',
        config: {
          contentSecurityPolicy: {
            useDefaults: true,
            directives: {
              'img-src': [
                "'self'",
                'data:',
                'blob:',
                'https://market-assets.strapi.io',
                mediaCdnOrigin,
              ],
              'media-src': ["'self'", 'data:', 'blob:', mediaCdnOrigin],
            },
          },
        },
      }
    : 'strapi::security';

  return [
    'strapi::logger',
    'strapi::errors',
    securityMiddleware,
    {
      name: 'strapi::cors',
      config: {
        origin: frontendOrigins,
        credentials: true,
        headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        keepHeaderOnError: true,
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
