import type { Core } from '@strapi/strapi';

import { getOrCreateMediaProcessingRuntime } from '../../domain/media-processing/runtime';
import {
  createMediaProcessingOptimize,
  type OptimizeFn,
} from '../../domain/media-processing/upload-optimize';
import { emitMediaReplacedWebhook } from '../../domain/cms-webhook/emit-cms-webhook';
import {
  createFreshHashReplace,
  type FreshHashReplaceDeps,
  type UploadFileData,
} from './fresh-hash-replace';
import { createReferenceSafeRemove, type MediaRemove } from './media-reference-guard';
import {
  createAuditedFolderUpdate,
  createAuditedMediaRemove,
  type FolderUpdate,
} from './admin-audit-media';

type UploadService = Readonly<{
  remove: MediaRemove;
  findOne: FreshHashReplaceDeps['findOne'];
  formatFileInfo: FreshHashReplaceDeps['formatFileInfo'];
  _uploadImage: FreshHashReplaceDeps['uploadImage'];
  updateFileInfo: FreshHashReplaceDeps['updateFileInfo'];
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

type ImageChecks = Readonly<{
  isImage: FreshHashReplaceDeps['isImage'];
  isFaultyImage: FreshHashReplaceDeps['isFaultyImage'];
  isOptimizableImage: FreshHashReplaceDeps['isOptimizableImage'];
  optimize: FreshHashReplaceDeps['optimize'];
}>;

type ProviderService = Readonly<{
  checkFileSize: FreshHashReplaceDeps['checkFileSize'];
  upload: FreshHashReplaceDeps['uploadFile'];
}>;

/** Sibling services are resolved per call: they may not exist yet when this factory runs. */
const createReplaceDeps = (strapi: Core.Strapi, service: UploadService): FreshHashReplaceDeps => {
  const images = (): ImageChecks =>
    strapi.plugin('upload').service('image-manipulation') as unknown as ImageChecks;
  const provider = (): ProviderService =>
    strapi.plugin('upload').service('provider') as unknown as ProviderService;

  return {
    findOne: service.findOne,
    formatFileInfo: service.formatFileInfo,
    isImage: (file: UploadFileData) => images().isImage(file),
    isFaultyImage: (file: UploadFileData) => images().isFaultyImage(file),
    isOptimizableImage: (file: UploadFileData) => images().isOptimizableImage(file),
    optimize: (file: UploadFileData) => images().optimize(file),
    checkFileSize: (file: UploadFileData) => provider().checkFileSize(file),
    uploadImage: service._uploadImage,
    uploadFile: (file: UploadFileData) => provider().upload(file),
    providerName: () => String(strapi.config.get('plugin::upload.provider')),
    updateFileInfo: service.updateFileInfo,
    onReplaced: (fileId) => emitMediaReplacedWebhook(strapi, fileId),
  };
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
      replace: createFreshHashReplace(context.strapi, createReplaceDeps(context.strapi, service)),
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
