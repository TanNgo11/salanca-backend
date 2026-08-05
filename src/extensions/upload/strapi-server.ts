import type { Core } from '@strapi/strapi';

import { getOrCreateMediaProcessingRuntime } from '../../domain/media-processing/runtime';
import {
  createMediaProcessingOptimize,
  type OptimizeFn,
} from '../../domain/media-processing/upload-optimize';
import { createReferenceSafeRemove, type MediaRemove } from './media-reference-guard';

type UploadService = Readonly<{
  remove: MediaRemove;
}> &
  Record<string, unknown>;

type ImageManipulationService = Readonly<{
  optimize: OptimizeFn;
}> &
  Record<string, unknown>;

type UploadPlugin = {
  services: {
    upload: (context: { strapi: Core.Strapi }) => UploadService;
    'image-manipulation'?:
      | ImageManipulationService
      | ((context: { strapi: Core.Strapi }) => ImageManipulationService);
  };
};

const decorateImageManipulation = (
  original:
    | ImageManipulationService
    | ((context: { strapi: Core.Strapi }) => ImageManipulationService),
): ((context: { strapi: Core.Strapi }) => ImageManipulationService) => {
  if (typeof original === 'function') {
    return (context) => {
      const runtime = getOrCreateMediaProcessingRuntime(context.strapi);
      const service = original(context);
      return {
        ...service,
        optimize: createMediaProcessingOptimize(service.optimize as OptimizeFn, runtime),
      };
    };
  }

  return (context) => {
    const runtime = getOrCreateMediaProcessingRuntime(context.strapi);
    return {
      ...original,
      optimize: createMediaProcessingOptimize(original.optimize as OptimizeFn, runtime),
    };
  };
};

export default (plugin: UploadPlugin): UploadPlugin => {
  const createUploadService = plugin.services.upload;
  const originalImageManipulation = plugin.services['image-manipulation'];

  plugin.services.upload = (context) => {
    const service = createUploadService(context);
    return {
      ...service,
      remove: createReferenceSafeRemove(context.strapi, service.remove),
    };
  };

  if (originalImageManipulation) {
    plugin.services['image-manipulation'] = decorateImageManipulation(
      originalImageManipulation,
    );
  }

  return plugin;
};
