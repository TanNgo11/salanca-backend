/** Exact host that Google Maps `Share → Embed a map` produces. */
export const MAP_EMBED_ALLOWED_HOST = 'www.google.com';

export const MAP_EMBED_ALLOWED_PATH = '/maps/embed';

/** Hosts acceptable as an outbound "Open in Google Maps" / directions link. */
export const EXTERNAL_MAP_ALLOWED_HOSTS: readonly string[] = [
  'goo.gl',
  'maps.app.goo.gl',
  'maps.google.com',
  'www.google.com',
];

export const MAP_INPUT_MAX_RAW_LENGTH = 4_096;

export const MAP_URL_MAX_LENGTH = 2_048;

export enum MapUrlErrorCode {
  Invalid = 'MAP_URL_INVALID',
}

export class MapUrlError extends Error {
  readonly code: MapUrlErrorCode;

  constructor(code: MapUrlErrorCode, message: string) {
    super(message);
    this.name = 'MapUrlError';
    this.code = code;
  }
}
