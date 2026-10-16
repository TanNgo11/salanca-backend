import type { Core } from '@strapi/strapi';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      pluginName: 'seo-toolkit',
      uid: 'audit.run',
      displayName: 'Run SEO audit',
    },
  ]);
  strapi.log.info('[seo-toolkit] lifecycle: plugin register');
};

export default register;
