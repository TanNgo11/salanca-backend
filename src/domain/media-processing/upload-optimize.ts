import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import {
  MediaProcessingError,
  MediaProcessingErrorCode,
  toEditorSafeMessage,
} from './errors';
import { getOrCreateMediaProcessingRuntime } from './runtime';
import type { MediaProcessingRuntime } from './runtime';
import type { OptimizeFn, UploadWorkingFile } from './upload-types';

export type { OptimizeFn, UploadWorkingFile } from './upload-types';

/** Strapi Media Library `size` is kilobytes, not bytes. */
export const bytesToKbytes = (bytes: number): number =>
  Math.round((bytes / 1000) * 100) / 100;

const replaceExtension = (filename: string, nextExt: string): string => {
  const base = filename.includes('.')
    ? filename.slice(0, filename.lastIndexOf('.'))
    : filename;
  return `${base}${nextExt.startsWith('.') ? nextExt : `.${nextExt}`}`;
};

const readWorkingFileBuffer = async (file: UploadWorkingFile): Promise<Buffer> => {
  if (file.filepath) {
    return fs.readFile(file.filepath);
  }

  if (typeof file.getStream === 'function') {
    const stream = file.getStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new MediaProcessingError(MediaProcessingErrorCode.InvalidSignature, 'missing-source');
};

/**
 * When MEDIA_PROCESSING_ENABLED=true, replace stock optimize with editorial WebP.
 * When disabled, delegates to Strapi's original optimize.
 */
export const createMediaProcessingOptimize = (
  originalOptimize: OptimizeFn,
  runtime: MediaProcessingRuntime,
): OptimizeFn => {
  return async (file: UploadWorkingFile): Promise<UploadWorkingFile> => {
    if (!runtime.config.enabled) {
      return originalOptimize(file);
    }

    const correlationId = randomUUID();
    const tmpDir = file.tmpWorkingDirectory;

    if (typeof tmpDir !== 'string' || tmpDir.trim().length === 0) {
      throw new errors.ApplicationError(
        toEditorSafeMessage(
          new MediaProcessingError(MediaProcessingErrorCode.ConfigInvalid, correlationId, {
            reason: 'missing_tmp_working_directory',
          }),
          correlationId,
        ),
        { correlationId, code: MediaProcessingErrorCode.ConfigInvalid },
      );
    }

    try {
      const sourceBuffer = await readWorkingFileBuffer(file);
      const result = await runtime.processor.processRaster({
        buffer: sourceBuffer,
        correlationId,
        sourceFilename: typeof file.name === 'string' ? file.name : undefined,
      });

      const workingHash =
        typeof file.hash === 'string' && file.hash.length > 0
          ? file.hash
          : result.checksumSha256;
      const outName = `${workingHash}.webp`;
      const outPath = path.join(tmpDir, outName);
      await fs.writeFile(outPath, result.buffer);

      const nextName =
        typeof file.name === 'string' ? replaceExtension(file.name, '.webp') : outName;

      return {
        ...file,
        ext: '.webp',
        filepath: outPath,
        getStream: () => createReadStream(outPath),
        hash: workingHash,
        height: result.height,
        mime: result.mime,
        name: nextName,
        size: bytesToKbytes(result.bytes),
        sizeInBytes: result.bytes,
        width: result.width,
      };
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        throw new errors.ApplicationError(toEditorSafeMessage(error, correlationId), {
          correlationId,
          code: error.code,
        });
      }
      throw error;
    }
  };
};

/**
 * Prefer Strapi responsive formats; turn off sizeOptimization when our pipeline owns compression.
 */
export const enforceMediaProcessingUploadSettings = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const runtime = getOrCreateMediaProcessingRuntime(strapi);
  if (!runtime.config.enabled) {
    return;
  }

  try {
    const pluginStore = strapi.store({ type: 'plugin', name: 'upload', key: 'settings' });
    const current = (await pluginStore.get({})) as Record<string, unknown> | null;
    await pluginStore.set({
      value: {
        ...(current ?? {}),
        sizeOptimization: false,
        responsiveDimensions: true,
        autoOrientation: false,
      },
    });
  } catch (error) {
    strapi.log.warn(
      `Could not enforce upload settings for media processing: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
};
