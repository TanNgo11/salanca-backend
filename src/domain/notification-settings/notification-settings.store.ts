/**
 * Core-store persistence for staff notification recipients. Kept out of
 * content types so it never reaches the Content API, Content Manager or seed.
 */
import type { Core } from '@strapi/strapi';

import { normalizeStoredSettings, type NotificationSettings } from './notification-settings';

const store = (strapi: Core.Strapi) =>
  strapi.store({ type: 'plugin', name: 'salanca', key: 'notification-settings' });

export const readNotificationSettings = async (
  strapi: Core.Strapi,
): Promise<NotificationSettings | null> => normalizeStoredSettings(await store(strapi).get({}));

export const writeNotificationSettings = async (
  strapi: Core.Strapi,
  settings: NotificationSettings,
): Promise<void> => {
  await store(strapi).set({ value: settings });
};
