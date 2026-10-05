import type { Core } from '@strapi/strapi';
import { getExperienceHeritageStory } from './experience-story.service';

export const registerExperienceStoryRoutes = (strapi: Core.Strapi): void => {
  strapi.server.api('content-api').routes([
    {
      method: 'GET',
      path: '/experience-story',
      handler: (async (ctx: {
        query: { locale?: string };
        status: number;
        body: unknown;
        set: (name: string, value: string) => void;
      }) => {
        const locale = ctx.query?.locale;
        const story = getExperienceHeritageStory(locale);
        ctx.set('Cache-Control', 'public, max-age=300');
        ctx.status = 200;
        ctx.body = { data: story };
      }) as never,
      config: { auth: false, policies: [], middlewares: [] },
    },
  ]);
};

export { getExperienceHeritageStory } from './experience-story.service';
export type { ExperienceHeritageStory } from './experience-story.data';
