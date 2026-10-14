import { describe, expect, it } from 'vitest';

import routes from './index';

type Route = { method: string; path: string };

/** Secrets travel in headers or bodies: the access log records the URL path. */
describe('ordering routes', () => {
  it('never put a secret in a path parameter', () => {
    const all = Object.values(routes as unknown as Record<string, { routes: Route[] }>).flatMap((group) => group.routes);
    expect(all.length).toBeGreaterThan(50);
    const offenders = all.filter((route) => /:(token|secret|key|otp|password|apiKey)\b/i.test(route.path));
    expect(offenders).toEqual([]);
  });

  it('resolves the table QR secret over POST', () => {
    const all = Object.values(routes as unknown as Record<string, { routes: Route[] }>).flatMap((group) => group.routes);
    expect(all).toContainEqual(expect.objectContaining({ method: 'POST', path: '/tables/resolve' }));
    expect(all.some((route) => route.method === 'GET' && /^\/tables\/:[a-z]+$/.test(route.path))).toBe(false);
  });
});
