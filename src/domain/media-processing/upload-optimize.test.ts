import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Core } from '@strapi/strapi';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveMediaProcessingConfig } from './config';
import { MediaProcessingErrorCode } from './errors';
import { createMediaProcessor } from './processor';
import type { MediaProcessingEnvReader } from './types';
import type { MediaProcessingRuntime } from './runtime';
import {
  createMediaProcessingOptimize,
  enforceMediaProcessingUploadSettings,
  resolveDeclaredBytes,
} from './upload-optimize';
import type { UploadWorkingFile } from './upload-types';

const createEnv = (values: Record<string, string | undefined> = {}) => {
  const env = ((key: string, defaultValue?: string) =>
    values[key] ?? defaultValue) as MediaProcessingEnvReader;

  env.int = (key: string, defaultValue: number) =>
    values[key] === undefined ? defaultValue : Number.parseInt(values[key] as string, 10);
  env.bool = (key: string, defaultValue: boolean) =>
    values[key] === undefined ? defaultValue : values[key] === 'true';

  return env;
};

const createRuntime = (values: Record<string, string | undefined>): MediaProcessingRuntime => {
  const config = resolveMediaProcessingConfig(createEnv(values));
  return { config, processor: createMediaProcessor(config), logger: { info: vi.fn(), warn: vi.fn() } };
};

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'salanca-media-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('createMediaProcessingOptimize', () => {
  it('delegates to the original optimize when disabled', async () => {
    const original = vi.fn(async (file: UploadWorkingFile) => ({ ...file, touched: true }));
    const optimize = createMediaProcessingOptimize(original, createRuntime({}));

    const result = await optimize({ name: 'a.png' });

    expect(original).toHaveBeenCalledTimes(1);
    expect(result.touched).toBe(true);
  });

  it('rewrites ext, mime, name and size when enabled', async () => {
    const tmpDir = await makeTempDir();
    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const filepath = path.join(tmpDir, 'source.png');
    await fs.writeFile(filepath, png);

    const original = vi.fn(async (file: UploadWorkingFile) => file);
    const optimize = createMediaProcessingOptimize(
      original,
      createRuntime({ MEDIA_PROCESSING_ENABLED: 'true' }),
    );

    const result = await optimize({
      ext: '.png',
      filepath,
      hash: 'hash_abc',
      mime: 'image/png',
      name: 'source.png',
      tmpWorkingDirectory: tmpDir,
    });

    expect(original).not.toHaveBeenCalled();
    expect(result.ext).toBe('.webp');
    expect(result.mime).toBe('image/webp');
    expect(result.name).toBe('source.webp');
    expect(result.width).toBe(40);
    expect(result.size).toBe(Math.round(((result.sizeInBytes as number) / 1000) * 100) / 100);
    await expect(fs.stat(result.filepath as string)).resolves.toBeTruthy();
  });

  it('resizes down to maxEdgePx', async () => {
    const tmpDir = await makeTempDir();
    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();
    const filepath = path.join(tmpDir, 'big.png');
    await fs.writeFile(filepath, png);

    const optimize = createMediaProcessingOptimize(
      vi.fn(async (file: UploadWorkingFile) => file),
      createRuntime({ MEDIA_PROCESSING_ENABLED: 'true', MEDIA_PROCESSING_MAX_EDGE: '50' }),
    );

    const result = await optimize({
      filepath,
      hash: 'hash_big',
      name: 'big.png',
      tmpWorkingDirectory: tmpDir,
    });

    expect(result.width).toBe(50);
    expect(result.height).toBe(25);
  });

  it('rejects an oversized upload from its declared size, without reading it', async () => {
    const tmpDir = await makeTempDir();
    const filepath = path.join(tmpDir, 'huge.png');
    // Deliberately never written: rejection must happen before the read.
    const optimize = createMediaProcessingOptimize(
      vi.fn(async (file: UploadWorkingFile) => file),
      createRuntime({ MEDIA_PROCESSING_ENABLED: 'true', MEDIA_PROCESSING_MAX_INPUT_BYTES: '1024' }),
    );

    await expect(
      optimize({
        filepath,
        name: 'huge.png',
        sizeInBytes: 200 * 1024 * 1024,
        tmpWorkingDirectory: tmpDir,
      }),
    ).rejects.toMatchObject({ details: { code: MediaProcessingErrorCode.InputTooLarge } });
  });

  it('fails with a config error when no tmp working directory is available', async () => {
    const optimize = createMediaProcessingOptimize(
      vi.fn(async (file: UploadWorkingFile) => file),
      createRuntime({ MEDIA_PROCESSING_ENABLED: 'true' }),
    );

    await expect(optimize({ name: 'a.png' })).rejects.toMatchObject({
      details: { code: MediaProcessingErrorCode.ConfigInvalid },
    });
  });
});

