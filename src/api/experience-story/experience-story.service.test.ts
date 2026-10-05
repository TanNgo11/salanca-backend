import { describe, expect, it } from 'vitest';
import { getExperienceHeritageStory } from './experience-story.service';

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
