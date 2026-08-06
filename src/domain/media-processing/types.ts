/**
 * Structural shape of Strapi's `env` reader (`@strapi/utils`), narrowed to what
 * media processing needs so tests can inject a fake.
 */
export type MediaProcessingEnvReader = {
  (key: string, defaultValue?: string): string | undefined;
  int: (key: string, defaultValue: number) => number;
  bool: (key: string, defaultValue: boolean) => boolean;
};

/** Structural subset of `strapi.log`. */
export type MediaProcessingLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type MediaProcessingConfig = Readonly<{
  concurrency: number;
  enabled: boolean;
  maxEdgePx: number;
  maxInputBytes: number;
  maxPixels: number;
  processingVersion: number;
  timeoutMs: number;
  webpQuality: number;
}>;

export type ProcessRasterInput = Readonly<{
  buffer: Buffer;
  correlationId: string;
  sourceFilename?: string;
}>;

export type ProcessRasterResult = Readonly<{
  buffer: Buffer;
  bytes: number;
  checksumSha256: string;
  height: number;
  mime: 'image/webp';
  processingVersion: number;
  source: Readonly<{
    bytes: number;
    checksumSha256: string;
    format: string;
    height: number;
    mime: string;
    width: number;
  }>;
  width: number;
}>;
