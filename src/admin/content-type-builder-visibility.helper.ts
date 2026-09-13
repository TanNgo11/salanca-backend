import type { StrapiApp } from '@strapi/strapi/admin';

export const CONTENT_TYPE_BUILDER_ADMIN_PATH = 'plugins/content-type-builder';

/**
 * Removes the Content-Type Builder from the Admin application for every role,
 * including Super Admin. Strapi registers core plugins before the project's
 * custom `register` callback, so both entries are present when this runs.
 */
export const hideContentTypeBuilderAdminSurface = (app: StrapiApp): void => {
  const menuIndex = app.router.menu.findIndex(
    ({ to }) => to === CONTENT_TYPE_BUILDER_ADMIN_PATH,
  );

  if (menuIndex >= 0) {
    app.router.menu.splice(menuIndex, 1);
  }

  app.router.addRoute((routes) =>
    routes.filter(({ path }) => path !== `${CONTENT_TYPE_BUILDER_ADMIN_PATH}/*`),
  );
};
