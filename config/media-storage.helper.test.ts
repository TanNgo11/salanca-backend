import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import {
  assertProductionMediaStorage,
  isObjectStorageEnabled,
  resolveMediaCdnOrigin,
  resolveMediaStorageConfig,
  resolveOptionalMediaCdnOrigin,
} from './media-storage.helper';

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

const createEnv = (values: EnvironmentValues): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined =>
    values[key] ?? fallback) as Core.Config.Shared.ConfigParams['env'];

  env.bool = (key: string, fallback?: boolean): boolean => {
    const value = values[key];

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

const awsEnvironment: EnvironmentValues = {
  S3_BUCKET: 'salanca-media',
  S3_REGION: 'ap-southeast-1',
  S3_ROOT_PATH: 'uploads',
  CDN_URL: 'https://media.example.com',
};

describe('isObjectStorageEnabled', () => {
  it('is false when S3_BUCKET is absent', () => {
    expect(isObjectStorageEnabled(createEnv({}))).toBe(false);
  });

  it('is true when S3_BUCKET is set', () => {
    expect(isObjectStorageEnabled(createEnv({ S3_BUCKET: 'salanca-media' }))).toBe(true);
  });
});

describe('resolveMediaStorageConfig', () => {
  it('builds the aws-s3 provider options from a complete environment', () => {
    expect(resolveMediaStorageConfig(createEnv(awsEnvironment))).toEqual({
      provider: 'aws-s3',
      providerOptions: {
        baseUrl: 'https://media.example.com',
        rootPath: 'uploads',
        s3Options: {
          region: 'ap-southeast-1',
          params: {
            Bucket: 'salanca-media',
            ACL: undefined,
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    });
  });

  it('sends public-read for an ACL-based S3-compatible provider', () => {
    const { providerOptions } = resolveMediaStorageConfig(
      createEnv({ ...awsEnvironment, S3_ACL: 'public-read' }),
    );

    expect(providerOptions.s3Options.params.ACL).toBe('public-read');
  });

  it('uses static credentials when both are provided', () => {
    const { providerOptions } = resolveMediaStorageConfig(
      createEnv({
        ...awsEnvironment,
        S3_ACCESS_KEY_ID: 'key-id',
        S3_ACCESS_SECRET: 'key-secret',
      }),
    );

    expect(providerOptions.s3Options.credentials).toEqual({
      accessKeyId: 'key-id',
      secretAccessKey: 'key-secret',
    });
  });

  it('configures an S3-compatible endpoint with path style', () => {
    const { providerOptions } = resolveMediaStorageConfig(
      createEnv({
        ...awsEnvironment,
        S3_ENDPOINT: 'https://s3.example-vendor.com',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    );

    expect(providerOptions.s3Options.endpoint).toBe('https://s3.example-vendor.com');
    expect(providerOptions.s3Options.forcePathStyle).toBe(true);
  });

  it('rejects missing region when object storage is configured', () => {
    expect(() =>
      resolveMediaStorageConfig(
        createEnv({
          S3_BUCKET: 'salanca-media',
          S3_ROOT_PATH: 'uploads',
          CDN_URL: 'https://media.example.com',
        }),
      ),
    ).toThrow('S3_REGION is required');
  });
});

describe('resolveMediaCdnOrigin', () => {
  it('accepts a bare HTTPS origin', () => {
    expect(resolveMediaCdnOrigin(createEnv({ CDN_URL: 'https://media.example.com' }))).toBe(
      'https://media.example.com',
    );
  });

  it('rejects a CDN URL with a path', () => {
    expect(() =>
      resolveMediaCdnOrigin(createEnv({ CDN_URL: 'https://media.example.com/assets' })),
    ).toThrow('bare HTTPS origin');
  });
});

describe('resolveOptionalMediaCdnOrigin', () => {
  it('returns null when CDN_URL is unset', () => {
    expect(resolveOptionalMediaCdnOrigin(createEnv({}))).toBeNull();
  });

  it('returns the origin when CDN_URL is set', () => {
    expect(
      resolveOptionalMediaCdnOrigin(createEnv({ CDN_URL: 'https://media.example.com' })),
    ).toBe('https://media.example.com');
  });
});

describe('assertProductionMediaStorage', () => {
  it('allows local disk outside production when S3 is unset', () => {
    expect(() => assertProductionMediaStorage(createEnv({ NODE_ENV: 'development' }))).not.toThrow();
  });

  it('requires S3_BUCKET in production', () => {
    expect(() => assertProductionMediaStorage(createEnv({ NODE_ENV: 'production' }))).toThrow(
      'S3_BUCKET is required when NODE_ENV=production',
    );
  });

  it('requires S3_BUCKET when MEDIA_STORAGE_MODE=s3', () => {
    expect(() =>
      assertProductionMediaStorage(createEnv({ MEDIA_STORAGE_MODE: 's3' })),
    ).toThrow('S3_BUCKET is required');
  });

  it('accepts a complete production S3 environment', () => {
    expect(() =>
      assertProductionMediaStorage(
        createEnv({
          ...awsEnvironment,
          NODE_ENV: 'production',
        }),
      ),
    ).not.toThrow();
  });
});
