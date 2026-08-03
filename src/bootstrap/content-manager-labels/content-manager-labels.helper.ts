import type {
  ContentManagerFieldMetadataMap,
  ContentManagerFieldMetadataOverrideMap,
  ContentManagerMergeResult,
} from './content-manager-labels.types';

/**
 * Merge desired Content Manager field labels onto current config.
 * Only fields present in both maps are updated. Desired keys missing from
 * current config are reported so callers can warn (typo / schema drift).
 */
export const mergeContentManagerMetadatas = (
  currentMetadatas: ContentManagerFieldMetadataMap,
  desiredMetadatas: ContentManagerFieldMetadataOverrideMap,
): ContentManagerMergeResult => {
  const mergedMetadatas: ContentManagerFieldMetadataMap = {
    ...currentMetadatas,
  };
  const skippedFields: string[] = [];

  for (const [fieldName, desiredMetadata] of Object.entries(desiredMetadatas)) {
    if (!desiredMetadata) {
      continue;
    }

    const currentMetadata = currentMetadatas[fieldName];
    if (!currentMetadata) {
      skippedFields.push(fieldName);
      continue;
    }

    mergedMetadatas[fieldName] = {
      edit: {
        ...currentMetadata.edit,
        ...desiredMetadata.edit,
      },
      list: {
        ...currentMetadata.list,
        ...desiredMetadata.list,
      },
    };
  }

  return { mergedMetadatas, skippedFields };
};

export const areContentManagerMetadatasEqual = (
  left: ContentManagerFieldMetadataMap,
  right: ContentManagerFieldMetadataMap,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/** True when schema declares at least one field label override. */
export const hasContentManagerLabelOverrides = (
  model: { config?: { metadatas?: ContentManagerFieldMetadataOverrideMap } } | null | undefined,
): boolean => {
  const metadatas = model?.config?.metadatas;
  return !!metadatas && Object.keys(metadatas).length > 0;
};
