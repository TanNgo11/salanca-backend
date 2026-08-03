import type { Core } from '@strapi/strapi';

type Environment = Core.Config.Shared.ConfigParams['env'];

/**
 * The bucket prefix every stored object shares. It must stay stable after the
 * first upload: changing it makes stored URLs and provider deletion keys
 * disagree.
 */
const rootPathPattern = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

const loopbackHostnames = ['localhost', '127.0.0.1', '[::1]'];

interface MediaStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

interface MediaStorageBucketParams {
  Bucket: string;
  /**
   * Always present. `undefined` suppresses Strapi's `public-read` fallback for
   * buckets that disable object ACLs; `public-read` supports S3-compatible
   * vendors that enforce public access per object.
   */
  ACL: 'public-read' | undefined;
}

interface MediaStorageS3Options {
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: MediaStorageCredentials;
  params: MediaStorageBucketParams;
}

export interface MediaStorageConfig {
  provider: 'aws-s3';
  providerOptions: {
    baseUrl: string;
    rootPath: string;
    s3Options: MediaStorageS3Options;
  };
  actionOptions: {
    upload: Record<string, never>;
    uploadStream: Record<string, never>;
    delete: Record<string, never>;
  };
}

const requireEnvValue = (env: Environment, key: string): string => {
  const value = env(key)?.trim();

  if (!value) {
    throw new Error(
      `${key} is required when S3 object storage is enabled (S3_BUCKET is set).`,
    );
  }

  return value;
};

const parseAbsoluteUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * True when the operator opted into S3-compatible object storage by setting
 * S3_BUCKET. Local disk remains the default until that flag is present so
 * existing developer machines keep booting without storage credentials.
 * Staging and production must set S3_BUCKET (and related vars).
 */
export const isObjectStorageEnabled = (env: Environment): boolean =>
  Boolean(env('S3_BUCKET')?.trim());

/**
 * The public origin stored media URLs are built from. Kept separate from the
 * provider options because the Admin content security policy needs the exact
 * same host.
 */
export const resolveMediaCdnOrigin = (env: Environment): string => {
  const value = requireEnvValue(env, 'CDN_URL');
  const url = parseAbsoluteUrl(value);
  const isBareOrigin =
    url !== null &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  const isAllowedProtocol =
    url?.protocol === 'https:' || (url !== null && loopbackHostnames.includes(url.hostname));

  if (!url || !isBareOrigin || !isAllowedProtocol) {
    throw new Error(
      'CDN_URL must be a bare HTTPS origin without a path, query, fragment, or credentials. ' +
        'Plain HTTP is accepted only for a loopback development origin.',
    );
  }

  return url.origin;
};

/**
 * Optional CDN origin for CSP when object storage is disabled (local disk).
 * Returns null when CDN_URL is unset.
 */
export const resolveOptionalMediaCdnOrigin = (env: Environment): string | null => {
  const value = env('CDN_URL')?.trim();
  if (!value) {
    return null;
  }

  return resolveMediaCdnOrigin(env);
};

const resolveCredentials = (env: Environment): MediaStorageCredentials | null => {
  const accessKeyId = env('S3_ACCESS_KEY_ID')?.trim();
  const secretAccessKey = env('S3_ACCESS_SECRET')?.trim();

  if (!accessKeyId && !secretAccessKey) {
    return null;
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3_ACCESS_KEY_ID and S3_ACCESS_SECRET must be set together, or both omitted so the ambient credential chain is used.',
    );
  }

  return { accessKeyId, secretAccessKey };
};

const resolveEndpoint = (env: Environment): string | null => {
  const value = env('S3_ENDPOINT')?.trim();

  if (!value) {
    return null;
  }

  if (!parseAbsoluteUrl(value)) {
    throw new Error('S3_ENDPOINT must be an absolute http(s) URL issued by the storage vendor.');
  }

  return value;
};

const resolveRootPath = (env: Environment): string => {
  const rootPath = requireEnvValue(env, 'S3_ROOT_PATH');

  if (!rootPathPattern.test(rootPath)) {
    throw new Error(
      'S3_ROOT_PATH must be a stable lowercase prefix without a leading or trailing slash, for example uploads.',
    );
  }

  return rootPath;
};

const resolveObjectAcl = (env: Environment): MediaStorageBucketParams['ACL'] => {
  const value = env('S3_ACL')?.trim();

  if (!value) {
    return undefined;
  }

  if (value !== 'public-read') {
    throw new Error(
      'S3_ACL must be public-read or omitted. Private assets require a separate private-storage contract with signed URLs.',
    );
  }

  return value;
};

/**
 * Builds the aws-s3 upload provider configuration. Call only when
 * {@link isObjectStorageEnabled} is true.
 */
export const resolveMediaStorageConfig = (env: Environment): MediaStorageConfig => {
  const bucket = requireEnvValue(env, 'S3_BUCKET');
  const region = requireEnvValue(env, 'S3_REGION');
  const rootPath = resolveRootPath(env);
  const baseUrl = resolveMediaCdnOrigin(env);
  const credentials = resolveCredentials(env);
  const endpoint = resolveEndpoint(env);
  const forcePathStyle = env.bool('S3_FORCE_PATH_STYLE', false);
  const objectAcl = resolveObjectAcl(env);

  return {
    provider: 'aws-s3',
    providerOptions: {
      baseUrl,
      rootPath,
      s3Options: {
        region,
        ...(endpoint ? { endpoint } : {}),
        ...(forcePathStyle ? { forcePathStyle } : {}),
        ...(credentials ? { credentials } : {}),
        params: {
          Bucket: bucket,
          ACL: objectAcl,
        },
      },
    },
    actionOptions: {
      upload: {},
      uploadStream: {},
      delete: {},
    },
  };
};
