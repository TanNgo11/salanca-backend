import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { resolveMediaProcessingConfig } from './config';
import { MediaProcessingError, MediaProcessingErrorCode } from './errors';
import { createMediaProcessor } from './processor';
import { bytesToKbytes } from './upload-optimize';

const createEnv = (values: Record<string, string | undefined> = {}) => {
  const env = ((key: string, defaultValue?: string) =>
    values[key] ?? defaultValue) as ((key: string, defaultValue?: string) => string | undefined) & {
    int: (key: string, defaultValue: number) => number;
    bool: (key: string, defaultValue: boolean) => boolean;
  };

  env.int = (key: string, defaultValue: number) => {
    const raw = values[key];
    if (raw === undefined) {
      return defaultValue;
    }
    return Number.parseInt(raw, 10);
  };

  env.bool = (key: string, defaultValue: boolean) => {
    const raw = values[key];
    if (raw === undefined) {
      return defaultValue;
    }
    return raw === 'true';
  };

  return env;
};

describe('createMediaProcessor', () => {
  it('converts a small PNG to WebP', async () => {
    const config = resolveMediaProcessingConfig(
      createEnv({ MEDIA_PROCESSING_ENABLED: 'true' }),
    );
    const processor = createMediaProcessor(config);
    const png = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const result = await processor.processRaster({
      buffer: png,
      correlationId: 'test-1',
    });

    expect(result.mime).toBe('image/webp');
    expect(result.width).toBe(32);
    expect(result.height).toBe(24);
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it('rejects oversized input', async () => {
    const config = resolveMediaProcessingConfig(
      createEnv({
        MEDIA_PROCESSING_ENABLED: 'true',
        MEDIA_PROCESSING_MAX_INPUT_BYTES: '10',
      }),
    );
    const processor = createMediaProcessor(config);

    try {
      await processor.processRaster({
        buffer: Buffer.alloc(20),
        correlationId: 'test-2',
      });
      expect.unreachable('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaProcessingError);
      expect((error as MediaProcessingError).code).toBe(
        MediaProcessingErrorCode.InputTooLarge,
      );
    }
  });
});

describe('resolveMediaProcessingConfig', () => {
  it('defaults to disabled', () => {
    expect(resolveMediaProcessingConfig(createEnv()).enabled).toBe(false);
  });
});

describe('bytesToKbytes', () => {
  /*
   * Static import on purpose: loading upload-optimize pulls in the whole
   * @strapi/strapi graph, which took ~3s and intermittently blew the 5s test
   * timeout when the dynamic import happened inside the test body.
   */
  it('matches Strapi Media Library kilobyte rounding', () => {
    expect(bytesToKbytes(1500)).toBe(1.5);
    expect(bytesToKbytes(1000)).toBe(1);
    expect(bytesToKbytes(500)).toBe(0.5);
  });
});
