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

/**
 * Declared byte size before any read: `sizeInBytes` when the plugin set it,
 * else Strapi's kilobyte `size`, else the temp file on disk. Returns undefined
 * only when none of the three is available (pure stream path).
 */
export const resolveDeclaredBytes = async (
  file: UploadWorkingFile,
  stat: (filepath: string) => Promise<{ size: number }> = fs.stat,
): Promise<number | undefined> => {
  if (typeof file.sizeInBytes === 'number' && Number.isFinite(file.sizeInBytes)) {
    return file.sizeInBytes;
  }

  if (typeof file.size === 'number' && Number.isFinite(file.size)) {
    return file.size * 1000;
  }

  if (typeof file.filepath === 'string' && file.filepath.length > 0) {
    try {
      return (await stat(file.filepath)).size;
    } catch {
      return undefined;
    }
  }

  return undefined;
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
        ),
        { correlationId, code: MediaProcessingErrorCode.ConfigInvalid },
      );
    }

    try {
      /*
       * Reject on the declared size before reading. Strapi's own sizeLimit
       * defaults to 200 MB, so without this a 200 MB upload is fully resident
       * in memory — times the upload concurrency — before processRaster's
       * byteLength check rejects it. That check stays as the backstop for the
       * stream path, where no size is declared up front.
       */
      const declaredBytes = await resolveDeclaredBytes(file);
      if (declaredBytes !== undefined && declaredBytes > runtime.config.maxInputBytes) {
        throw new MediaProcessingError(MediaProcessingErrorCode.InputTooLarge, correlationId, {
          bytes: declaredBytes,
          maxInputBytes: runtime.config.maxInputBytes,
        });
      }

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

      // The only place processingVersion is observable: no media record CT stores it (D3).
      runtime.logger?.info(
        `Media processed [${correlationId}] v${result.processingVersion}: `
          + `${result.source.format} ${result.source.width}x${result.source.height} `
          + `→ webp ${result.width}x${result.height} (${result.bytes} bytes)`,
      );

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
        throw new errors.ApplicationError(toEditorSafeMessage(error), {
          correlationId,
          code: error.code,
        });
      }
      throw error;
    }
  };
};

/** Stock Strapi upload settings, restored when our pipeline is switched off. */
const STOCK_UPLOAD_SETTINGS = {
  sizeOptimization: true,
  responsiveDimensions: true,
  autoOrientation: true,
} as const;

/** Our pipeline owns compression and orientation; keep Strapi's responsive formats. */
const MANAGED_UPLOAD_SETTINGS = {
  sizeOptimization: false,
  responsiveDimensions: true,
  autoOrientation: false,
} as const;

type PluginSettingsStore = {
  get: (params: Record<string, unknown>) => Promise<unknown>;
  set: (params: { value: unknown }) => Promise<unknown>;
};

/**
 * Writes the upload-plugin settings our pipeline requires, and restores the
 * stock values when it is disabled.
 *
 * Both directions are needed: writing only on enable left sizeOptimization
 * false in the database after MEDIA_PROCESSING_ENABLED was turned off, so stock
 * optimization stayed silently disabled. Every write is logged, because this
 * silently reverts operator changes made in the Media Library settings UI.
 */
export const enforceMediaProcessingUploadSettings = async (
  strapi: Core.Strapi,
  store?: PluginSettingsStore,
): Promise<void> => {
  const runtime = getOrCreateMediaProcessingRuntime(strapi);
  const desired = runtime.config.enabled ? MANAGED_UPLOAD_SETTINGS : STOCK_UPLOAD_SETTINGS;

  try {
    const pluginStore =
      store
      ?? (strapi.store({
        type: 'plugin',
        name: 'upload',
        key: 'settings',
      }) as unknown as PluginSettingsStore);
    const current = (await pluginStore.get({})) as Record<string, unknown> | null;

    const unchanged =
      current
      && Object.entries(desired).every(([key, value]) => current[key] === value);
    if (unchanged) {
      return;
    }

    await pluginStore.set({ value: { ...(current ?? {}), ...desired } });
    strapi.log.info(
      `Upload settings set to ${runtime.config.enabled ? 'media-processing' : 'stock Strapi'} `
        + `values: ${JSON.stringify(desired)}.`,
    );
  } catch (error) {
    strapi.log.warn(
      `Could not enforce upload settings for media processing: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
};
