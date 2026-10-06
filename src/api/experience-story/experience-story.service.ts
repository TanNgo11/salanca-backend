import { EXPERIENCE_HERITAGE_DATA, type ExperienceHeritageStory } from './experience-story.data';

type HeritageLocale = 'vi' | 'en';

/**
 * Media-library rows holding the heritage artwork (uploaded by
 * scripts/upload-experience-heritage-s3.mjs). The story resolves its image
 * from these rows on every request, so an admin Replace (fresh hash, same row
 * and name) reaches the site without editing a hardcoded URL.
 */
export const HERITAGE_MEDIA_NAMES: Readonly<Record<HeritageLocale, string>> = {
  vi: 'pdf-heritage-vi-bg.webp',
  en: 'pdf-heritage-en-bg.webp',
};

/** Slim view of a `plugin::upload.file` row. */
export type HeritageMediaRow = Readonly<{
  url?: unknown;
  width?: unknown;
  height?: unknown;
  formats?: unknown;
}>;

export type FindHeritageMedia = (name: string) => Promise<HeritageMediaRow | null | undefined>;

const resolveLocale = (localeRaw?: string): HeritageLocale => (localeRaw === 'en' ? 'en' : 'vi');

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Overlays the media-library file on the shipped story. Without a usable row
 * the shipped URL stays, so the section never loses its artwork.
 */
export const applyHeritageMedia = (
  story: ExperienceHeritageStory,
  media: HeritageMediaRow | null | undefined,
): ExperienceHeritageStory => {
  if (!media || typeof media.url !== 'string' || media.url === '') return story;
  const formats =
    media.formats !== null && typeof media.formats === 'object' && !Array.isArray(media.formats)
      ? (media.formats as Readonly<Record<string, unknown>>)
      : undefined;
  const dimensions =
    isPositiveNumber(media.width) && isPositiveNumber(media.height)
      ? { width: media.width, height: media.height }
      : {};
  return {
    ...story,
    illustration: { ...story.illustration, src: media.url },
    background: {
      ...story.background,
      src: media.url,
      ...dimensions,
      ...(formats === undefined ? {} : { formats }),
    },
  };
};

export const getExperienceHeritageStory = (localeRaw?: string): ExperienceHeritageStory =>
  EXPERIENCE_HERITAGE_DATA[resolveLocale(localeRaw)];

export const loadExperienceHeritageStory = async (
  findMedia: FindHeritageMedia,
  localeRaw?: string,
): Promise<ExperienceHeritageStory> => {
  const locale = resolveLocale(localeRaw);
  const story = EXPERIENCE_HERITAGE_DATA[locale];
  try {
    return applyHeritageMedia(story, await findMedia(HERITAGE_MEDIA_NAMES[locale]));
  } catch {
    return story;
  }
};
