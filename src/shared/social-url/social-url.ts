/**
 * Platform hostname policy for `shared.social-link`.
 * Mutates entries in place; never throws Strapi errors.
 */

import { isPlainRecord } from '../normalization/value';

export enum SocialPlatform {
  Facebook = 'facebook',
  Instagram = 'instagram',
  Tiktok = 'tiktok',
  Youtube = 'youtube',
  Other = 'other',
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = Object.values(SocialPlatform);

const PLATFORM_HOSTS: Readonly<Record<SocialPlatform, readonly string[] | null>> = {
  [SocialPlatform.Facebook]: [
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'fb.com',
    'www.fb.com',
  ],
  [SocialPlatform.Instagram]: ['instagram.com', 'www.instagram.com'],
  [SocialPlatform.Tiktok]: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
  [SocialPlatform.Youtube]: [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
  ],
  [SocialPlatform.Other]: null,
};

export const SOCIAL_URL_MAX_LENGTH = 500;

export enum SocialUrlErrorCode {
  InvalidPlatform = 'SOCIAL_INVALID_PLATFORM',
  InvalidUrl = 'SOCIAL_INVALID_URL',
  InvalidHost = 'SOCIAL_INVALID_HOST',
}

export class SocialUrlError extends Error {
  readonly code: SocialUrlErrorCode;

  constructor(code: SocialUrlErrorCode, message: string) {
    super(message);
    this.name = 'SocialUrlError';
    this.code = code;
  }
}

const REDIRECT_PARAMETER_NAMES = ['url', 'redirect', 'target', 'destination'];

const parsePlatform = (value: unknown): SocialPlatform => {
  if (
    typeof value === 'string' &&
    (SOCIAL_PLATFORMS as readonly string[]).includes(value.trim().toLowerCase())
  ) {
    return value.trim().toLowerCase() as SocialPlatform;
  }

  throw new SocialUrlError(
    SocialUrlErrorCode.InvalidPlatform,
    `Nền tảng mạng xã hội "${String(value)}" không nằm trong danh sách cho phép.`,
  );
};

const parseHttpsSocialUrl = (raw: unknown, platform: SocialPlatform): string => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new SocialUrlError(SocialUrlErrorCode.InvalidUrl, 'URL mạng xã hội là bắt buộc.');
  }

  const url = raw.trim();
  if (url.length > SOCIAL_URL_MAX_LENGTH) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      `URL mạng xã hội vượt quá ${SOCIAL_URL_MAX_LENGTH} ký tự.`,
    );
  }

  if (/\s/.test(url)) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội không được chứa khoảng trắng.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội phải là một URL HTTPS hợp lệ.',
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội phải dùng HTTPS.',
    );
  }

  if (parsed.username || parsed.password) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội không được chứa thông tin đăng nhập.',
    );
  }

  if (parsed.hash) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội không được chứa fragment (#).',
    );
  }

  if (REDIRECT_PARAMETER_NAMES.some((name) => parsed.searchParams.has(name))) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidUrl,
      'URL mạng xã hội không được chứa tham số chuyển hướng.',
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed = PLATFORM_HOSTS[platform];
  if (allowed && !allowed.includes(hostname)) {
    throw new SocialUrlError(
      SocialUrlErrorCode.InvalidHost,
      `URL mạng xã hội phải dùng hostname được duyệt cho ${platform} (nhận ${hostname}).`,
    );
  }

  return parsed.toString();
};

/**
 * Validates and rewrites `platform` / `url` on each social-link entry in place.
 * No-op when the field is absent. Empty array is allowed.
 */
export const normalizeSocialLinksInPlace = (data: Record<string, unknown>): void => {
  if (!('socialLinks' in data)) {
    return;
  }

  const value = data.socialLinks;
  if (value === null) {
    data.socialLinks = [];
    return;
  }

  if (!Array.isArray(value)) {
    throw new SocialUrlError(SocialUrlErrorCode.InvalidUrl, 'socialLinks phải là mảng.');
  }

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!isPlainRecord(raw)) {
      throw new SocialUrlError(
        SocialUrlErrorCode.InvalidUrl,
        `socialLinks[${index}] phải là object.`,
      );
    }

    const platform = parsePlatform(raw.platform);
    const url = parseHttpsSocialUrl(raw.url, platform);
    raw.platform = platform;
    raw.url = url;
  }
};
