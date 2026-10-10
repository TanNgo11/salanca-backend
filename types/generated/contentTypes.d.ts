import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    adminPermissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::permission'
    >;
    adminUserOwner: Schema.Attribute.Relation<'manyToOne', 'admin::user'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    kind: Schema.Attribute.Enumeration<['content-api', 'admin']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'content-api'>;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    apiToken: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON & Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    apiTokens: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordTokenExpiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiAuditEventAuditEvent extends Struct.CollectionTypeSchema {
  collectionName: 'audit_events';
  info: {
    description: 'Nh\u1EADt k\u00FD b\u1EA5t bi\u1EBFn c\u1EE7a ho\u1EA1t \u0111\u1ED9ng qu\u1EA3n tr\u1ECB';
    displayName: 'Nh\u1EADt k\u00FD ho\u1EA1t \u0111\u1ED9ng';
    pluralName: 'audit-events';
    singularName: 'audit-event';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.Enumeration<
      [
        'cms_entry_create',
        'cms_entry_update',
        'cms_entry_delete',
        'cms_entry_publish',
        'cms_entry_unpublish',
        'media_create',
        'media_update',
        'media_delete',
        'media_folder_create',
        'media_folder_update',
        'media_folder_delete',
        'admin_user_create',
        'admin_user_update',
        'admin_user_activate',
        'admin_user_deactivate',
        'admin_user_delete',
        'admin_role_create',
        'admin_role_update',
        'admin_role_delete',
        'admin_role_permissions_update',
        'admin_login_success',
        'admin_login_failure',
        'admin_logout',
        'api_token_create',
        'api_token_update',
        'api_token_regenerate',
        'api_token_revoke',
        'transfer_token_create',
        'transfer_token_update',
        'transfer_token_regenerate',
        'transfer_token_revoke',
        'webhook_create',
        'webhook_update',
        'webhook_delete',
        'notification_settings_update',
      ]
    > &
      Schema.Attribute.Required;
    actorDocumentId: Schema.Attribute.String &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    actorLabel: Schema.Attribute.String &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 320;
      }>;
    actorType: Schema.Attribute.Enumeration<
      ['anonymous', 'admin_user', 'system']
    > &
      Schema.Attribute.Required;
    afterValues: Schema.Attribute.JSON & Schema.Attribute.Private;
    beforeValues: Schema.Attribute.JSON & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    eventId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    eventSource: Schema.Attribute.Enumeration<
      ['admin_panel', 'system_process']
    >;
    httpMethod: Schema.Attribute.Enumeration<
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    > &
      Schema.Attribute.Required;
    identifierFingerprint: Schema.Attribute.String &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::audit-event.audit-event'
    > &
      Schema.Attribute.Private;
    occurredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    requestId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    requestPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2048;
      }>;
    statusCode: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 599;
          min: 100;
        },
        number
      >;
    success: Schema.Attribute.Boolean & Schema.Attribute.Required;
    targetDocumentId: Schema.Attribute.String &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    targetLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 320;
      }>;
    targetType: Schema.Attribute.Enumeration<
      [
        'authentication',
        'cms_entry',
        'media',
        'media_folder',
        'admin_user',
        'admin_role',
        'api_token',
        'transfer_token',
        'webhook',
        'setting',
      ]
    > &
      Schema.Attribute.Required;
    targetUid: Schema.Attribute.String &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 128;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiBookingPageBookingPage extends Struct.SingleTypeSchema {
  collectionName: 'booking_pages';
  info: {
    description: 'Booking-page copy and form presentation options only';
    displayName: 'Trang \u0111\u1EB7t b\u00E0n';
    pluralName: 'booking-pages';
    singularName: 'booking-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    arrivalTimes: Schema.Attribute.Component<'shared.option', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    bookingNotice: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1000;
      }>;
    contactInfo: Schema.Attribute.Component<'shared.booking-contact', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    formHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    guestOptions: Schema.Attribute.Component<'shared.option', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::booking-page.booking-page'
    >;
    notes: Schema.Attribute.Component<'shared.list-item', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    notesHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    occasionBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    occasionHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    occasionImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    occasionOptions: Schema.Attribute.Component<'shared.option', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    occasions: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    steps: Schema.Attribute.Component<'shared.step', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    stepsHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    supportBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    supportHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    supportImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCampaignPageCampaignPage extends Struct.SingleTypeSchema {
  collectionName: 'campaign_pages';
  info: {
    description: 'Headings and featured content for promotions and events';
    displayName: 'Trang \u01B0u \u0111\u00E3i';
    pluralName: 'campaign-pages';
    singularName: 'campaign-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    closingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    eventCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    featuredCampaign: Schema.Attribute.Relation<
      'oneToOne',
      'api::campaign.campaign'
    >;
    featuredHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    listingHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::campaign-page.campaign-page'
    >;
    newsletterHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    newsletterNote: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCampaignCampaign extends Struct.CollectionTypeSchema {
  collectionName: 'campaigns';
  info: {
    description: 'Khuy\u1EBFn m\u00E3i, s\u1EF1 ki\u1EC7n v\u00E0 ti\u1EC7c ri\u00EAng';
    displayName: '\u01AFu \u0111\u00E3i / s\u1EF1 ki\u1EC7n';
    pluralName: 'campaigns';
    singularName: 'campaign';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    body: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    coverImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    cta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    endsAt: Schema.Attribute.DateTime;
    gallery: Schema.Attribute.Component<'shared.image', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    kind: Schema.Attribute.Enumeration<
      ['promotion', 'event', 'private_event']
    > &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::campaign.campaign'
    >;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    slug: Schema.Attribute.UID<'title'> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    startsAt: Schema.Attribute.DateTime;
    summary: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    terms: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiContactMessageContactMessage
  extends Struct.CollectionTypeSchema {
  collectionName: 'contact_messages';
  info: {
    description: 'Public contact form lead intake (not marketing content)';
    displayName: 'Tin nh\u1EAFn li\u00EAn h\u1EC7';
    pluralName: 'contact-messages';
    singularName: 'contact-message';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email;
    fullName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    leadStatus: Schema.Attribute.Enumeration<['new', 'read', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'new'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::contact-message.contact-message'
    > &
      Schema.Attribute.Private;
    message: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 4000;
      }>;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    sourceLocale: Schema.Attribute.Enumeration<['vi', 'en']> &
      Schema.Attribute.Required;
    sourcePath: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    topic: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiContactPageContactPage extends Struct.SingleTypeSchema {
  collectionName: 'contact_pages';
  info: {
    description: 'Contact-page copy and form presentation options only';
    displayName: 'Trang li\u00EAn h\u1EC7';
    pluralName: 'contact-pages';
    singularName: 'contact-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    closingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    faqHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    faqItems: Schema.Attribute.Component<'shared.faq-item', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    featuredLocation: Schema.Attribute.Relation<
      'oneToOne',
      'api::location.location'
    >;
    formHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    formTopics: Schema.Attribute.Component<'shared.option', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    helpBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    helpHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    helpImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    helpItems: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::contact-page.contact-page'
    >;
    mapHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    mapImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    socialHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    socialImages: Schema.Attribute.Component<'shared.image', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    visitHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    visitImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
  };
}

export interface ApiExperiencePageExperiencePage
  extends Struct.SingleTypeSchema {
  collectionName: 'experience_pages';
  info: {
    description: 'Fixed editorial structure for the Churrascaria experience';
    displayName: 'Trang tr\u1EA3i nghi\u1EC7m';
    pluralName: 'experience-pages';
    singularName: 'experience-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    closingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    flavorCards: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    flavorItems: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-item.menu-item'
    >;
    flavorsHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    heritageBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    heritageImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    introBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    introHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    introImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::experience-page.experience-page'
    >;
    manifestoHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    processHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    processSteps: Schema.Attribute.Component<'shared.step', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    ritualBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    ritualContinueImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    ritualHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    ritualImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    ritualLink: Schema.Attribute.Component<'shared.link', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    ritualPauseImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    tableBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    tableHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    tableImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiFooterSettingFooterSetting extends Struct.SingleTypeSchema {
  collectionName: 'footer_settings';
  info: {
    description: 'Hai c\u1ED9t link c\u1EE7a footer. Th\u00F4ng tin li\u00EAn h\u1EC7, gi\u1EDD, m\u1EA1ng x\u00E3 h\u1ED9i v\u00E0 logo l\u1EA5y t\u1EEB C\u1EA5u h\u00ECnh chung.';
    displayName: 'Ch\u00E2n trang';
    pluralName: 'footer-settings';
    singularName: 'footer-setting';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    footerExploreLinks: Schema.Attribute.Component<'shared.link', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    footerInfoLinks: Schema.Attribute.Component<'shared.link', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::footer-setting.footer-setting'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiGalleryItemGalleryItem extends Struct.CollectionTypeSchema {
  collectionName: 'gallery_items';
  info: {
    description: 'Ordered image assigned to a restaurant area';
    displayName: '\u1EA2nh gallery';
    pluralName: 'gallery-items';
    singularName: 'gallery-item';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    area: Schema.Attribute.Enumeration<
      ['main_hall', 'bar', 'private_room', 'night', 'food', 'experience']
    > &
      Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    image: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::gallery-item.gallery-item'
    >;
    location: Schema.Attribute.Relation<'manyToOne', 'api::location.location'>;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 140;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiGlobalSettingGlobalSetting extends Struct.SingleTypeSchema {
  collectionName: 'global_settings';
  info: {
    description: 'Th\u01B0\u01A1ng hi\u1EC7u, li\u00EAn h\u1EC7, \u0111\u1ECBa \u0111i\u1EC3m v\u00E0 SEO m\u1EB7c \u0111\u1ECBnh. Header v\u00E0 footer c\u00F3 single type ri\u00EAng.';
    displayName: 'C\u1EA5u h\u00ECnh chung';
    pluralName: 'global-settings';
    singularName: 'global-setting';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    address: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    brandName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    defaultSeo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    hotline: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::global-setting.global-setting'
    >;
    logo: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    mainLocation: Schema.Attribute.Relation<
      'oneToOne',
      'api::location.location'
    >;
    mapUrl: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2048;
      }>;
    openingHours: Schema.Attribute.Component<'shared.operating-period', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    socialLinks: Schema.Attribute.Component<'shared.social-link', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    tagline: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    whatsapp: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
  };
}

export interface ApiHeaderSettingHeaderSetting extends Struct.SingleTypeSchema {
  collectionName: 'header_settings';
  info: {
    description: 'Header brand, logo, and primary navigation';
    displayName: '\u0110\u1EA7u trang';
    pluralName: 'header-settings';
    singularName: 'header-setting';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    brandName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    headerLinks: Schema.Attribute.Component<'shared.link', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::header-setting.header-setting'
    >;
    logo: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    menuLinks: Schema.Attribute.Component<'shared.link', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    tagline: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiHomePageHomePage extends Struct.SingleTypeSchema {
  collectionName: 'home_pages';
  info: {
    description: 'Eight mockup sections: hero, experience, buffet, menu, story, process, space, booking';
    displayName: 'Trang ch\u1EE7';
    pluralName: 'home-pages';
    singularName: 'home-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    bookingStrip: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    buffet: Schema.Attribute.Component<'home.buffet', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    experience: Schema.Attribute.Component<'home.experience', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    featuredMenuItems: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-item.menu-item'
    >;
    featuredPackage: Schema.Attribute.Relation<
      'oneToOne',
      'api::menu-package.menu-package'
    >;
    hero: Schema.Attribute.Component<'home.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::home-page.home-page'
    >;
    menuHighlights: Schema.Attribute.Component<'home.menu-highlights', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    process: Schema.Attribute.Component<'home.process', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    space: Schema.Attribute.Component<'home.space', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    story: Schema.Attribute.Component<'home.story', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiLocationLocation extends Struct.CollectionTypeSchema {
  collectionName: 'locations';
  info: {
    description: 'Chi nh\u00E1nh nh\u00E0 h\u00E0ng v\u00E0 gi\u1EDD ho\u1EA1t \u0111\u1ED9ng';
    displayName: 'Chi nh\u00E1nh';
    pluralName: 'locations';
    singularName: 'location';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    address: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    email: Schema.Attribute.Email;
    gallery: Schema.Attribute.Component<'shared.image', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    galleryItems: Schema.Attribute.Relation<
      'oneToMany',
      'api::gallery-item.gallery-item'
    >;
    heroImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::location.location'
    >;
    mapUrl: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2048;
      }>;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 140;
      }>;
    operatingHours: Schema.Attribute.Component<
      'shared.operating-period',
      true
    > &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMenuCategoryMenuCategory
  extends Struct.CollectionTypeSchema {
  collectionName: 'menu_categories';
  info: {
    description: 'Ordered group of menu items';
    displayName: 'Nh\u00F3m m\u00F3n';
    pluralName: 'menu-categories';
    singularName: 'menu-category';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 600;
      }>;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    image: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    items: Schema.Attribute.Relation<'oneToMany', 'api::menu-item.menu-item'>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-category.menu-category'
    >;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMenuItemMenuItem extends Struct.CollectionTypeSchema {
  collectionName: 'menu_items';
  info: {
    description: 'Individual menu item with numeric VND price';
    displayName: 'M\u00F3n';
    pluralName: 'menu-items';
    singularName: 'menu-item';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    category: Schema.Attribute.Relation<
      'manyToOne',
      'api::menu-category.menu-category'
    > &
      Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    image: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    isFeatured: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-item.menu-item'
    >;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 140;
      }>;
    portion: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    price: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    shortDescription: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    showStar: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMenuPackageMenuPackage extends Struct.CollectionTypeSchema {
  collectionName: 'menu_packages';
  info: {
    description: 'Buffet or fixed menu package';
    displayName: 'G\u00F3i buffet';
    pluralName: 'menu-packages';
    singularName: 'menu-package';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    adultPrice: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    childPrice: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    displayOrder: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    image: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    includedItems: Schema.Attribute.Component<'shared.list-item', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-package.menu-package'
    >;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 140;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    slug: Schema.Attribute.UID<'name'> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMenuPageMenuPage extends Struct.SingleTypeSchema {
  collectionName: 'menu_pages';
  info: {
    description: 'Headings and featured content surrounding menu collections';
    displayName: 'Trang th\u1EF1c \u0111\u01A1n';
    pluralName: 'menu-pages';
    singularName: 'menu-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    aLaCarte: Schema.Attribute.Component<'shared.feature-block', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    bookingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    catering: Schema.Attribute.Component<'shared.feature-block', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    cateringSeo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    decorations: Schema.Attribute.Component<'menu.decor', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: false;
        };
      }>;
    drinks: Schema.Attribute.Component<'shared.feature-block', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    featuredPackage: Schema.Attribute.Relation<
      'oneToOne',
      'api::menu-package.menu-package'
    >;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    itemSectionHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::menu-page.menu-page'
    >;
    packageListingHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    packageSectionHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    priceNote: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 255;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    rodizioPackage: Schema.Attribute.Relation<
      'oneToOne',
      'api::menu-package.menu-package'
    >;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiReservationRequestReservationRequest
  extends Struct.CollectionTypeSchema {
  collectionName: 'reservation_requests';
  info: {
    description: 'Public reservation lead intake (not a booking engine)';
    displayName: 'Y\u00EAu c\u1EA7u \u0111\u1EB7t b\u00E0n';
    pluralName: 'reservation-requests';
    singularName: 'reservation-request';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email;
    fullName: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    guestCount: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 1;
        },
        number
      >;
    leadStatus: Schema.Attribute.Enumeration<
      ['new', 'read', 'confirmed', 'cancelled', 'no_show', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'new'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::reservation-request.reservation-request'
    > &
      Schema.Attribute.Private;
    menuItems: Schema.Attribute.Relation<
      'manyToMany',
      'api::menu-item.menu-item'
    >;
    menuPackages: Schema.Attribute.Relation<
      'manyToMany',
      'api::menu-package.menu-package'
    >;
    menuSelectionMode: Schema.Attribute.Enumeration<['later', 'now']> &
      Schema.Attribute.Required;
    note: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    occasion: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    overlapCount: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    phone: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    preferredDate: Schema.Attribute.Date & Schema.Attribute.Required;
    preferredTime: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    sourceLocale: Schema.Attribute.Enumeration<['vi', 'en']> &
      Schema.Attribute.Required;
    sourcePath: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    staffNote: Schema.Attribute.Text &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2000;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSpacePageSpacePage extends Struct.SingleTypeSchema {
  collectionName: 'space_pages';
  info: {
    description: 'Fixed editorial structure for restaurant spaces';
    displayName: 'Trang kh\u00F4ng gian';
    pluralName: 'space-pages';
    singularName: 'space-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    amenities: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    amenitiesHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    closingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    closingSecondaryLink: Schema.Attribute.Component<'shared.link', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    eventBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    eventHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    eventImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    eventLink: Schema.Attribute.Component<'shared.link', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    experienceBody: Schema.Attribute.Text &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 800;
      }>;
    experienceHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    experienceImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    galleryHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    galleryItems: Schema.Attribute.Relation<
      'oneToMany',
      'api::gallery-item.gallery-item'
    >;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    introBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    introHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    introImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::space-page.space-page'
    >;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    videoThumbs: Schema.Attribute.Component<'shared.image', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    videoUrl: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2048;
      }>;
    zones: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
  };
}

export interface ApiStoryPageStoryPage extends Struct.SingleTypeSchema {
  collectionName: 'story_pages';
  info: {
    description: 'Fixed editorial structure for the Salanca story';
    displayName: 'Trang c\u00E2u chuy\u1EC7n';
    pluralName: 'story-pages';
    singularName: 'story-page';
  };
  options: {
    draftAndPublish: true;
  };
  pluginOptions: {
    i18n: {
      localized: true;
    };
  };
  attributes: {
    closingCta: Schema.Attribute.Component<'shared.cta', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    craftBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    craftHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    craftImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    hero: Schema.Attribute.Component<'shared.hero', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    ingredients: Schema.Attribute.Component<'shared.editorial-card', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    ingredientsHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    locale: Schema.Attribute.String;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::story-page.story-page'
    >;
    originBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    originHeading: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    originImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    philosophyBody: Schema.Attribute.Blocks &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    philosophyHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    philosophyImage: Schema.Attribute.Component<'shared.image', false> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    publishedAt: Schema.Attribute.DateTime;
    seo: Schema.Attribute.Component<'shared.seo', false> &
      Schema.Attribute.Required &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    timelineEntries: Schema.Attribute.Component<'shared.timeline-entry', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    timelineHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    values: Schema.Attribute.Component<'shared.step', true> &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }>;
    valuesHeading: Schema.Attribute.String &
      Schema.Attribute.SetPluginOptions<{
        i18n: {
          localized: true;
        };
      }> &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingAdjustmentAllocation
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_adjustment_allocation';
  info: {
    displayName: 'Ph\u00E2n b\u1ED5 \u0111i\u1EC1u ch\u1EC9nh';
    pluralName: 'adjustment-allocations';
    singularName: 'adjustment-allocation';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    adjustment: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.order-adjustment'
    >;
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    line: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order-line'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.adjustment-allocation'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    weight: Schema.Attribute.BigInteger & Schema.Attribute.Required;
  };
}

export interface PluginOrderingAdminChangeLog
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_admin_change_log';
  info: {
    displayName: 'Nh\u1EADt k\u00FD thay \u0111\u1ED5i';
    pluralName: 'admin-change-logs';
    singularName: 'admin-change-log';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    actorRef: Schema.Attribute.String & Schema.Attribute.Required;
    changes: Schema.Attribute.JSON & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entityId: Schema.Attribute.String & Schema.Attribute.Required;
    entityType: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.admin-change-log'
    > &
      Schema.Attribute.Private;
    locationRef: Schema.Attribute.String;
    occurredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingBranch extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_branch';
  info: {
    displayName: 'Chi nh\u00E1nh';
    pluralName: 'branches';
    singularName: 'branch';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    address: Schema.Attribute.JSON;
    cashRounding: Schema.Attribute.JSON;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.String;
    fulfillment: Schema.Attribute.JSON;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.branch'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    onlineOrdering: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    orders: Schema.Attribute.Relation<'oneToMany', 'plugin::ordering.order'>;
    phone: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    tax: Schema.Attribute.JSON;
    timezone: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'Asia/Ho_Chi_Minh'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogAvailabilityWindow
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_availability_window';
  info: {
    displayName: 'Khung gi\u1EDD b\u00E1n';
    pluralName: 'catalog-availability-windows';
    singularName: 'catalog-availability-window';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    category: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-category'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    daysOfWeek: Schema.Attribute.JSON;
    endTime: Schema.Attribute.Time & Schema.Attribute.Required;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-availability-window'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    product: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-product'
    >;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    startTime: Schema.Attribute.Time & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    validFrom: Schema.Attribute.DateTime;
    validTo: Schema.Attribute.DateTime;
  };
}

export interface PluginOrderingCatalogCategory
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_category';
  info: {
    displayName: 'Danh m\u1EE5c b\u00E1n h\u00E0ng';
    pluralName: 'catalog-categories';
    singularName: 'catalog-category';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    availabilityWindows: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-availability-window'
    >;
    children: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-category'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    image: Schema.Attribute.Media<'images'>;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    isInternal: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-category'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    parent: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-category'
    >;
    products: Schema.Attribute.Relation<
      'manyToMany',
      'plugin::ordering.catalog-product'
    >;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    slug: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogLocationState
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_location_state';
  info: {
    displayName: 'Tr\u1EA1ng th\u00E1i b\u00E1n theo chi nh\u00E1nh';
    pluralName: 'catalog-location-states';
    singularName: 'catalog-location-state';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entityDocumentId: Schema.Attribute.String & Schema.Attribute.Required;
    entityType: Schema.Attribute.Enumeration<
      ['product', 'variant', 'modifier']
    > &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-location-state'
    > &
      Schema.Attribute.Private;
    locationRef: Schema.Attribute.String & Schema.Attribute.Required;
    outOfStockUntil: Schema.Attribute.DateTime;
    publishedAt: Schema.Attribute.DateTime;
    selling: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    toggledAt: Schema.Attribute.DateTime;
    toggledBy: Schema.Attribute.String;
    untilKind: Schema.Attribute.Enumeration<
      ['end-of-business-day', 'specific-time']
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogModifier
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_modifier';
  info: {
    displayName: 'T\u00F9y ch\u1ECDn';
    pluralName: 'catalog-modifiers';
    singularName: 'catalog-modifier';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    group: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-modifier-group'
    > &
      Schema.Attribute.Required;
    inventoryRef: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-modifier'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    priceDelta: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    trackInventory: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogModifierGroup
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_modifier_group';
  info: {
    displayName: 'Nh\u00F3m t\u00F9y ch\u1ECDn';
    pluralName: 'catalog-modifier-groups';
    singularName: 'catalog-modifier-group';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    freeQuantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-modifier-group'
    > &
      Schema.Attribute.Private;
    maxQuantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    minQuantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    modifiers: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-modifier'
    >;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    selectionType: Schema.Attribute.Enumeration<
      ['single', 'multiple', 'quantity', 'text']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'multiple'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogPrice
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_price';
  info: {
    displayName: 'Gi\u00E1';
    pluralName: 'catalog-prices';
    singularName: 'catalog-price';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    compareAtAmount: Schema.Attribute.BigInteger;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'VND'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-price'
    > &
      Schema.Attribute.Private;
    minQuantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    priority: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    rules: Schema.Attribute.JSON;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    validFrom: Schema.Attribute.DateTime;
    validTo: Schema.Attribute.DateTime;
    variant: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-variant'
    > &
      Schema.Attribute.Required;
  };
}

export interface PluginOrderingCatalogProduct
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_product';
  info: {
    displayName: 'S\u1EA3n ph\u1EA9m b\u00E1n online';
    pluralName: 'catalog-products';
    singularName: 'catalog-product';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    availabilityWindows: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-availability-window'
    >;
    bundleSlots: Schema.Attribute.JSON;
    categories: Schema.Attribute.Relation<
      'manyToMany',
      'plugin::ordering.catalog-category'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    fulfillmentKinds: Schema.Attribute.JSON;
    image: Schema.Attribute.Media<'images'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-product'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    minQuantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    modifierGroups: Schema.Attribute.JSON;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    productType: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'food'>;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    sellOnline: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    slug: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    status: Schema.Attribute.Enumeration<['draft', 'active', 'archived']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'draft'>;
    taxGroupRef: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    variants: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-variant'
    >;
  };
}

export interface PluginOrderingCatalogSlug extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_slug';
  info: {
    displayName: 'Slug catalog';
    pluralName: 'catalog-slugs';
    singularName: 'catalog-slug';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entityDocumentId: Schema.Attribute.String & Schema.Attribute.Required;
    entityType: Schema.Attribute.Enumeration<
      ['catalog-category', 'catalog-product']
    > &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-slug'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    slug: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingCatalogVariant
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_catalog_variant';
  info: {
    displayName: 'Bi\u1EBFn th\u1EC3';
    pluralName: 'catalog-variants';
    singularName: 'catalog-variant';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: true;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    attributes: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    inventoryRef: Schema.Attribute.String;
    isDefault: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-variant'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<'plugin::ordering.localized-text'>;
    prices: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.catalog-price'
    >;
    product: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.catalog-product'
    > &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    rank: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    sku: Schema.Attribute.String;
    trackInventory: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingFulfillment extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_fulfillment';
  info: {
    displayName: '\u0110\u1EE3t giao nh\u1EADn';
    pluralName: 'fulfillments';
    singularName: 'fulfillment';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    addressSnapshot: Schema.Attribute.JSON;
    assigneeRef: Schema.Attribute.String;
    canceledAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveredAt: Schema.Attribute.DateTime;
    group: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.fulfillment-group'
    >;
    lines: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment-line'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    packedAt: Schema.Attribute.DateTime;
    providerCode: Schema.Attribute.String & Schema.Attribute.Required;
    providerReference: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    shippedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.String & Schema.Attribute.Required;
    trackingNumber: Schema.Attribute.String;
    trackingUrl: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingFulfillmentGroup
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_fulfillment_group';
  info: {
    displayName: 'Nh\u00F3m giao nh\u1EADn';
    pluralName: 'fulfillment-groups';
    singularName: 'fulfillment-group';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    fulfillmentAmount: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    fulfillments: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment'
    >;
    lines: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-line'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment-group'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    publishedAt: Schema.Attribute.DateTime;
    receiveMethod: Schema.Attribute.JSON & Schema.Attribute.Required;
    status: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflowName: Schema.Attribute.String & Schema.Attribute.Required;
    workflowVersion: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface PluginOrderingFulfillmentLine
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_fulfillment_line';
  info: {
    displayName: 'D\u00F2ng giao nh\u1EADn';
    pluralName: 'fulfillment-lines';
    singularName: 'fulfillment-line';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    fulfillment: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.fulfillment'
    >;
    line: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order-line'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment-line'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    quantity: Schema.Attribute.Integer & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingHold extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_hold';
  info: {
    displayName: 'Gi\u1EEF ch\u1ED7';
    pluralName: 'holds';
    singularName: 'hold';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    group: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.fulfillment-group'
    >;
    line: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order-line'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.hold'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    publishedAt: Schema.Attribute.DateTime;
    quantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<1>;
    releasedAt: Schema.Attribute.DateTime;
    releaseReason: Schema.Attribute.String;
    resourceRef: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingIdempotencyKey
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_idempotency_key';
  info: {
    displayName: 'Kh\u00F3a idempotency';
    pluralName: 'idempotency-keys';
    singularName: 'idempotency-key';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    key: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.idempotency-key'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    requestHash: Schema.Attribute.String & Schema.Attribute.Required;
    responseRef: Schema.Attribute.String;
    responseSnapshot: Schema.Attribute.JSON;
    scope: Schema.Attribute.String & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<['in-progress', 'completed']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'in-progress'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOpsAlert extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_ops_alert';
  info: {
    displayName: 'C\u1EA3nh b\u00E1o v\u1EADn h\u00E0nh';
    pluralName: 'ops-alerts';
    singularName: 'ops-alert';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    acknowledgedAt: Schema.Attribute.DateTime;
    acknowledgedBy: Schema.Attribute.String;
    aggregateRef: Schema.Attribute.String;
    alertCode: Schema.Attribute.String & Schema.Attribute.Required;
    count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<1>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dedupeKey: Schema.Attribute.String & Schema.Attribute.Required;
    firstSeenAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    lastSeenAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.ops-alert'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    resolvedAt: Schema.Attribute.DateTime;
    severity: Schema.Attribute.Enumeration<['info', 'warning', 'critical']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'warning'>;
    status: Schema.Attribute.Enumeration<['open', 'acknowledged', 'resolved']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'open'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOrder extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_order';
  info: {
    displayName: '\u0110\u01A1n h\u00E0ng';
    pluralName: 'orders';
    singularName: 'order';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    adjustmentAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    adjustments: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-adjustment'
    >;
    branch: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.branch'>;
    branchSnapshot: Schema.Attribute.JSON;
    businessDate: Schema.Attribute.Date & Schema.Attribute.Required;
    cartHash: Schema.Attribute.String;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    consentSnapshot: Schema.Attribute.JSON & Schema.Attribute.Required;
    contactSnapshot: Schema.Attribute.JSON & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'VND'>;
    customerNote: Schema.Attribute.Text;
    customerRef: Schema.Attribute.String;
    draftConfirmedAt: Schema.Attribute.DateTime;
    fulfillmentAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    fulfillmentGroups: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment-group'
    >;
    fulfillments: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.fulfillment'
    >;
    fulfillmentStatus: Schema.Attribute.Enumeration<
      ['not-started', 'in-progress', 'partially-done', 'done', 'canceled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'not-started'>;
    holds: Schema.Attribute.Relation<'oneToMany', 'plugin::ordering.hold'>;
    lines: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-line'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order'
    > &
      Schema.Attribute.Private;
    locationRef: Schema.Attribute.String & Schema.Attribute.Required;
    origin: Schema.Attribute.JSON & Schema.Attribute.Required;
    payments: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.payment'
    >;
    paymentStatus: Schema.Attribute.Enumeration<
      [
        'unpaid',
        'partially-paid',
        'paid',
        'overpaid',
        'partially-refunded',
        'refunded',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'unpaid'>;
    placedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    publicTokenHash: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    receiveMethod: Schema.Attribute.JSON & Schema.Attribute.Required;
    refunds: Schema.Attribute.Relation<'oneToMany', 'plugin::ordering.refund'>;
    status: Schema.Attribute.Enumeration<
      ['draft', 'open', 'completed', 'canceled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'open'>;
    subtotalAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    taxAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    timeline: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-event'
    >;
    totalAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOrderAdjustment
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_order_adjustment';
  info: {
    displayName: '\u0110i\u1EC1u ch\u1EC9nh \u0111\u01A1n';
    pluralName: 'order-adjustments';
    singularName: 'order-adjustment';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    allocations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.adjustment-allocation'
    >;
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    code: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    kind: Schema.Attribute.Enumeration<['discount', 'fee', 'rounding']> &
      Schema.Attribute.Required;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-adjustment'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    priority: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    ruleSnapshot: Schema.Attribute.JSON;
    sourceRef: Schema.Attribute.String;
    taxable: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOrderEvent extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_order_event';
  info: {
    displayName: 'D\u00F2ng th\u1EDDi gian \u0111\u01A1n';
    pluralName: 'order-events';
    singularName: 'order-event';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    actorRef: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    isPublic: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-event'
    > &
      Schema.Attribute.Private;
    occurredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    payload: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOrderJobLock
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_order_job_lock';
  info: {
    displayName: 'Kh\u00F3a job \u0111\u01A1n h\u00E0ng';
    pluralName: 'order-job-locks';
    singularName: 'order-job-lock';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    attempts: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime;
    jobName: Schema.Attribute.String & Schema.Attribute.Required;
    lastError: Schema.Attribute.Text;
    lastSuccessAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-job-lock'
    > &
      Schema.Attribute.Private;
    lockedAt: Schema.Attribute.DateTime;
    owner: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    shardKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'default'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingOrderLine extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_order_line';
  info: {
    displayName: 'D\u00F2ng h\u00E0ng';
    pluralName: 'order-lines';
    singularName: 'order-line';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    allocations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.adjustment-allocation'
    >;
    baseAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    canceledQuantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    categoriesSnapshot: Schema.Attribute.JSON;
    componentsSnapshot: Schema.Attribute.JSON;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String & Schema.Attribute.Required;
    descriptionSnapshot: Schema.Attribute.Text;
    discountAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    feeAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    fulfilledQuantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    fulfillmentGroup: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::ordering.fulfillment-group'
    >;
    imageUrlSnapshot: Schema.Attribute.String;
    lineTotalAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.order-line'
    > &
      Schema.Attribute.Private;
    note: Schema.Attribute.Text;
    optionAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'> &
      Schema.Attribute.Required;
    position: Schema.Attribute.Integer & Schema.Attribute.Required;
    productType: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    quantity: Schema.Attribute.Integer & Schema.Attribute.Required;
    refundLines: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.refund-line'
    >;
    returnedQuantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    roundingDelta: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    selectedOptionsSnapshot: Schema.Attribute.JSON;
    sellableUid: Schema.Attribute.String & Schema.Attribute.Required;
    sku: Schema.Attribute.String;
    sourceDocumentId: Schema.Attribute.String;
    sourceUid: Schema.Attribute.String;
    taxAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    taxSnapshot: Schema.Attribute.JSON;
    titleSnapshot: Schema.Attribute.String & Schema.Attribute.Required;
    unitAmount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    variantUid: Schema.Attribute.String;
  };
}

export interface PluginOrderingOutbox extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_outbox';
  info: {
    displayName: 'Outbox';
    pluralName: 'outboxes';
    singularName: 'outbox';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    aggregateId: Schema.Attribute.String & Schema.Attribute.Required;
    aggregateType: Schema.Attribute.String & Schema.Attribute.Required;
    attempts: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    availableAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveredAt: Schema.Attribute.DateTime;
    failedAt: Schema.Attribute.DateTime;
    lastError: Schema.Attribute.Text;
    leaseUntil: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.outbox'
    > &
      Schema.Attribute.Private;
    lockedAt: Schema.Attribute.DateTime;
    lockedBy: Schema.Attribute.String;
    occurredAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    payload: Schema.Attribute.JSON & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Required;
    uniqueKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingPayment extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_payment';
  info: {
    displayName: 'Thanh to\u00E1n';
    pluralName: 'payments';
    singularName: 'payment';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    actorRef: Schema.Attribute.String;
    businessDate: Schema.Attribute.Date;
    capturedAmount: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    capturedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String & Schema.Attribute.Required;
    events: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.payment-event'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.payment'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    providerCode: Schema.Attribute.String & Schema.Attribute.Required;
    providerReference: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    refundedAmount: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    refunds: Schema.Attribute.Relation<'oneToMany', 'plugin::ordering.refund'>;
    requestedAmount: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    status: Schema.Attribute.Enumeration<
      ['pending', 'authorized', 'captured', 'failed', 'cancelled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingPaymentEvent
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_payment_event';
  info: {
    displayName: 'S\u1EF1 ki\u1EC7n thanh to\u00E1n';
    pluralName: 'payment-events';
    singularName: 'payment-event';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String & Schema.Attribute.Required;
    kind: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.payment-event'
    > &
      Schema.Attribute.Private;
    payment: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.payment'>;
    providerCode: Schema.Attribute.String & Schema.Attribute.Required;
    providerTransactionId: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    rawPayload: Schema.Attribute.JSON;
    receivedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    reviewedAt: Schema.Attribute.DateTime;
    reviewedBy: Schema.Attribute.String;
    reviewReason: Schema.Attribute.String;
    reviewStatus: Schema.Attribute.Enumeration<
      [
        'auto-matched',
        'needs-review',
        'matched-manually',
        'refund-due',
        'ignored',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'auto-matched'>;
    transferType: Schema.Attribute.Enumeration<['in', 'out']>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingRefund extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_refund';
  info: {
    displayName: 'Ho\u00E0n ti\u1EC1n';
    pluralName: 'refunds';
    singularName: 'refund';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    actorRef: Schema.Attribute.String;
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String & Schema.Attribute.Required;
    idempotencyKey: Schema.Attribute.String;
    lines: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.refund-line'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.refund'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order'>;
    payment: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.payment'>;
    providerReference: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    reason: Schema.Attribute.Text & Schema.Attribute.Required;
    settledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<['pending', 'settled', 'failed']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingRefundLine extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_refund_line';
  info: {
    displayName: 'D\u00F2ng ho\u00E0n ti\u1EC1n';
    pluralName: 'refund-lines';
    singularName: 'refund-line';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    amount: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    line: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.order-line'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.refund-line'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    quantity: Schema.Attribute.Integer & Schema.Attribute.Required;
    refund: Schema.Attribute.Relation<'manyToOne', 'plugin::ordering.refund'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginOrderingStaffLocationScope
  extends Struct.CollectionTypeSchema {
  collectionName: 'plugins_ordering_staff_location_scope';
  info: {
    displayName: 'Ph\u1EA1m vi chi nh\u00E1nh';
    pluralName: 'staff-location-scopes';
    singularName: 'staff-location-scope';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    adminUserId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    allLocations: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::ordering.staff-location-scope'
    > &
      Schema.Attribute.Private;
    locationRefs: Schema.Attribute.JSON & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::audit-event.audit-event': ApiAuditEventAuditEvent;
      'api::booking-page.booking-page': ApiBookingPageBookingPage;
      'api::campaign-page.campaign-page': ApiCampaignPageCampaignPage;
      'api::campaign.campaign': ApiCampaignCampaign;
      'api::contact-message.contact-message': ApiContactMessageContactMessage;
      'api::contact-page.contact-page': ApiContactPageContactPage;
      'api::experience-page.experience-page': ApiExperiencePageExperiencePage;
      'api::footer-setting.footer-setting': ApiFooterSettingFooterSetting;
      'api::gallery-item.gallery-item': ApiGalleryItemGalleryItem;
      'api::global-setting.global-setting': ApiGlobalSettingGlobalSetting;
      'api::header-setting.header-setting': ApiHeaderSettingHeaderSetting;
      'api::home-page.home-page': ApiHomePageHomePage;
      'api::location.location': ApiLocationLocation;
      'api::menu-category.menu-category': ApiMenuCategoryMenuCategory;
      'api::menu-item.menu-item': ApiMenuItemMenuItem;
      'api::menu-package.menu-package': ApiMenuPackageMenuPackage;
      'api::menu-page.menu-page': ApiMenuPageMenuPage;
      'api::reservation-request.reservation-request': ApiReservationRequestReservationRequest;
      'api::space-page.space-page': ApiSpacePageSpacePage;
      'api::story-page.story-page': ApiStoryPageStoryPage;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::ordering.adjustment-allocation': PluginOrderingAdjustmentAllocation;
      'plugin::ordering.admin-change-log': PluginOrderingAdminChangeLog;
      'plugin::ordering.branch': PluginOrderingBranch;
      'plugin::ordering.catalog-availability-window': PluginOrderingCatalogAvailabilityWindow;
      'plugin::ordering.catalog-category': PluginOrderingCatalogCategory;
      'plugin::ordering.catalog-location-state': PluginOrderingCatalogLocationState;
      'plugin::ordering.catalog-modifier': PluginOrderingCatalogModifier;
      'plugin::ordering.catalog-modifier-group': PluginOrderingCatalogModifierGroup;
      'plugin::ordering.catalog-price': PluginOrderingCatalogPrice;
      'plugin::ordering.catalog-product': PluginOrderingCatalogProduct;
      'plugin::ordering.catalog-slug': PluginOrderingCatalogSlug;
      'plugin::ordering.catalog-variant': PluginOrderingCatalogVariant;
      'plugin::ordering.fulfillment': PluginOrderingFulfillment;
      'plugin::ordering.fulfillment-group': PluginOrderingFulfillmentGroup;
      'plugin::ordering.fulfillment-line': PluginOrderingFulfillmentLine;
      'plugin::ordering.hold': PluginOrderingHold;
      'plugin::ordering.idempotency-key': PluginOrderingIdempotencyKey;
      'plugin::ordering.ops-alert': PluginOrderingOpsAlert;
      'plugin::ordering.order': PluginOrderingOrder;
      'plugin::ordering.order-adjustment': PluginOrderingOrderAdjustment;
      'plugin::ordering.order-event': PluginOrderingOrderEvent;
      'plugin::ordering.order-job-lock': PluginOrderingOrderJobLock;
      'plugin::ordering.order-line': PluginOrderingOrderLine;
      'plugin::ordering.outbox': PluginOrderingOutbox;
      'plugin::ordering.payment': PluginOrderingPayment;
      'plugin::ordering.payment-event': PluginOrderingPaymentEvent;
      'plugin::ordering.refund': PluginOrderingRefund;
      'plugin::ordering.refund-line': PluginOrderingRefundLine;
      'plugin::ordering.staff-location-scope': PluginOrderingStaffLocationScope;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}
