import type { Core } from '@strapi/strapi';

import {
  applyContentManagerListView,
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
  type ContentManagerListView,
  type ContentManagerModel,
} from './content-manager-labels.types';
import {
  CONTENT_MANAGER_FIELD_DESCRIPTIONS_VI,
  CONTENT_MANAGER_FIELD_LABELS_VI,
} from './content-manager-labels.vi';

type SchemaWithLabelConfig = {
  attributes?: Record<string, unknown>;
  config?: {
    metadatas?: ContentManagerFieldMetadataOverrideMap;
    listView?: ContentManagerListView;
  };
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

const SYSTEM_FIELDS = ['id', 'documentId', 'createdAt', 'updatedAt'] as const;

type LabeledEntry = Readonly<{
  uid: string;
  metadatas: ContentManagerFieldMetadataOverrideMap;
  listView: ContentManagerListView | undefined;
  fields: ReadonlySet<string>;
}>;

const discoverLabeledUids = (registry: unknown): LabeledEntry[] =>
  Object.entries(asSchemaRegistry(registry))
    .map(([uid, schema]) => ({
      uid,
      metadatas: buildDesiredMetadatas(schema),
      listView: schema.config?.listView,
      fields: new Set([...SYSTEM_FIELDS, ...Object.keys(schema.attributes ?? {})]),
    }))
    .filter(
      ({ metadatas, listView }) => Object.keys(metadatas).length > 0 || listView !== undefined,
    )
    .sort((a, b) => a.uid.localeCompare(b.uid));

const buildConfigurationInput = (
  currentConfiguration: ContentManagerConfiguration,
  entry: LabeledEntry,
): {
  input: ContentManagerConfigurationInput;
  skippedFields: string[];
  skippedColumns: string[];
} => {
  const { mergedMetadatas, skippedFields } = mergeContentManagerMetadatas(
    currentConfiguration.metadatas,
    entry.metadatas,
  );
  const { settings, layouts, skippedColumns } = applyContentManagerListView(
    currentConfiguration,
    entry.listView,
    entry.fields,
  );

  return {
    input: { settings, metadatas: mergedMetadatas, layouts },
    skippedFields,
    skippedColumns,
  };
};

const synchronizeOne = async (
  strapi: Core.Strapi,
  kind: ContentManagerModelKind,
  uid: string,
  model: ContentManagerModel,
  entry: LabeledEntry,
): Promise<void> => {
  const service =
    kind === ContentManagerModelKind.ContentType
      ? strapi.plugin('content-manager').service<ContentManagerContentTypeService>('content-types')
      : strapi.plugin('content-manager').service<ContentManagerComponentService>('components');

  const currentConfiguration = await service.findConfiguration(model);
  const { input, skippedFields, skippedColumns } = buildConfigurationInput(
    currentConfiguration,
    entry,
  );

  if (skippedFields.length > 0) {
    strapi.log.warn(
      `Content Manager label overrides skipped for ${uid} (fields missing from CM config): ${skippedFields.join(', ')}`,
    );
  }

  if (skippedColumns.length > 0) {
    strapi.log.warn(
      `Content Manager list columns skipped for ${uid} (not attributes): ${skippedColumns.join(', ')}`,
    );
  }

  const unchanged =
    areContentManagerMetadatasEqual(currentConfiguration.metadatas, input.metadatas) &&
    JSON.stringify(currentConfiguration.settings) === JSON.stringify(input.settings) &&
    JSON.stringify(currentConfiguration.layouts) === JSON.stringify(input.layouts);
  if (unchanged) {
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

  const contentTypeEntries = discoverLabeledUids(strapi.contentTypes).filter(({ uid }) =>
    uid.startsWith('api::'),
  );
  for (const entry of contentTypeEntries) {
    const { uid } = entry;
    const model = contentTypeService.findContentType(uid);
    if (!model) {
      strapi.log.warn(`Content Manager content-type not found for label sync: ${uid}`);
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.ContentType, uid, model, entry);
  }

  const componentEntries = discoverLabeledUids(strapi.components);
  for (const entry of componentEntries) {
    const { uid } = entry;
    const model = componentService.findComponent(uid);
    if (!model) {
      strapi.log.warn(`Content Manager component not found for label sync: ${uid}`);
      continue;
    }
    await synchronizeOne(strapi, ContentManagerModelKind.Component, uid, model, entry);
  }
};
