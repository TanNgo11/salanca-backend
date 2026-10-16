import { test, expect, ui } from '../helpers/fixtures';

test.describe('Data requests', () => {
  test('export request for a customer without open orders is processed', async ({ page, api, orders }) => {
    const o = await orders.place(); await api.post(`/orders/${o.id}/cancel`, { reasonCode: 'other', note: 'e2e' });
    await ui.open(page, 'data-requests');
    await ui.btn(page, '+ Tạo yêu cầu').click();
    await page.getByLabel('Số điện thoại khách').fill(o.phone);
    await page.getByRole('combobox', { name: 'Loại' }).click(); await page.getByRole('option', { name: 'Xuất', exact: true }).click();
    await page.getByRole('button', { name: 'Tạo yêu cầu', exact: true }).last().click();
    await expect.poll(async () => { const l = (await api.get('/data-requests')).body.items; return l.find((x: any) => x.kind === 'export')?.status; }).toBeTruthy();
  });
  test('erase request on a customer with an open order waits, then reject requires reason', async ({ page, api, orders }) => {
    const o = await orders.place();
    await ui.open(page, 'data-requests');
    await ui.btn(page, '+ Tạo yêu cầu').click();
    await page.getByLabel('Số điện thoại khách').fill(o.phone);
    await page.getByRole('combobox', { name: 'Loại' }).click(); await page.getByRole('option', { name: 'Xóa', exact: true }).click();
    // Erase is two-step: the first click only shows the red warning, "Xóa vĩnh viễn" sends the request.
    await page.getByRole('button', { name: 'Tạo yêu cầu', exact: true }).last().click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/ordering/data-requests') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Xóa vĩnh viễn', exact: true }).click(),
    ]);
    const masked = `****${o.phone.slice(-3)}`;
    const row = page.getByRole('row').filter({ hasText: masked }).first();
    await expect(async () => {
      await page.reload();
      await page.locator('main').getByText('Chờ đơn đóng', { exact: true }).first().click();
      await expect(row).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    const d = ui.dialog(page);
    // the list polls and re-renders, which can detach the row button mid-click
    await expect(async () => {
      await row.getByRole('button', { name: 'Từ chối', exact: true }).click({ timeout: 3000 });
      await expect(d).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await d.locator('textarea, input:visible').first().fill('E2E từ chối');
    await d.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect.poll(async () => (await api.get('/data-requests')).body.items.filter((x: any) => x.status === 'rejected').length).toBeGreaterThan(0);
  });
});

test.describe('Ratings', () => {
  test('note + hide a fresh rating (UI), verified via API', async ({ page, api, orders, pub }) => {
    const o = await orders.place(); await orders.advance(o.id, ['preparing', 'ready']);
    await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' });
    const comment = `E2E rating ${Date.now()}`;
    expect([200, 201]).toContain((await pub.call('POST', '/orders/rating', { stars: 2, comment }, { 'X-Order-Token': o.token })).status);
    await ui.open(page, 'ratings');
    await page.getByText(comment).first().click();
    const d = ui.dialog(page);
    await d.locator('textarea').fill('Ghi chú nội bộ E2E'); await ui.btn(d, 'Lưu ghi chú').click();
    await expect.poll(async () => ((await api.get('/ratings')).body.items as any[]).find((x) => x.comment === comment)?.staffNote).toBe('Ghi chú nội bộ E2E');
    // the detail dialog stays open after saving the note
    const dlg = ui.dialog(page);
    await expect(async () => {
      await dlg.getByRole('button', { name: 'Ẩn đánh giá', exact: true }).click({ timeout: 3000 });
      await expect(dlg.getByRole('button', { name: 'Hiện lại', exact: true })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await expect.poll(async () => { const r = (await api.get('/ratings')).body; const it = (r.results ?? r.items).find((x: any) => x.comment === comment); return `${it?.status}|${it?.staffNote}`; }).toBe('hidden|Ghi chú nội bộ E2E');
  });
});

test.describe('Alerts', () => {
  test('acknowledge an open alert (UI) moves it to acknowledged', async ({ page, api }) => {
    const open = (await api.get('/alerts?status=open')).body;
    test.skip(!open.total, 'no open alerts');
    const ack0 = (await api.get('/alerts?status=acknowledged')).body.total;
    await ui.open(page, 'alerts');
    await page.locator('main').getByRole('row').nth(1).getByRole('button', { name: 'Đã biết' }).click();
    if (await ui.dialog(page).count()) await ui.dialog(page).getByRole('button').last().click();
    await expect.poll(async () => (await api.get('/alerts?status=acknowledged')).body.total).toBeGreaterThan(ack0);
  });
});
