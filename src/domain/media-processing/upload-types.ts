import type { Readable } from 'node:stream';

export type UploadWorkingFile = {
  ext?: string;
  filepath?: string;
  getStream?: () => Readable;
  hash?: string;
  height?: number;
  mime?: string;
  name?: string;
  path?: string;
  size?: number;
  tmpWorkingDirectory?: string;
  width?: number;
} & Record<string, unknown>;

export type OptimizeFn = (file: UploadWorkingFile) => Promise<UploadWorkingFile>;
