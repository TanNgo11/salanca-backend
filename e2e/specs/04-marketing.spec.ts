import { test, expect, ui } from '../helpers/fixtures';
import { uid } from '../helpers/env';

test.describe('Promotions', () => {
  test('create code promotion (UI) → persisted + enabled; edit name', async ({ page, api }) => {
    const name = `E2E KM ${uid()}`;
    await ui.open(page, 'promotions');
    await ui.btn(page, 'Tạo khuyến mãi').click();
    await page.getByLabel('Tên (VI)').fill(name);
    await page.getByLabel(/Giá trị/).fill('10');
    await ui.btn(page, 'Lưu và bật').click();
    await expect.poll(async () => (await api.get('/promotions')).body.items?.find((p: any) => (p.name?.vi ?? p.name) === name)?.active ?? null).toBe(true);
    await ui.open(page, 'promotions');
    await page.getByText(name).first().click();
    await page.getByLabel('Tên (VI)').fill(`${name} sửa`);
    await ui.btn(page, 'Lưu').click();
    await page.reload();
    await expect(page.getByLabel('Tên (VI)')).toHaveValue(`${name} sửa`);
  });
});

test.describe('Gift cards', () => {
  test('issue a gift card (UI) shows code once; card exists via API', async ({ page, api }) => {
    const before = (await api.get('/gift-cards')).body.total ?? 0;
    await ui.open(page, 'gift-cards');
    await ui.btn(page, 'Phát thẻ tặng').click();
    const d = ui.dialog(page);
    await d.getByText('200.000đ', { exact: true }).click();
    await d.getByLabel(/Lý do/).fill('E2E phát thẻ');
    await ui.btn(d, 'Phát thẻ').click();
    await expect(d.getByText(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)).toBeVisible();
    await expect.poll(async () => (await api.get('/gift-cards')).body.total ?? 0).toBeGreaterThan(before);
  });
  test('block / unblock a card (API)', async ({ api }) => {
    const list = (await api.get('/gift-cards')).body; const card = (list.results ?? list.items).find((c: any) => c.status === 'active');
    test.skip(!card, 'no active card');
    expect((await api.post(`/gift-cards/${card.id}/block`, { reason: 'e2e' })).status).toBe(200);
    expect((await api.post(`/gift-cards/${card.id}/unblock`, { reason: 'e2e' })).status).toBe(200);
  });
});

test.describe('Loyalty', () => {
  test('tier create + edit (UI) persists', async ({ page, api }) => {
    const code = `e2e-${uid()}`; const name = `Hạng ${code}`;
    await ui.open(page, 'loyalty');
    await page.getByRole('tab', { name: 'Hạng thành viên' }).click();
    await ui.btn(page, 'Thêm hạng').click();
    const d = ui.dialog(page);
    await d.getByLabel(/Mã hạng/).fill(code); await d.getByLabel('Tên (VI)').fill(name);
    await d.getByLabel(/Chi tiêu 12 tháng/).fill(String(9_000_000 + Math.floor(Math.random() * 9_000) * 1000)); await d.getByLabel(/Hệ số điểm/).fill('200');
    await ui.btn(d, 'Lưu').click();
    await expect.poll(async () => JSON.stringify((await api.get('/loyalty/tiers')).body)).toContain(code);
    await page.reload(); await page.getByRole('tab', { name: 'Hạng thành viên' }).click();
    await page.getByText(name).first().click();
    await ui.dialog(page).getByLabel('Tên (VI)').fill(`${name} sửa`);
    await ui.btn(ui.dialog(page), 'Lưu').click();
    await expect.poll(async () => JSON.stringify((await api.get('/loyalty/tiers')).body)).toContain(`${name} sửa`);
    // cleanup: deactivate so repeated runs don't pile up active tiers (tier thresholds must be unique)
    const t = ((await api.get('/loyalty/tiers')).body.items as any[]).find((x) => x.code === code);
    await api.put(`/loyalty/tiers/${t.id}`, { code: t.code, name: t.name, minSpend12m: t.minSpend12m, multiplier: t.multiplier, customerGroupCode: t.customerGroupCode, active: false });
  });
  test('points: unverified guest earns nothing; manual adjust on an active customer (API)', async ({ api, orders }) => {
    // earnForOrder() only credits customers with status "active" (OTP-verified); phone-only guests are skipped.
    const o = await orders.place({ quantity: 3 });
    await orders.advance(o.id, ['preparing', 'ready']);
    await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' });
    await api.post('/ops/jobs/loyalty-earn-sweep/run');
    const guest = ((await api.get('/customers')).body.items as any[]).find((c) => c.phoneMasked?.endsWith(o.phone.slice(-4)));
    expect(guest?.status).toBe('unverified');
    expect((await api.get(`/customers/${guest.id}/loyalty`)).body.balance).toBe(0);
    const active = ((await api.get('/customers?status=active')).body.items as any[]).find((c) => c.status === 'active');
    test.skip(!active, 'no OTP-verified customer in this database');
    const before = (await api.get(`/customers/${active.id}/loyalty`)).body.balance;
    expect((await api.post(`/customers/${active.id}/loyalty/adjust`, { points: 5, reason: 'e2e' })).status).toBe(200);
    expect((await api.get(`/customers/${active.id}/loyalty`)).body.balance).toBe(before + 5);
    await api.post(`/customers/${active.id}/loyalty/adjust`, { points: -5, reason: 'e2e revert' });
  });
});

test.describe('Customer groups & price lists', () => {
  test('customer group create + edit (UI) persists', async ({ page, api }) => {
    const code = `e2e${uid()}`;
    await ui.open(page, 'customer-groups');
    await ui.btn(page, 'Nhóm mới').click();
    await page.getByLabel(/^Mã/).fill(code); await page.getByLabel('Tên tiếng Việt').fill(`Nhóm ${code}`);
    await ui.btn(page, 'Lưu').click();
    await ui.open(page, 'customer-groups');
    await page.getByText(code, { exact: true }).click();
    await expect(page.getByLabel('Tên tiếng Việt')).toHaveValue(`Nhóm ${code}`); // wait for the form to load before editing
    await page.getByLabel('Tên tiếng Việt').fill(`Nhóm ${code} sửa`);
    await ui.btn(page, 'Lưu').click();
    await expect.poll(async () => JSON.stringify((await api.get('/customer-groups')).body)).toContain(`Nhóm ${code} sửa`);
  });
  test('price list create with one item (UI) persists', async ({ page, api }) => {
    const name = `Bảng giá E2E ${uid()}`;
    await ui.open(page, 'price-lists');
    await ui.btn(page, 'Bảng giá mới').click();
    await page.getByLabel('Tên tiếng Việt').fill(name);
    await page.getByLabel('Mang về').check({ force: true });
    await ui.btn(page, 'Thêm món').click();
    // "Thêm món" appends a row prefilled with the first sellable; only the price needs input
    const price = page.getByText('Món và giá', { exact: true }).locator('..').getByRole('textbox').nth(1); // [món, giá] — no accessible labels (see README data-testid list)
    await price.fill('12345');
    await ui.btn(page, 'Lưu').click();
    await expect.poll(async () => JSON.stringify((await api.get('/price-lists')).body)).toContain(name);
  });
});
