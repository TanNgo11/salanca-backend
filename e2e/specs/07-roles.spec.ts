import { test, expect, ui } from '../helpers/fixtures';
import { todayVN, type Role } from '../helpers/env';

const d = todayVN();
const matrix: [Role, string, string, 'allow' | 'deny', unknown?][] = [
  ['courier', 'GET', '/settings', 'deny'],
  ['courier', 'GET', `/reports/sales?from=${d}&to=${d}`, 'deny'],
  ['accountant', 'GET', `/reports/sales?from=${d}&to=${d}`, 'allow'],
  ['accountant', 'GET', `/orders/export?from=${d}&to=${d}`, 'allow'],
  ['accountant', 'POST', '/orders/1/transition', 'deny', { to: 'ready' }],
  ['manager', 'GET', '/ops/status', 'deny'],
  ['lan', 'GET', '/notification-log', 'deny'],
  ['admin', 'GET', '/notification-log', 'allow'],
  ['chain', 'GET', '/loyalty/settings', 'deny'],
  ['phoneCourier', 'GET', '/customers', 'deny'],
  ['lan', 'GET', '/data-requests', 'deny'],
];

test.describe('Role permissions (API)', () => {
  for (const [role, m, p, exp, body] of matrix) {
    test(`${role} ${m} ${p.split('?')[0]} → ${exp}`, async ({ apiAs }) => {
      const a = await apiAs(role); test.skip(!a, `no credentials for ${role}`);
      const r = await a!.call(m, p, body);
      if (exp === 'deny') expect(r.status).toBe(403); else expect(r.status).toBeLessThan(400);
    });
  }
  test('branch scope: lan-q1 sees no Q3 orders', async ({ apiAs }) => {
    const a = await apiAs('lan'); test.skip(!a);
    const r = (await a!.get('/orders?tab=all&branch=Q3')).body;
    expect((r.results ?? []).some((x: any) => x.locationRef === 'Q3')).toBe(false);
  });
  test('Q1 manager cannot grant Q3 or all-branches', async ({ apiAs, api }) => {
    const a = await apiAs('lan'); test.skip(!a);
    const courier = (await api.get('/staff-scopes')).body.results.find((s: any) => /giao-q1/.test(s.name));
    test.skip(!courier);
    expect((await a!.put(`/staff-scopes/${courier.adminUserId}`, { allLocations: false, locationRefs: ['Q1', 'Q3'] })).status).toBe(403);
    expect((await a!.put(`/staff-scopes/${courier.adminUserId}`, { allLocations: true, locationRefs: [] })).status).toBe(403);
  });
});

test.describe('Role visibility (UI)', () => {
  for (const [role, sub] of [['courier', 'staff'], ['courier', 'settings-page'], ['accountant', 'staff'], ['accountant', 'loyalty'], ['lan', 'data-requests']] as const) {
    test(`${role} sees "no permission" on ${sub}`, async ({ pageAs }) => {
      const page = await pageAs(role); test.skip(!page);
      if (sub === 'settings-page') await page!.goto('/admin/settings/ordering'); else await ui.open(page!, sub);
      await expect(page!.getByText('Bạn không có quyền truy cập nội dung này')).toBeVisible();
    });
  }
  test('accountant does not see configuration menu or accept buttons', async ({ pageAs }) => {
    const page = await pageAs('accountant'); test.skip(!page);
    await ui.open(page!, 'orders');
    await expect(page!.getByRole('link', { name: 'Chi nhánh' })).toHaveCount(0);
    await expect(page!.getByRole('button', { name: 'Nhận', exact: true })).toHaveCount(0);
  });
});
