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
    {
      // contact-message and reservation-request are unauthenticated create
      // endpoints. Bound the parsed body so a single request cannot pin memory.
      name: 'strapi::body',
      config: {
        jsonLimit: '256kb',
        formLimit: '256kb',
        textLimit: '256kb',
      },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
