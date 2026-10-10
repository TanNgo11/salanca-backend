/**
 * Shared builder for the plugin's internal collections. Every ordering content type is a
 * non-localized, non-versioned collection hidden from both Content Manager and Content-Type
 * Builder; tables use the `plugins_ordering_` prefix (Strapi owns sync, migrations own extras).
 */
const plurals: Record<string, string> = {
  branch: 'branches',
  hold: 'holds',
  outbox: 'outboxes',
  'catalog-category': 'catalog-categories',
};

export const collection = (
  name: string,
  attributes: Record<string, unknown>,
  options: { displayName: string },
) => ({
  kind: 'collectionType',
  collectionName: `plugins_ordering_${name.replaceAll('-', '_')}`,
  info: {
    singularName: name,
    pluralName: plurals[name] ?? `${name}s`,
    displayName: options.displayName,
  },
  options: { draftAndPublish: false },
  pluginOptions: {
    'content-manager': { visible: false },
    'content-type-builder': { visible: false },
    i18n: { localized: false },
  },
  attributes,
});

/**
 * Catalog content types (contracts §20.1) staff edit in Content Manager. Same conventions as
 * `collection` — no i18n, no Draft & Publish, hidden from Content-Type Builder — but visible in
 * Content Manager unless `hideFromContentManager` (catalog-slug, catalog-location-state).
 */
export const catalogCollection = (
  name: string,
  attributes: Record<string, unknown>,
  options: { displayName: string; hideFromContentManager?: boolean },
) => ({
  ...collection(name, attributes, options),
  pluginOptions: {
    'content-manager': { visible: !options.hideFromContentManager },
    'content-type-builder': { visible: false },
    i18n: { localized: false },
  },
});
