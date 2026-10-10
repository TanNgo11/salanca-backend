type OrderingExtension = {
  contentTypes: Record<string, { schema: { attributes: Record<string, unknown> } }>;
};

/** Proves app-owned attributes survive loading a local plugin. The plugin never imports this file. */
export default (plugin: OrderingExtension) => {
  plugin.contentTypes['catalog-product'].schema.attributes.isFeatured = { type: 'boolean', default: false };
  return plugin;
};
