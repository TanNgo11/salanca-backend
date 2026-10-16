import { describe, expect, it } from 'vitest';

import routes from './index';

describe('seo-toolkit admin routes', () => {
  it('exposes exactly one admin route guarded by authentication and the run permission', () => {
    expect(routes.admin.type).toBe('admin');
    expect(routes.admin.routes).toHaveLength(1);

    const [route] = routes.admin.routes;
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/audit/run');
    expect(route.handler).toBe('audit.run');
    expect(route.config.policies).toEqual([
      'admin::isAuthenticatedAdmin',
      {
        name: 'admin::hasPermissions',
        config: { actions: ['plugin::seo-toolkit.audit.run'] },
      },
    ]);
  });
});
