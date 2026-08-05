import awsS3Provider from '@strapi/provider-upload-aws-s3';
import type { Core } from '@strapi/strapi';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveMediaStorageConfig } from './media-storage.helper';

/**
 * Contract test against the installed provider. It constructs the real client
 * — no network call is made until an upload runs — so a provider upgrade that
 * changes the accepted option shape fails here instead of at first upload.
 */
const createEnv = (
  values: Readonly<Record<string, string | undefined>>,
): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined =>
    values[key] ?? fallback) as Core.Config.Shared.ConfigParams['env'];

  env.bool = (key: string, fallback?: boolean): boolean =>
    values[key] === 'true' ? true : (fallback ?? false);

  return env;
};

const buildProviderOptions = (objectAcl?: string) =>
  resolveMediaStorageConfig(
    createEnv({
      S3_BUCKET: 'salanca-media-development',
      S3_REGION: 'ap-southeast-1',
      S3_ROOT_PATH: 'uploads',
      CDN_URL: 'https://media.example.com',
      S3_ACL: objectAcl,
    }),
  ).providerOptions;

const providerOptions = buildProviderOptions();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installed aws-s3 provider contract', () => {
  it('accepts the resolved provider options and exposes the actions the plan requires', () => {
    const provider = awsS3Provider.init(providerOptions);

    expect(typeof provider.upload).toBe('function');
    expect(typeof provider.uploadStream).toBe('function');
    expect(typeof provider.delete).toBe('function');
  });

  it('treats the bucket as public so media is served by the CDN without signed URLs', () => {
    expect(awsS3Provider.init(providerOptions).isPrivate()).toBe(false);
  });

  it('never lets the provider inject its public-read ACL default', () => {
    const options = buildProviderOptions();

    awsS3Provider.init(options);

    expect(options.s3Options.params.ACL).toBeUndefined();
  });

  it('passes an explicit public-read ACL to providers that require object-level access', () => {
    const options = buildProviderOptions('public-read');

    awsS3Provider.init(options);

    expect(options.s3Options.params.ACL).toBe('public-read');
  });

  it('does not use the deprecated root-level option shape', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);

    awsS3Provider.init(providerOptions);

    expect(emitWarning).not.toHaveBeenCalled();
  });
});
