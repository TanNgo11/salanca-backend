export enum ApiNotificationSettingsPermission {
  Manage = 'admin::notification-settings.manage',
}

export enum ApiNotificationSettingsRoute {
  Settings = '/notification-settings',
  Test = '/notification-settings/test/:kind',
}

/** One test email per kind per process every 30 s. */
export const NOTIFICATION_TEST_COOLDOWN_MS = 30_000;
