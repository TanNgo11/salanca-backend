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
