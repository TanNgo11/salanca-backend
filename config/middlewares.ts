import type { Core } from '@strapi/strapi';

import { resolveFrontendOrigins } from './cors.helper';
import {
  isObjectStorageEnabled,
  resolveMediaCdnOrigin,
  resolveOptionalMediaCdnOrigin,
} from './media-storage.helper';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  // Validated when the admin-audit-http middleware is instantiated at server
  // start, not here: `strapi build` loads config without runtime secrets.
  const auditIdentifierHashSecret = env('AUDIT_IDENTIFIER_HASH_SECRET', '');

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
    // Structured JSON request log (log contract v1); replaces strapi::logger.
    { resolve: './src/middlewares/http-log' },
    'strapi::errors',
    // Must stay directly after strapi::errors so unhandled errors are logged once.
    { resolve: './src/middlewares/error-capture' },
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
    // Admin audit trail: login outcomes, role-permission saves, token and
    // webhook mutations. Reads ctx.state.requestId from http-log.
    {
      resolve: './src/middlewares/admin-audit-http',
      config: { identifierHashSecret: auditIdentifierHashSecret },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
