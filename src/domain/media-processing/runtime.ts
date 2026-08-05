import type { Core } from '@strapi/strapi';

import { resolveMediaProcessingConfig } from './config';
import { createMediaProcessor, type MediaProcessor } from './processor';
import type { MediaProcessingConfig } from './types';

export type MediaProcessingRuntime = Readonly<{
  config: MediaProcessingConfig;
  processor: MediaProcessor;
}>;

type EnvReader = {
  (key: string, defaultValue?: string): string | undefined;
  int: (key: string, defaultValue: number) => number;
  bool: (key: string, defaultValue: boolean) => boolean;
};

const runtimeByStrapi = new WeakMap<Core.Strapi, MediaProcessingRuntime>();

const readProcessEnv = (): EnvReader => {
  const env = process.env;

  const reader = ((key: string, defaultValue?: string): string | undefined => {
    const value = env[key];
    return value === undefined || value === '' ? defaultValue : value;
  }) as EnvReader;

  reader.int = (key: string, defaultValue: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') {
      return defaultValue;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  };

  reader.bool = (key: string, defaultValue: boolean): boolean => {
    const raw = env[key];
    if (raw === undefined || raw === '') {
      return defaultValue;
    }
    if (raw === 'true' || raw === '1') {
      return true;
    }
    if (raw === 'false' || raw === '0') {
      return false;
    }
    return defaultValue;
  };

  return reader;
};

export const getOrCreateMediaProcessingRuntime = (
  strapi: Core.Strapi,
): MediaProcessingRuntime => {
  const existing = runtimeByStrapi.get(strapi);
  if (existing) {
    return existing;
  }

  const config = resolveMediaProcessingConfig(readProcessEnv());
  const runtime: MediaProcessingRuntime = {
    config,
    processor: createMediaProcessor(config),
  };
  runtimeByStrapi.set(strapi, runtime);
  return runtime;
};
