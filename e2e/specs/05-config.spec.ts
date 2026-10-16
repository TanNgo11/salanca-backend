import { test, expect, ui } from '../helpers/fixtures';
import { uid } from '../helpers/env';

const rowOf = (page: import('@playwright/test').Page, text: string) => page.getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) }).last();

test.describe('Categories CRUD', () => {
  test('create → edit → child → delete child → delete parent (reload-persistent)', async ({ page, api }) => {
    const n = `DM E2E ${uid()}`;
    await ui.open(page, 'categories');
    await ui.btn(page, 'Thêm danh mục').click();
    await page.getByPlaceholder('Vietnamese (vi)').first().fill(n);
    await page.getByRole('button', { name: /^(Lưu|Tạo|Thêm)$/ }).last().click();
    await page.reload(); await expect(page.getByText(n, { exact: true })).toBeVisible();
    await rowOf(page, n).getByRole('button', { name: 'Sửa' }).click();
    await page.getByPlaceholder('Vietnamese (vi)').first().fill(`${n} sửa`);
    await page.getByRole('button', { name: /^Lưu/ }).last().click();
    await page.reload(); await expect(page.getByText(`${n} sửa`, { exact: true })).toBeVisible();
    await rowOf(page, `${n} sửa`).getByRole('button', { name: '+ Con' }).click();
    await page.getByPlaceholder('Vietnamese (vi)').first().fill(`${n} con`);
    await page.getByRole('button', { name: /^(Lưu|Tạo|Thêm)$/ }).last().click();
    await page.reload(); await expect(page.getByText(`${n} con`, { exact: true })).toBeVisible();
    for (const t of [`${n} con`, `${n} sửa`]) {
      await rowOf(page, t).getByRole('button', { name: 'Xóa' }).last().click();
      if (await ui.dialog(page).count()) await ui.dialog(page).getByRole('button', { name: /Xóa|Xác nhận/ }).last().click();
      await page.reload(); await expect(page.getByText(t, { exact: true })).toHaveCount(0);
    }
    expect(JSON.stringify((await api.get('/categories?locale=vi')).body)).not.toContain(n);
  });
});

test.describe('Branches', () => {
  test('create + edit branch (UI) persists; tabs render', async ({ page, api }) => {
    const code = `E${uid()}`.toUpperCase().slice(0, 10); const name = `CN E2E ${code}`;
    await page.goto('/admin/plugins/ordering/branches/new');
    await page.getByLabel(/^Mã/).fill(code); await page.getByLabel('Tên (VI)').fill(name);
    await page.getByLabel('Email chi nhánh').fill(`${code.toLowerCase()}@example.invalid`);
    await ui.btn(page, 'Lưu').click();
    await expect.poll(async () => (await api.get('/branches')).body.results.some((b: any) => b.code === code)).toBe(true);
    await ui.open(page, 'branches'); await page.getByText(name).first().click();
    await page.getByLabel('Tên (VI)').fill(`${name} sửa`); await ui.btn(page, 'Lưu').click();
    await page.reload(); await expect(page.getByLabel('Tên (VI)')).toHaveValue(`${name} sửa`);
    for (const tab of ['Giờ mở', 'Tự lấy', 'Giao tận nơi', 'Nhà hàng']) await page.getByRole('tab', { name: tab }).click();
  });
});

test.describe('Sales settings (/admin/settings/ordering)', () => {
  test('edit field + add reject reason persist after reload', async ({ page, api }) => {
    await page.goto('/admin/settings/ordering');
    const f = page.getByLabel('Số phút lùi khi nhận');
    const old = await f.inputValue();
    await f.fill('5, 15, 25'); await ui.btn(page, 'Lưu').click();
    await page.reload(); await expect(page.getByLabel('Số phút lùi khi nhận')).toHaveValue(/5,\s*15,\s*25/);
    await page.getByLabel('Số phút lùi khi nhận').fill(old || '10, 20, 30'); await ui.btn(page, 'Lưu').click();
    const code = `e2e-${uid()}`;
    const codes = page.getByLabel('Mã', { exact: true });
    await ui.btn(page, 'Thêm lý do').click();
    const vals = await codes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const idx = vals.indexOf('');
    await codes.nth(idx).fill(code); await page.getByLabel('VI', { exact: true }).nth(idx).fill(`Lý do ${code}`);
    await ui.btn(page, 'Lưu').click();
    await expect.poll(async () => JSON.stringify((await api.get('/settings')).body)).toContain(code);
  });
});

test.describe('Staff scope', () => {
  test('add Q3 to courier scope (UI) persists, then revert (API)', async ({ page, api }) => {
    const scopes = (await api.get('/staff-scopes')).body.results;
    const target = scopes.find((s: any) => !s.isSuperAdmin && !s.allLocations && s.locationRefs.length === 1 && s.locationRefs[0] === 'Q1');
    test.skip(!target, 'no single-branch staff in seed');
    await ui.open(page, 'staff');
    await page.getByRole('row').filter({ hasText: target.email }).getByRole('button', { name: 'Sửa' }).click();
    await ui.dialog(page).getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Quận 3' }).click(); await page.keyboard.press('Escape');
    await ui.btn(ui.dialog(page), 'Lưu').click();
    await expect.poll(async () => (await api.get('/staff-scopes')).body.results.find((s: any) => s.adminUserId === target.adminUserId).locationRefs).toContain('Q3');
    expect((await api.put(`/staff-scopes/${target.adminUserId}`, { allLocations: false, locationRefs: ['Q1'] })).status).toBe(200);
  });
});
