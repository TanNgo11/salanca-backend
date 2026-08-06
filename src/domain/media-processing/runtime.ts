import type { Core } from '@strapi/strapi';
import { env } from '@strapi/utils';

import { resolveMediaProcessingConfig } from './config';
import { createMediaProcessor, type MediaProcessor } from './processor';
import type { MediaProcessingConfig, MediaProcessingLogger } from './types';

export type MediaProcessingRuntime = Readonly<{
  config: MediaProcessingConfig;
  logger?: MediaProcessingLogger;
  processor: MediaProcessor;
}>;

const runtimeByStrapi = new WeakMap<Core.Strapi, MediaProcessingRuntime>();

/**
 * One runtime per Strapi instance. The env reader is Strapi's own
 * (`@strapi/utils`), not a private process.env wrapper: this is constructed
 * lazily at request time, so `config/env.helper.ts` — which needs the injected
 * `ConfigParams['env']` callable — does not apply here.
 */
export const getOrCreateMediaProcessingRuntime = (
  strapi: Core.Strapi,
): MediaProcessingRuntime => {
  const existing = runtimeByStrapi.get(strapi);
  if (existing) {
    return existing;
  }

  const config = resolveMediaProcessingConfig(env);
  const runtime: MediaProcessingRuntime = {
    config,
    logger: strapi.log,
    processor: createMediaProcessor(config),
  };
  runtimeByStrapi.set(strapi, runtime);
  return runtime;
};
