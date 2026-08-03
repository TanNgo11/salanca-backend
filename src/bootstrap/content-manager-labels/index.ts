import type { Core } from '@strapi/strapi';

import {
  areContentManagerMetadatasEqual,
  hasContentManagerLabelOverrides,
  mergeContentManagerMetadatas,
} from './content-manager-labels.helper';
import {
  ContentManagerModelKind,
  type ContentManagerComponentService,
  type ContentManagerConfiguration,
  type ContentManagerConfigurationInput,
  type ContentManagerContentTypeService,
  type ContentManagerFieldMetadataOverrideMap,
  type ContentManagerModel,
} from './content-manager-labels.types';

type SchemaWithLabelConfig = {
  config?: { metadatas?: ContentManagerFieldMetadataOverrideMap };
};

/**
 * Label sync v1 scope: only schemas that declare `config.metadatas` in schema.json.
 * Auto-discovered at bootstrap — no hand-maintained UID allowlist (avoids ghost entries).
 *
 * Current labeled models (as of schema files):
 * - api::global-setting, api::location, api::campaign
 * - shared.seo | hero | image | link | social-link | cta | operating-period
 */
const asSchemaRegistry = (registry: unknown): Record<string, SchemaWithLabelConfig> =>
  (registry ?? {}) as Record<string, SchemaWithLabelConfig>;

const discoverLabeledUids = (registry: unknown): string[] =>
  Object.entries(asSchemaRegistry(registry))
    .filter(([, schema]) => hasContentManagerLabelOverrides(schema))
    .map(([uid]) => uid)
    .sort();

const readSchemaMetadatas = (
  registry: unknown,
  uid: string,
): ContentManagerFieldMetadataOverrideMap | undefined =>
  asSchemaRegistry(registry)[uid]?.config?.metadatas;

const buildConfigurationInput = (
  currentConfiguration: ContentManagerConfiguration,
  desiredMetadatas: ContentManagerFieldMetadataOverrideMap,
): { input: ContentManagerConfigurationInput; skippedFields: string[] } => {
  const { mergedMetadatas, skippedFields } = mergeContentManagerMetadatas(
    currentConfiguration.metadatas,
    desiredMetadatas,
  );

  return {
    input: {
      settings: currentConfiguration.settings,
      metadatas: mergedMetadatas,
      layouts: currentConfiguration.layouts,
    },
    skippedFields,
  };
};

const synchronizeOne = async (
  strapi: Core.Strapi,
  kind: ContentManagerModelKind,
  uid: string,
  model: ContentManagerModel,
): Promise<void> => {
  const desiredMetadatas = model.config?.metadatas;
  if (!desiredMetadatas || Object.keys(desiredMetadatas).length === 0) {
    return;
  }

  const service =
    kind === ContentManagerModelKind.ContentType
      ? strapi.plugin('content-manager').service<ContentManagerContentTypeService>('content-types')
      : strapi.plugin('content-manager').service<ContentManagerComponentService>('components');

  const currentConfiguration = await service.findConfiguration(model);
  const { input, skippedFields } = buildConfigurationInput(currentConfiguration, desiredMetadatas);

  if (skippedFields.length > 0) {
    strapi.log.warn(
      `Content Manager label overrides skipped for ${uid} (fields missing from CM config): ${skippedFields.join(', ')}`,
    );
  }

  if (areContentManagerMetadatasEqual(currentConfiguration.metadatas, input.metadatas)) {
    return;
  }

  await service.updateConfiguration(model, input);
};

export const synchronizeContentManagerLabels = async (strapi: Core.Strapi): Promise<void> => {
  const contentTypeService = strapi
    .plugin('content-manager')
    .service<ContentManagerContentTypeService>('content-types');
  const componentService = strapi
    .plugin('content-manager')
    .service<ContentManagerComponentService>('components');

  const contentTypeUids = discoverLabeledUids(strapi.contentTypes);
  for (const uid of contentTypeUids) {
    const model = contentTypeService.findContentType(uid);
    if (!model) {
      strapi.log.warn(`Content Manager content-type not found for label sync: ${uid}`);
      continue;
    }
    // Prefer CM model config; fall back to schema registry if CM omits custom config.
    if (!hasContentManagerLabelOverrides(model)) {
      const schemaMetadatas = readSchemaMetadatas(strapi.contentTypes, uid);
      if (schemaMetadatas) {
        model.config = { ...model.config, metadatas: schemaMetadatas };
      }
    }
    if (!hasContentManagerLabelOverrides(model)) {
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.ContentType, uid, model);
  }

  const componentUids = discoverLabeledUids(strapi.components);
  for (const uid of componentUids) {
    const model = componentService.findComponent(uid);
    if (!model) {
      strapi.log.warn(`Content Manager component not found for label sync: ${uid}`);
      continue;
    }
    if (!hasContentManagerLabelOverrides(model)) {
      const schemaMetadatas = readSchemaMetadatas(strapi.components, uid);
      if (schemaMetadatas) {
        model.config = { ...model.config, metadatas: schemaMetadatas };
      }
    }
    if (!hasContentManagerLabelOverrides(model)) {
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.Component, uid, model);
  }
};
