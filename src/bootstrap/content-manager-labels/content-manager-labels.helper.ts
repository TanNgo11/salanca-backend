import type {
  ContentManagerFieldMetadataMap,
  ContentManagerListView,
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

export type ContentManagerListViewApplication = {
  settings: unknown;
  layouts: unknown;
  /** Declared columns that are not attributes of the content type. */
  skippedColumns: string[];
};

/**
 * Apply a declared list view onto the live configuration. Columns must be
 * known attributes; unknown names are reported rather than written.
 */
export const applyContentManagerListView = (
  current: { settings: unknown; layouts: unknown },
  listView: ContentManagerListView | undefined,
  knownFields: ReadonlySet<string>,
): ContentManagerListViewApplication => {
  if (!listView) {
    return { settings: current.settings, layouts: current.layouts, skippedColumns: [] };
  }

  const skippedColumns = (listView.columns ?? []).filter((column) => !knownFields.has(column));
  const columns = (listView.columns ?? []).filter((column) => knownFields.has(column));

  const settings = {
    ...(current.settings as Record<string, unknown>),
    ...(listView.defaultSortBy && knownFields.has(listView.defaultSortBy)
      ? { defaultSortBy: listView.defaultSortBy }
      : {}),
    ...(listView.defaultSortOrder ? { defaultSortOrder: listView.defaultSortOrder } : {}),
    ...(listView.pageSize ? { pageSize: listView.pageSize } : {}),
  };

  const layouts = {
    ...(current.layouts as Record<string, unknown>),
    ...(columns.length > 0 ? { list: columns } : {}),
  };

  return { settings, layouts, skippedColumns };
};
