import { createHash } from 'node:crypto';

import sharp, { type Metadata } from 'sharp';

import { AsyncSemaphore } from './concurrency';
import type { MediaProcessingConfig, ProcessRasterInput, ProcessRasterResult } from './types';
import { MediaProcessingError, MediaProcessingErrorCode } from './errors';

const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff', 'avif']);

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

/**
 * Races a timer against `promise` and surfaces Timeout to the editor.
 *
 * A timeout cannot cancel sharp, which keeps burning CPU and memory after the
 * race is lost. `settled` therefore exposes the underlying work so the caller
 * can hold its concurrency slot until sharp actually finishes — otherwise
 * MEDIA_PROCESSING_CONCURRENCY stops bounding real concurrency at exactly the
 * moment it matters.
 */
const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  correlationId: string,
): { raced: Promise<T>; settled: Promise<unknown> } => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new MediaProcessingError(MediaProcessingErrorCode.Timeout, correlationId));
    }, timeoutMs);
  });

  const settled = promise.catch(() => undefined);
  const raced = Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });

  return { raced, settled };
};

const mimeForFormat = (format: string): string => {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'tiff':
      return 'image/tiff';
    case 'avif':
      return 'image/avif';
    default:
      return `image/${format}`;
  }
};

type InspectedSource = {
  format: string;
  height: number;
  width: number;
};

/**
 * Reject animation, vectors, unknown codecs and pixel bombs before any
 * transform. Runs inside the timeout: metadata() decodes enough of a hostile
 * file to be slow on its own.
 */
const inspectSource = async (
  buffer: Buffer,
  config: MediaProcessingConfig,
  correlationId: string,
): Promise<InspectedSource> => {
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { animated: true, failOn: 'error' }).metadata();
  } catch {
    throw new MediaProcessingError(MediaProcessingErrorCode.InvalidSignature, correlationId);
  }

  const format = metadata.format;
  if (!format) {
    throw new MediaProcessingError(MediaProcessingErrorCode.InvalidSignature, correlationId);
  }

  if (format === 'gif' || (metadata.pages !== undefined && metadata.pages > 1)) {
    throw new MediaProcessingError(MediaProcessingErrorCode.AnimationRejected, correlationId, {
      format,
      pages: metadata.pages,
    });
  }

  if (format === 'svg' || !RASTER_FORMATS.has(format)) {
    throw new MediaProcessingError(MediaProcessingErrorCode.UnsupportedCodec, correlationId, {
      format,
    });
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new MediaProcessingError(MediaProcessingErrorCode.InvalidSignature, correlationId);
  }

  if (width * height > config.maxPixels) {
    throw new MediaProcessingError(MediaProcessingErrorCode.PixelLimit, correlationId, {
      width,
      height,
      maxPixels: config.maxPixels,
    });
  }

  return { format, height, width };
};

/** orient → sRGB → edge cap → WebP. */
const transformToWebp = async (
  buffer: Buffer,
  source: InspectedSource,
  config: MediaProcessingConfig,
): Promise<ProcessRasterResult> => {
  const { format, height, width } = source;

  let pipeline = sharp(buffer, { failOn: 'error', animated: false })
    .rotate()
    .toColorspace('srgb');

  const longest = Math.max(width, height);
  if (longest > config.maxEdgePx) {
    pipeline = pipeline.resize({
      width: width >= height ? config.maxEdgePx : undefined,
      height: height > width ? config.maxEdgePx : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const working = await pipeline.toBuffer({ resolveWithObject: true });
  const output = await sharp(working.data)
    .webp({ quality: config.webpQuality, alphaQuality: config.webpQuality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    bytes: output.data.byteLength,
    checksumSha256: sha256(output.data),
    height: output.info.height,
    mime: 'image/webp',
    processingVersion: config.processingVersion,
    source: {
      bytes: buffer.byteLength,
      checksumSha256: sha256(buffer),
      format,
      height,
      mime: mimeForFormat(format),
      width,
    },
    width: output.info.width,
  };
};

export type MediaProcessor = Readonly<{
  processRaster: (input: ProcessRasterInput) => Promise<ProcessRasterResult>;
}>;

/**
 * Editorial-clean only: orient → sRGB → edge cap → WebP (no watermark).
 */
export const createMediaProcessor = (config: MediaProcessingConfig): MediaProcessor => {
  const semaphore = new AsyncSemaphore(config.concurrency);

  const processRaster = async (input: ProcessRasterInput): Promise<ProcessRasterResult> =>
    semaphore.run(async () => {
      const { buffer, correlationId } = input;

      if (buffer.byteLength <= 0 || buffer.byteLength > config.maxInputBytes) {
        throw new MediaProcessingError(MediaProcessingErrorCode.InputTooLarge, correlationId, {
          bytes: buffer.byteLength,
          maxInputBytes: config.maxInputBytes,
        });
      }

      const work = (async () => {
        const source = await inspectSource(buffer, config, correlationId);
        return transformToWebp(buffer, source, config);
      })();

      const { raced, settled } = withTimeout(work, config.timeoutMs, correlationId);

      try {
        return await raced;
      } catch (error) {
        if (error instanceof MediaProcessingError) {
          throw error;
        }
        throw new MediaProcessingError(MediaProcessingErrorCode.TransformFailed, correlationId, {
          cause: error instanceof Error ? error.message : 'unknown',
        });
      } finally {
        // Keep the slot until sharp really finishes, timeout or not.
        await settled;
      }
    });

  return { processRaster };
};
