import type { Core } from '@strapi/strapi';

import { resolveRestApiPrefix } from './api-prefix.helper';
import {
  assertProductionMediaStorage,
  isObjectStorageEnabled,
  resolveMediaStorageConfig,
} from './media-storage.helper';
import {
  isTransactionalEmailConfigured,
  resolveTransactionalEmailConfig,
} from './transactional-email.helper';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

enum AuthCookieSameSite {
  Lax = 'lax',
  None = 'none',
  Strict = 'strict',
}

const resolveAuthCookieSameSite = (value: string): AuthCookieSameSite => {
  switch (value) {
    case AuthCookieSameSite.Lax:
      return AuthCookieSameSite.Lax;
    case AuthCookieSameSite.None:
      return AuthCookieSameSite.None;
    case AuthCookieSameSite.Strict:
      return AuthCookieSameSite.Strict;
    default:
      throw new Error(
        `AUTH_COOKIE_SAME_SITE must be one of: ${Object.values(AuthCookieSameSite).join(', ')}`,
      );
  }
};

export const resolveAuthCookieConfig = (env: Core.Config.Shared.ConfigParams['env']) => {
  const sameSite = resolveAuthCookieSameSite(env('AUTH_COOKIE_SAME_SITE', 'lax'));
  const secure = env.bool('AUTH_COOKIE_SECURE', env('NODE_ENV') === 'production');
  const apiPrefix = resolveRestApiPrefix(env);

  if (sameSite === AuthCookieSameSite.None && !secure) {
    throw new Error('AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none.');
  }

  return {
    name: env('AUTH_COOKIE_NAME', 'salanca_refresh'),
    sameSite,
    path: `${apiPrefix}/auth`,
    secure,
    domain: env('AUTH_COOKIE_DOMAIN'),
  };
};

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  assertProductionMediaStorage(env);

  const uploadSecurity = {
    security: {
      allowedTypes: allowedMediaTypes,
      deniedTypes: deniedExecutableTypes,
    },
  };

  const uploadConfig = isObjectStorageEnabled(env)
    ? {
        ...resolveMediaStorageConfig(env),
        ...uploadSecurity,
      }
    : uploadSecurity;

  return {
    'users-permissions': {
      config: {
        jwtManagement: 'refresh',
        sessions: {
          httpOnly: true,
          cookie: resolveAuthCookieConfig(env),
        },
      },
    },
    // Opt-in Resend SMTP (BDS pattern). Set EMAIL_SMTP_HOST to enable; leave unset for form-only local.
    ...(isTransactionalEmailConfigured(env)
      ? {
          email: {
            config: resolveTransactionalEmailConfig(env),
          },
        }
      : {}),
    upload: {
      config: uploadConfig,
    },
  };
};

export default config;
