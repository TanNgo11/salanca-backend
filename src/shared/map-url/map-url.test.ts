import { describe, expect, it } from 'vitest';

import { normalizeOptionalMapUrl } from './map-url';
import { MapUrlError, MapUrlErrorCode } from './map-url.types';

const EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3919';

const COPIED_IFRAME =
  `<iframe src="${EMBED_URL}" width="600" height="450" style="border:0;" ` +
  'allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';

const SHARE_URL =
  'https://www.google.com/maps?q=49+Phan+B%E1%BB%99i+Ch%C3%A2u,+Hanoi,+Vietnam';

const expectInvalid = (input: unknown): void => {
  try {
    normalizeOptionalMapUrl(input);
    expect.unreachable('expected MapUrlError');
  } catch (error) {
    expect(error).toBeInstanceOf(MapUrlError);
    expect((error as MapUrlError).code).toBe(MapUrlErrorCode.Invalid);
  }
};

describe('normalizeOptionalMapUrl', () => {
  it('treats empty as null', () => {
    expect(normalizeOptionalMapUrl(null)).toBeNull();
    expect(normalizeOptionalMapUrl('')).toBeNull();
    expect(normalizeOptionalMapUrl('   ')).toBeNull();
  });

  it('accepts a maps share URL used by Salanca seed', () => {
    expect(normalizeOptionalMapUrl(SHARE_URL)).toBe(SHARE_URL);
  });

  it('accepts a direct embed URL', () => {
    expect(normalizeOptionalMapUrl(EMBED_URL)).toBe(EMBED_URL);
  });

  it('extracts src from a copied iframe and never returns HTML', () => {
    const normalized = normalizeOptionalMapUrl(COPIED_IFRAME);
    expect(normalized).toBe(EMBED_URL);
    expect(normalized).not.toContain('<');
  });

  it('rejects event handlers on iframe', () => {
    expectInvalid(`<iframe src="${EMBED_URL}" onload="alert(1)"></iframe>`);
  });

  it('rejects non-maps hosts', () => {
    expectInvalid('https://example.com/maps');
  });

  it('rejects non-string values', () => {
    expectInvalid({ src: EMBED_URL });
  });
});
