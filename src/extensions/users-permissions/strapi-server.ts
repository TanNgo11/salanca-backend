type ContentTypeSchema = {
  pluginOptions?: Record<string, unknown>;
} & Record<string, unknown>;

type UsersPermissionsPlugin = {
  contentTypes: {
    user: { schema: ContentTypeSchema };
  };
} & Record<string, unknown>;

// Salanca has no end-user login; keep the plugin for the Public role but hide
// the empty "User" collection from Content Manager.
export default (plugin: UsersPermissionsPlugin): UsersPermissionsPlugin => {
  const schema = plugin.contentTypes.user.schema;
  schema.pluginOptions = {
    ...schema.pluginOptions,
    'content-manager': { visible: false },
  };

  return plugin;
};
