import { describe, expect, it } from 'vitest';

import {
  normalizeSocialLinksInPlace,
  SocialUrlError,
  SocialUrlErrorCode,
} from './social-url';

const expectCode = (fn: () => unknown, code: SocialUrlErrorCode): void => {
  try {
    fn();
    expect.unreachable('expected SocialUrlError');
  } catch (error) {
    expect(error).toBeInstanceOf(SocialUrlError);
    expect((error as SocialUrlError).code).toBe(code);
  }
};

describe('normalizeSocialLinksInPlace', () => {
  it('is a no-op when socialLinks is absent', () => {
    const data: Record<string, unknown> = { brandName: 'Salanca' };
    normalizeSocialLinksInPlace(data);
    expect(data).toEqual({ brandName: 'Salanca' });
  });

  it('rewrites platform and url on existing entries and keeps label', () => {
    const data: Record<string, unknown> = {
      socialLinks: [
        {
          platform: 'facebook',
          label: 'Facebook',
          url: 'https://www.facebook.com/Salancarest/',
          id: 9,
        },
      ],
    };

    normalizeSocialLinksInPlace(data);

    const entry = (data.socialLinks as Record<string, unknown>[])[0];
    expect(entry).toMatchObject({
      platform: 'facebook',
      label: 'Facebook',
      url: 'https://www.facebook.com/Salancarest/',
      id: 9,
    });
  });

  it('rejects wrong host for a platform', () => {
    expectCode(
      () =>
        normalizeSocialLinksInPlace({
          socialLinks: [
            { platform: 'instagram', url: 'https://www.facebook.com/x' },
          ],
        }),
      SocialUrlErrorCode.InvalidHost,
    );
  });

  it('allows any HTTPS host for other', () => {
    const data: Record<string, unknown> = {
      socialLinks: [{ platform: 'other', url: 'https://example.com/salanca' }],
    };
    normalizeSocialLinksInPlace(data);
    expect((data.socialLinks as { url: string }[])[0].url).toBe(
      'https://example.com/salanca',
    );
  });

  it('rejects http', () => {
    expectCode(
      () =>
        normalizeSocialLinksInPlace({
          socialLinks: [{ platform: 'other', url: 'http://example.com' }],
        }),
      SocialUrlErrorCode.InvalidUrl,
    );
  });
});
