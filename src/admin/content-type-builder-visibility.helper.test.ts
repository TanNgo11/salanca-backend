import type { StrapiApp } from '@strapi/strapi/admin';
import type { RouteObject } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  CONTENT_TYPE_BUILDER_ADMIN_PATH,
  hideContentTypeBuilderAdminSurface,
} from './content-type-builder-visibility.helper';

const createApp = () => {
  const menu = [
    { to: 'plugins/content-manager' },
    { to: CONTENT_TYPE_BUILDER_ADMIN_PATH },
    { to: 'plugins/upload' },
  ];
  let routes: RouteObject[] = [
    { path: 'plugins/content-manager/*' },
    { path: `${CONTENT_TYPE_BUILDER_ADMIN_PATH}/*` },
    { path: 'plugins/upload/*' },
  ];
  const addRoute = vi.fn((reducer: (currentRoutes: RouteObject[]) => RouteObject[]) => {
    routes = reducer(routes);
  });
  const app = {
    router: {
      menu,
      addRoute,
    },
  } as unknown as StrapiApp;

  return {
    app,
    menu,
    getRoutes: () => routes,
  };
};

describe('hideContentTypeBuilderAdminSurface', () => {
  it('removes both the menu link and direct Admin route', () => {
    const { app, menu, getRoutes } = createApp();

    hideContentTypeBuilderAdminSurface(app);

    expect(menu.map(({ to }) => to)).toEqual(['plugins/content-manager', 'plugins/upload']);
    expect(getRoutes().map(({ path }) => path)).toEqual([
      'plugins/content-manager/*',
      'plugins/upload/*',
    ]);
  });

  it('is safe to run again when the menu link and route are already absent', () => {
    const { app, menu, getRoutes } = createApp();

    hideContentTypeBuilderAdminSurface(app);
    hideContentTypeBuilderAdminSurface(app);

    expect(menu).toHaveLength(2);
    expect(getRoutes()).toHaveLength(2);
  });
});
