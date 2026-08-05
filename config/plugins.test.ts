import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import config, { resolveAuthCookieConfig } from './plugins';

type EnvironmentValues = Readonly<Record<string, string | boolean | undefined>>;

const createEnv = (values: EnvironmentValues): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined => {
    const value = values[key];
    return typeof value === 'string' ? value : fallback;
  }) as Core.Config.Shared.ConfigParams['env'];

  env.bool = (key: string, fallback?: boolean): boolean => {
    const value = values[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return fallback ?? false;
  };

  return env;
};

const createParams = (values: EnvironmentValues): Core.Config.Shared.ConfigParams =>
  ({ env: createEnv(values) }) as Core.Config.Shared.ConfigParams;

const s3Environment: EnvironmentValues = {
  API_REST_PREFIX: '/api/v1',
  S3_BUCKET: 'salanca-media-development',
  S3_REGION: 'ap-southeast-1',
  S3_ROOT_PATH: 'uploads',
  CDN_URL: 'https://media.example.com',
  NODE_ENV: 'development',
};

describe('resolveAuthCookieConfig', () => {
  it('scopes the refresh cookie to the versioned auth routes', () => {
    expect(
      resolveAuthCookieConfig(
        createEnv({
          API_REST_PREFIX: '/api/v1',
          AUTH_COOKIE_NAME: 'salanca_refresh',
          NODE_ENV: 'development',
        }),
      ),
    ).toEqual({
      domain: undefined,
      name: 'salanca_refresh',
      path: '/api/v1/auth',
      sameSite: 'lax',
      secure: false,
    });
  });

  it('rejects a cross-site cookie without HTTPS', () => {
    expect(() =>
      resolveAuthCookieConfig(
        createEnv({
          API_REST_PREFIX: '/api/v1',
          AUTH_COOKIE_SAME_SITE: 'none',
          AUTH_COOKIE_SECURE: false,
        }),
      ),
    ).toThrow('AUTH_COOKIE_SECURE must be true');
  });
});

describe('upload plugin configuration', () => {
  it('stores media through the S3 provider when S3_BUCKET is set', () => {
    expect(config(createParams(s3Environment)).upload).toEqual({
      config: expect.objectContaining({
        provider: 'aws-s3',
        providerOptions: expect.objectContaining({
          baseUrl: 'https://media.example.com',
          rootPath: 'uploads',
        }),
      }),
    });
  });

  it('preserves the media allowlist and the executable denylist', () => {
    const { upload } = config(createParams(s3Environment));

    expect(upload).toEqual({
      config: expect.objectContaining({
        security: {
          allowedTypes: expect.arrayContaining(['image/*', 'application/pdf']),
          deniedTypes: expect.arrayContaining([
            'application/x-sh',
            'application/x-msdownload',
          ]),
        },
      }),
    });
  });

  it('keeps local-disk upload when S3 is unset outside production', () => {
    const { upload } = config(
      createParams({
        API_REST_PREFIX: '/api/v1',
        NODE_ENV: 'development',
      }),
    );

    expect(upload).toEqual({
      config: {
        security: expect.objectContaining({
          allowedTypes: expect.any(Array),
          deniedTypes: expect.any(Array),
        }),
      },
    });
    expect(upload?.config).not.toHaveProperty('provider');
  });

  it('fails startup when production has no S3_BUCKET', () => {
    expect(() =>
      config(
        createParams({
          API_REST_PREFIX: '/api/v1',
          NODE_ENV: 'production',
        }),
      ),
    ).toThrow('S3_BUCKET is required');
  });

  it('fails startup when S3 is enabled but incomplete', () => {
    expect(() =>
      config(
        createParams({
          API_REST_PREFIX: '/api/v1',
          S3_BUCKET: 'salanca-media-development',
          NODE_ENV: 'development',
        }),
      ),
    ).toThrow('S3_REGION is required');
  });
});

describe('users-permissions plugin configuration', () => {
  it('enables refresh-session JWT management', () => {
    expect(config(createParams(s3Environment))['users-permissions']).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          jwtManagement: 'refresh',
          sessions: expect.objectContaining({
            httpOnly: true,
            cookie: expect.objectContaining({
              name: 'salanca_refresh',
              path: '/api/v1/auth',
            }),
          }),
        }),
      }),
    );
  });
});
