/** Pure helpers for scripts/seed-experience-update.mjs (tested without Strapi). */

export const EXPERIENCE_UID = 'api::experience-page.experience-page';
export const PACKAGE_UID = 'api::menu-package.menu-package';
export const HEADER_UID = 'api::header-setting.header-setting';

/** Header submenu entries for the unpublished Desserts category. */
const RETIRED_MENU_LINK = /(^|\/|#)(trang-mieng|desserts)$/;

export function isRetiredMenuLink(link) {
  return typeof link?.url === 'string' && RETIRED_MENU_LINK.test(link.url.trim());
}

/** Drops the Desserts links; returns null when nothing changes. */
export function withoutRetiredMenuLinks(links) {
  if (!Array.isArray(links)) return null;
  const kept = links.filter(link => !isRetiredMenuLink(link));
  return kept.length === links.length ? null : kept;
}

/** Keeps the first of each repeated title; returns null when nothing changes. */
export function withoutDuplicateTitles(items) {
  if (!Array.isArray(items)) return null;
  const seen = new Set();
  const kept = items.filter(item => {
    const key = String(item?.title ?? '').trim().toUpperCase();
    if (key === '' || !seen.has(key)) {
      seen.add(key);
      return true;
    }
    return false;
  });
  return kept.length === items.length ? null : kept;
}

/** Strips framework ids so Strapi recreates repeatable component rows. */
export function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['id', '__component'].includes(key))
      .map(([key, v]) => [key, stripIds(v)]),
  );
}

/** Media file names the experience fields reference, keyed by bundle `__file`. */
export function experienceMediaSources(bundle, locales) {
  const page = bundle.payload.pages[EXPERIENCE_UID];
  const sources = new Map();
  for (const locale of locales) {
    for (const key of ['ritualContinueImage', 'ritualPauseImage', 'heritageImage']) {
      const file = page?.[locale]?.[key]?.media?.__file;
      if (!file) throw new Error(`Bundle is missing ${key} (${locale}).`);
      const entry = bundle.files.find(f => f.name === file);
      if (!entry?.sourceFile) throw new Error(`Bundle file not listed: ${file}`);
      sources.set(file, entry.sourceFile);
    }
  }
  return sources;
}

/** The four new experience-page fields for one locale, media resolved to ids. */
export function experienceFields(bundle, locale, mediaIds) {
  const page = bundle.payload.pages[EXPERIENCE_UID][locale];
  if (!Array.isArray(page.heritageBody) || page.heritageBody.length === 0) {
    throw new Error(`Bundle is missing heritageBody (${locale}).`);
  }
  const image = key => {
    const { media, ...rest } = page[key];
    const id = mediaIds.get(media.__file);
    if (id === undefined) throw new Error(`Media not uploaded: ${media.__file}`);
    return { ...rest, media: id };
  };
  return {
    ritualContinueImage: image('ritualContinueImage'),
    ritualPauseImage: image('ritualPauseImage'),
    heritageBody: page.heritageBody,
    heritageImage: image('heritageImage'),
  };
}
