import type { Core } from '@strapi/strapi';

const apiPrefixPattern = /^\/[a-z0-9]+(?:\/[a-z0-9-]+)*$/;

export const resolveRestApiPrefix = (
  env: Core.Config.Shared.ConfigParams['env'],
): string => {
  const prefix = env('API_REST_PREFIX', '/api/v1');

  if (!prefix || !apiPrefixPattern.test(prefix)) {
    throw new Error(
      'API_REST_PREFIX must start with / and contain lowercase path segments without a trailing slash.',
    );
  }

  return prefix;
};
