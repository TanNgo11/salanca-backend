type ContentTypeSchema = {
  attributes?: Record<string, unknown>;
} & Record<string, unknown>;

type OrderingPlugin = {
  contentTypes: {
    'catalog-product'?: { schema: ContentTypeSchema };
  } & Record<string, { schema: ContentTypeSchema }>;
} & Record<string, unknown>;

/**
 * App-side extension of the ordering plugin (O2 spec): `isFeatured` belongs to the app,
 * not the plugin. It is added by code here — never by copying the plugin's schema.json —
 * so the plugin stays generic while the column syncs into the same plugin table and
 * survives restarts like any schema attribute.
 */
export default (plugin: OrderingPlugin): OrderingPlugin => {
  const product = plugin.contentTypes?.['catalog-product'];
  if (product?.schema) {
    product.schema.attributes = {
      ...product.schema.attributes,
      isFeatured: { type: 'boolean', default: false, required: false },
    };
  }
  return plugin;
};
