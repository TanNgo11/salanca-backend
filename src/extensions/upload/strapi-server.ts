import type { Core } from '@strapi/strapi';

import { getOrCreateMediaProcessingRuntime } from '../../domain/media-processing/runtime';
import {
  createMediaProcessingOptimize,
  type OptimizeFn,
} from '../../domain/media-processing/upload-optimize';
import { createReferenceSafeRemove, type MediaRemove } from './media-reference-guard';
import {
  createAuditedFolderUpdate,
  createAuditedMediaRemove,
  type FolderUpdate,
} from './admin-audit-media';

type UploadService = Readonly<{
  remove: MediaRemove;
}> &
  Record<string, unknown>;

type FolderService = Readonly<{
  update: FolderUpdate;
}> &
  Record<string, unknown>;

type ImageManipulationService = Readonly<{
  optimize: OptimizeFn;
}> &
  Record<string, unknown>;

type UploadPlugin = {
  services: {
    upload: (context: { strapi: Core.Strapi }) => UploadService;
    folder?:
      | FolderService
      | ((context: { strapi: Core.Strapi }) => FolderService);
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

const decorateFolder = (
  original:
    | FolderService
    | ((context: { strapi: Core.Strapi }) => FolderService),
): ((context: { strapi: Core.Strapi }) => FolderService) => {
  if (typeof original === 'function') {
    return (context) => {
      const service = original(context);
      return {
        ...service,
        update: createAuditedFolderUpdate(context.strapi, service.update),
      };
    };
  }

  return (context) => ({
    ...original,
    update: createAuditedFolderUpdate(context.strapi, original.update),
  });
};

export default (plugin: UploadPlugin): UploadPlugin => {
  const createUploadService = plugin.services.upload;
  const originalFolder = plugin.services.folder;
  const originalImageManipulation = plugin.services['image-manipulation'];

  plugin.services.upload = (context) => {
    const service = createUploadService(context);
    return {
      ...service,
      remove: createAuditedMediaRemove(
        context.strapi,
        createReferenceSafeRemove(context.strapi, service.remove),
      ),
    };
  };

  if (originalFolder) {
    plugin.services.folder = decorateFolder(originalFolder);
  }

  if (originalImageManipulation) {
    plugin.services['image-manipulation'] = decorateImageManipulation(
      originalImageManipulation,
    );
  }

  return plugin;
};
