import type { Core } from '@strapi/strapi';

import { createReferenceSafeRemove, type MediaRemove } from './media-reference-guard';

type UploadService = Readonly<{
  remove: MediaRemove;
}> &
  Record<string, unknown>;

type UploadPlugin = {
  services: {
    upload: (context: { strapi: Core.Strapi }) => UploadService;
  };
};

export default (plugin: UploadPlugin): UploadPlugin => {
  const createUploadService = plugin.services.upload;

  plugin.services.upload = (context) => {
    const service = createUploadService(context);

    return {
      ...service,
      remove: createReferenceSafeRemove(context.strapi, service.remove),
    };
  };

  return plugin;
};
