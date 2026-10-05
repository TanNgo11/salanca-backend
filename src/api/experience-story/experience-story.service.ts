import { EXPERIENCE_HERITAGE_DATA, type ExperienceHeritageStory } from './experience-story.data';

export const getExperienceHeritageStory = (localeRaw?: string): ExperienceHeritageStory => {
  const locale = localeRaw === 'en' ? 'en' : 'vi';
  return EXPERIENCE_HERITAGE_DATA[locale];
};