describe('resolveDeclaredBytes', () => {
  it('prefers sizeInBytes, then kilobyte size, then the file on disk', async () => {
    const stat = vi.fn(async () => ({ size: 4242 }));

    await expect(resolveDeclaredBytes({ sizeInBytes: 10, size: 99 }, stat)).resolves.toBe(10);
    await expect(resolveDeclaredBytes({ size: 2 }, stat)).resolves.toBe(2000);
    await expect(resolveDeclaredBytes({ filepath: '/tmp/x' }, stat)).resolves.toBe(4242);
    await expect(resolveDeclaredBytes({}, stat)).resolves.toBeUndefined();
  });

  it('returns undefined when the file cannot be stat-ed', async () => {
    const stat = vi.fn(async () => {
      throw new Error('ENOENT');
    });

    await expect(resolveDeclaredBytes({ filepath: '/tmp/missing' }, stat)).resolves.toBeUndefined();
  });
});

describe('enforceMediaProcessingUploadSettings', () => {
  const createStrapi = () =>
    ({ log: { info: vi.fn(), warn: vi.fn() } }) as unknown as Core.Strapi & {
      log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
    };

  const createStore = (initial: Record<string, unknown>) => {
    let value = initial;
    return {
      get: vi.fn(async () => value),
      set: vi.fn(async ({ value: next }: { value: unknown }) => {
        value = next as Record<string, unknown>;
        return next;
      }),
      current: () => value,
    };
  };

  it('restores stock settings when media processing is disabled', async () => {
    delete process.env.MEDIA_PROCESSING_ENABLED;
    const strapi = createStrapi();
    const store = createStore({
      sizeOptimization: false,
      autoOrientation: false,
      responsiveDimensions: false,
    });

    await enforceMediaProcessingUploadSettings(strapi, store);

    expect(store.current()).toMatchObject({
      sizeOptimization: true,
      autoOrientation: true,
      // Not ours to own: an operator's responsive-formats choice must survive.
      responsiveDimensions: false,
    });
    expect(strapi.log.info).toHaveBeenCalledTimes(1);
  });

  it('writes the managed settings when media processing is enabled', async () => {
    process.env.MEDIA_PROCESSING_ENABLED = 'true';
    const strapi = createStrapi();
    const store = createStore({
      sizeOptimization: true,
      autoOrientation: true,
      responsiveDimensions: false,
    });

    try {
      await enforceMediaProcessingUploadSettings(strapi, store);
    } finally {
      delete process.env.MEDIA_PROCESSING_ENABLED;
    }

    expect(store.current()).toMatchObject({
      sizeOptimization: false,
      autoOrientation: false,
      responsiveDimensions: false,
    });
  });

  it('does not write when the two managed keys already match', async () => {
    delete process.env.MEDIA_PROCESSING_ENABLED;
    const strapi = createStrapi();
    const store = createStore({
      sizeOptimization: true,
      autoOrientation: true,
      // Would have forced a pointless write back to true before the fix.
      responsiveDimensions: false,
    });

    await enforceMediaProcessingUploadSettings(strapi, store);

    expect(store.set).not.toHaveBeenCalled();
  });
});
