import { describe, expect, it, vi } from 'vitest';
import {
  applyHeritageMedia,
  getExperienceHeritageStory,
  HERITAGE_MEDIA_NAMES,
  loadExperienceHeritageStory,
} from './experience-story.service';

describe('getExperienceHeritageStory', () => {
  it('returns Vietnamese heritage story by default or when vi requested', () => {
    const defaultResult = getExperienceHeritageStory();
    expect(defaultResult.locale).toBe('vi');
    expect(defaultResult.paragraphs.length).toBe(4);
    expect(defaultResult.paragraphs[0]).toContain('Từ những năm 1700');
    expect(defaultResult.illustration.position).toBe('left');

    const viResult = getExperienceHeritageStory('vi');
    expect(viResult.locale).toBe('vi');
  });

  it('returns English heritage story when en requested', () => {
    const enResult = getExperienceHeritageStory('en');
    expect(enResult.locale).toBe('en');
    expect(enResult.paragraphs.length).toBe(4);
    expect(enResult.paragraphs[0]).toContain('From 1700s');
    expect(enResult.illustration.position).toBe('right');
  });
});

const row = {
  url: 'https://media.example.com/uploads/pdf_heritage_vi_bg_new123.webp',
  width: 2560,
  height: 1843,
  formats: {
    w1280: { url: 'https://media.example.com/uploads/w1280_pdf_heritage_vi_bg_new123.webp', width: 1280, height: 922 },
    w640: { url: 'https://media.example.com/uploads/w640_pdf_heritage_vi_bg_new123.webp', width: 640, height: 461 },
    broken: { url: '', width: 10, height: 10 },
  },
};

describe('applyHeritageMedia', () => {
  it('uses the media-library file and passes its formats through', () => {
    const story = applyHeritageMedia(getExperienceHeritageStory('vi'), row);

    expect(story.background).toMatchObject({
      src: row.url,
      width: 2560,
      height: 1843,
      color: '#9e151b',
      formats: row.formats,
    });
    expect(story.illustration.src).toBe(row.url);
    expect(story.paragraphs).toEqual(getExperienceHeritageStory('vi').paragraphs);
  });

  it('keeps the shipped artwork when the row is missing or has no url', () => {
    const shipped = getExperienceHeritageStory('en');

    expect(applyHeritageMedia(shipped, null)).toBe(shipped);
    expect(applyHeritageMedia(shipped, { url: '' })).toBe(shipped);
  });
});

describe('loadExperienceHeritageStory', () => {
  it.each(['vi', 'en'] as const)('looks the %s artwork up by its media-library name', async (locale) => {
    const findMedia = vi.fn().mockResolvedValue(row);

    const story = await loadExperienceHeritageStory(findMedia, locale);

    expect(findMedia).toHaveBeenCalledWith(HERITAGE_MEDIA_NAMES[locale]);
    expect(story.locale).toBe(locale);
    expect(story.background.src).toBe(row.url);
  });

  it('falls back to the shipped story when the lookup fails', async () => {
    const story = await loadExperienceHeritageStory(vi.fn().mockRejectedValue(new Error('db down')), 'vi');

    expect(story).toBe(getExperienceHeritageStory('vi'));
  });
});
