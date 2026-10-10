/**
 * Shared builder for the plugin's internal collections. Every ordering content type is a
 * non-localized, non-versioned collection hidden from both Content Manager and Content-Type
 * Builder; tables use the `plugins_ordering_` prefix (Strapi owns sync, migrations own extras).
 */
const plurals: Record<string, string> = {
  branch: 'branches',
  hold: 'holds',
  outbox: 'outboxes',
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
