import type { MediaProcessingConfig, MediaProcessingEnvReader } from './types';
import { MediaProcessingError, MediaProcessingErrorCode } from './errors';

const requirePositiveInt = (
  value: number,
  key: string,
  correlationId: string,
): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MediaProcessingError(MediaProcessingErrorCode.ConfigInvalid, correlationId, {
      key,
      value,
    });
  }

  return value;
};

/**
 * Parse media-processing settings. Default disabled so local disk boot stays simple.
 */
export const resolveMediaProcessingConfig = (
  env: MediaProcessingEnvReader,
  correlationId = 'startup',
): MediaProcessingConfig => {
  const enabled = env.bool('MEDIA_PROCESSING_ENABLED', false);
  const maxEdgePx = requirePositiveInt(
    env.int('MEDIA_PROCESSING_MAX_EDGE', 2560),
    'MEDIA_PROCESSING_MAX_EDGE',
    correlationId,
  );
  const webpQuality = env.int('MEDIA_PROCESSING_WEBP_QUALITY', 80);
  if (!Number.isInteger(webpQuality) || webpQuality < 1 || webpQuality > 100) {
    throw new MediaProcessingError(MediaProcessingErrorCode.ConfigInvalid, correlationId, {
      key: 'MEDIA_PROCESSING_WEBP_QUALITY',
      value: webpQuality,
    });
  }

  return {
    enabled,
    maxEdgePx,
    webpQuality,
    maxInputBytes: requirePositiveInt(
      env.int('MEDIA_PROCESSING_MAX_INPUT_BYTES', 15 * 1024 * 1024),
      'MEDIA_PROCESSING_MAX_INPUT_BYTES',
      correlationId,
    ),
    maxPixels: requirePositiveInt(
      env.int('MEDIA_PROCESSING_MAX_PIXELS', 40_000_000),
      'MEDIA_PROCESSING_MAX_PIXELS',
      correlationId,
    ),
    timeoutMs: requirePositiveInt(
      env.int('MEDIA_PROCESSING_TIMEOUT_MS', 30_000),
      'MEDIA_PROCESSING_TIMEOUT_MS',
      correlationId,
    ),
    concurrency: requirePositiveInt(
      env.int('MEDIA_PROCESSING_CONCURRENCY', 2),
      'MEDIA_PROCESSING_CONCURRENCY',
      correlationId,
    ),
    processingVersion: requirePositiveInt(
      env.int('MEDIA_PROCESSING_VERSION', 1),
      'MEDIA_PROCESSING_VERSION',
      correlationId,
    ),
  };
};
