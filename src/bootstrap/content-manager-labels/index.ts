import type { Core } from '@strapi/strapi';

import {
  areContentManagerMetadatasEqual,
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
import {
  CONTENT_MANAGER_FIELD_DESCRIPTIONS_VI,
  CONTENT_MANAGER_FIELD_LABELS_VI,
} from './content-manager-labels.vi';

type SchemaWithLabelConfig = {
  attributes?: Record<string, unknown>;
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

const buildDesiredMetadatas = (
  schema: SchemaWithLabelConfig,
): ContentManagerFieldMetadataOverrideMap => {
  const generated: ContentManagerFieldMetadataOverrideMap = {};
  for (const fieldName of Object.keys(schema.attributes ?? {})) {
    const label = CONTENT_MANAGER_FIELD_LABELS_VI[fieldName];
    if (!label) continue;
    const description = CONTENT_MANAGER_FIELD_DESCRIPTIONS_VI[fieldName];
    generated[fieldName] = {
      edit: { label, ...(description ? { description } : {}) },
      list: { label },
    };
  }

  return {
    ...generated,
    ...(schema.config?.metadatas ?? {}),
  };
};

const discoverLabeledUids = (
  registry: unknown,
): Array<readonly [string, ContentManagerFieldMetadataOverrideMap]> =>
  Object.entries(asSchemaRegistry(registry))
    .map(([uid, schema]) => [uid, buildDesiredMetadatas(schema)] as const)
    .filter(([, metadatas]) => Object.keys(metadatas).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

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
  desiredMetadatas: ContentManagerFieldMetadataOverrideMap,
): Promise<void> => {
  if (Object.keys(desiredMetadatas).length === 0) {
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

  const contentTypeEntries = discoverLabeledUids(strapi.contentTypes).filter(([uid]) =>
    uid.startsWith('api::'),
  );
  for (const [uid, desiredMetadatas] of contentTypeEntries) {
    const model = contentTypeService.findContentType(uid);
    if (!model) {
      strapi.log.warn(`Content Manager content-type not found for label sync: ${uid}`);
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.ContentType, uid, model, desiredMetadatas);
  }

  const componentEntries = discoverLabeledUids(strapi.components);
  for (const [uid, desiredMetadatas] of componentEntries) {
    const model = componentService.findComponent(uid);
    if (!model) {
      strapi.log.warn(`Content Manager component not found for label sync: ${uid}`);
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.Component, uid, model, desiredMetadatas);
  }
};
