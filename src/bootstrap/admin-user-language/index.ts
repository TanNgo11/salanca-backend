import type { Core } from '@strapi/strapi';

import {
  ADMIN_USER_LANGUAGE_FIELD,
  DEFAULT_ADMIN_INTERFACE_LANGUAGE,
  shouldApplyDefaultAdminLanguage,
} from './admin-user-language.helper';

const ADMIN_USER_UID = 'admin::user';

type AdminUserWriteEvent = Readonly<{
  params?: { data?: Record<string, unknown> };
}>;

/**
 * Defaults the interface language of every admin account created from now on,
 * whether it is added in Cài đặt > Người dùng or created by an invitation, so
 * the account opens the Admin in Vietnamese without touching Profile.
 */
export const registerAdminUserLanguageDefault = (strapi: Core.Strapi): void => {
  strapi.db.lifecycles.subscribe({
    models: [ADMIN_USER_UID],
    beforeCreate(event: AdminUserWriteEvent) {
      const data = event.params?.data;

      if (!data || !shouldApplyDefaultAdminLanguage(data[ADMIN_USER_LANGUAGE_FIELD])) {
        return;
      }

      data[ADMIN_USER_LANGUAGE_FIELD] = DEFAULT_ADMIN_INTERFACE_LANGUAGE;
    },
  });
};

/**
 * Existing accounts that never chose a language are still on the English
 * fallback. They are moved once; an account that already holds a language,
 * including `en`, is left alone.
 */
export const backfillAdminUserLanguage = async (strapi: Core.Strapi): Promise<void> => {
  const updatedCount = await strapi.db.query(ADMIN_USER_UID).updateMany({
    where: { [ADMIN_USER_LANGUAGE_FIELD]: { $null: true } },
    data: { [ADMIN_USER_LANGUAGE_FIELD]: DEFAULT_ADMIN_INTERFACE_LANGUAGE },
  });

  const count =
    typeof updatedCount === 'object' && updatedCount !== null && 'count' in updatedCount
      ? Number(updatedCount.count)
      : 0;

  if (count > 0) {
    strapi.log.info(
      `Defaulted the Admin interface language to "${DEFAULT_ADMIN_INTERFACE_LANGUAGE}" for ${count} administrator(s).`,
    );
  }
};
