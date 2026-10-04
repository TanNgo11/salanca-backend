export enum ContentManagerModelKind {
  Component = 'component',
  ContentType = 'content-type',
}

export type ContentManagerFieldMetadata = {
  edit?: {
    label?: string;
    description?: string;
    placeholder?: string;
    visible?: boolean;
    editable?: boolean;
  };
  list?: {
    label?: string;
    searchable?: boolean;
    sortable?: boolean;
  };
};

export type ContentManagerFieldMetadataMap = Record<string, ContentManagerFieldMetadata>;

export type ContentManagerFieldMetadataOverrideMap = Record<
  string,
  ContentManagerFieldMetadata | undefined
>;

export type ContentManagerMergeResult = {
  mergedMetadatas: ContentManagerFieldMetadataMap;
  /** Desired override keys that were not present on the live CM configuration. */
  skippedFields: string[];
};

/**
 * Declared under `config.listView` in a schema.json: which columns the Content
 * Manager list shows (in order) and how it sorts and pages by default.
 */
export type ContentManagerListView = {
  columns?: string[];
  defaultSortBy?: string;
  defaultSortOrder?: 'ASC' | 'DESC';
  pageSize?: number;
};

export type ContentManagerConfiguration = {
  settings: unknown;
  metadatas: ContentManagerFieldMetadataMap;
  layouts: unknown;
};

export type ContentManagerConfigurationInput = {
  settings: unknown;
  metadatas: ContentManagerFieldMetadataMap;
  layouts: unknown;
};

export type ContentManagerModel = {
  uid: string;
  config?: {
    metadatas?: ContentManagerFieldMetadataOverrideMap;
    listView?: ContentManagerListView;
  };
};

export type ContentManagerContentTypeService = {
  findContentType: (uid: string) => ContentManagerModel | null | undefined;
  findConfiguration: (model: ContentManagerModel) => Promise<ContentManagerConfiguration>;
  updateConfiguration: (
    model: ContentManagerModel,
    configuration: ContentManagerConfigurationInput,
  ) => Promise<unknown>;
};

export type ContentManagerComponentService = {
  findComponent: (uid: string) => ContentManagerModel | null | undefined;
  findConfiguration: (model: ContentManagerModel) => Promise<ContentManagerConfiguration>;
  updateConfiguration: (
    model: ContentManagerModel,
    configuration: ContentManagerConfigurationInput,
  ) => Promise<unknown>;
};
