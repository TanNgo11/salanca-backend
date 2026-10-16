import { test, expect, ui } from '../helpers/fixtures';
import { uid } from '../helpers/env';

test.describe('Kitchen (KDS)', () => {
  test('kitchen API lists a preparing order; start + complete', async ({ api, orders }) => {
    const o = await orders.place();
    await orders.advance(o.id, ['preparing']);
    const board = await api.get('/kitchen?branch=Q1');
    const card = board.body.item.orders.find((x: any) => x.code === o.code);
    expect(card).toBeTruthy();
    expect((await api.post(`/kitchen/orders/${o.id}/start`, {})).status).toBe(200);
    expect((await api.post(`/kitchen/orders/${o.id}/complete`, {})).status).toBe(200);
    expect((await orders.state(o.id)).group).toBe('ready');
  });
  test('kitchen page loads and remembers branch in URL', async ({ page }) => {
    await ui.open(page, 'kitchen');
    await page.locator('input:visible').first().fill('Q1');
    await ui.btn(page, 'Lưu').click();
    await expect(page).toHaveURL(/branch=Q1/);
    await expect(page.getByRole('heading', { name: 'Mới' })).toBeVisible();
  });
});

test.describe('Tables & table sessions', () => {
  test('create table (UI) persists, deactivate toggle persists, rotate QR', async ({ page, api }) => {
    const code = `T${uid()}`.slice(0, 10); const name = `Bàn E2E ${code}`;
    await ui.open(page, 'tables');
    await ui.btn(page, 'Thêm bàn').click();
    const d = ui.dialog(page);
    const combo = d.getByRole('combobox');
    if (await combo.count()) { await combo.first().click(); await page.getByRole('option', { name: /Quận 1/ }).first().click(); }
    await d.getByLabel('Mã bàn').fill(code); await d.getByLabel('Tên bàn').fill(name); await d.getByLabel('Số ghế').fill('4');
    await ui.btn(d, 'Lưu').click();
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('switch').or(row.locator('input[type=checkbox]')).first().click({ force: true });
    await expect.poll(async () => { const t = (await api.get('/tables')).body; return (t.results ?? t.items).find((x: any) => String(x.code).toUpperCase() === code.toUpperCase())?.active; }).toBe(false);
    await row.getByRole('button', { name: 'Đổi QR' }).click();
    if (await ui.dialog(page).count()) await ui.dialog(page).getByRole('button').last().click();
  });

  test('dine-in session: order on a new table, close session with cash (UI)', async ({ page, api, orders, pub }) => {
    const code = `S${uid()}`.slice(0, 10);
    const created = await api.post('/tables', { locationRef: 'Q1', code, name: `Bàn phiên ${code}`, seats: 2 });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const qr: string = created.body.item?.qrUrl ?? created.body.qrUrl;
    const tableToken = qr.match(/[?&]t=([^&]+)/)![1];
    const o = await orders.place({ receiveMethod: { kind: 'dine-in', locationRef: 'Q1', tableToken } });
    await orders.advance(o.id, ['preparing', 'ready', 'served']);
    await ui.open(page, 'table-sessions');
    await page.getByText(`Bàn phiên ${code}`).first().click();
    await ui.btn(page, 'Đóng phiên').click();
    await ui.dialog(page).getByRole('button', { name: 'Thu & đóng phiên' }).click();
    await expect.poll(async () => (await orders.state(o.id)).payment).toBe('paid');
    void pub;
  });
});
