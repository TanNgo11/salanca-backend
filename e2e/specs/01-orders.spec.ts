import { test, expect, ui } from '../helpers/fixtures';

test.describe('Order lifecycle (UI + API)', () => {
  test('accept → preparing (from the order page; inbox search is BUG-15)', async ({ page, orders }) => {
    // The inbox lists awaiting orders oldest-first, 20 per page, and its search box never submits (BUG-15).
    // A fresh order is therefore not reachable from page 1 on a busy UAT DB, so accept from the detail page.
    const o = await orders.place();
    await page.goto(`/admin/plugins/ordering/orders/${o.id}`);
    await page.getByRole('button', { name: /^Nhận/ }).first().click();
    const confirm = ui.dialog(page).getByRole('button', { name: /^Nhận/ });
    if (await confirm.count()) await confirm.first().click();
    await expect.poll(async () => (await orders.state(o.id)).group).toBe('preparing');
  });

  test('ready (confirm) → "Thu tiền và giao" → completed + paid; refund cash', async ({ page, orders }) => {
    const o = await orders.place();
    await orders.advance(o.id, ['preparing']);
    await page.goto(`/admin/plugins/ordering/orders/${o.id}`);
    await ui.btn(page, 'Sẵn sàng').click();
    await ui.btn(ui.dialog(page), 'Sẵn sàng').click();
    await expect.poll(async () => (await orders.state(o.id)).group).toBe('ready');
    await ui.btn(page, 'Thu tiền và giao').click();
    await ui.dialog(page).getByRole('button', { name: /Đã thu .* và giao/ }).click();
    await expect.poll(async () => { const s = await orders.state(o.id); return `${s.status}/${s.payment}`; }).toBe('completed/paid');
    await page.reload();
    await ui.btn(page, '…').click();
    await page.getByRole('menuitem', { name: /Hoàn tiền/ }).click();
    const d = ui.dialog(page);
    await d.getByLabel(/Số tiền/).fill('5000');
    await d.getByLabel(/Lý do/).fill('E2E hoàn tiền');
    await ui.btn(d, 'Hoàn tiền').click();
    await expect.poll(async () => (await orders.state(o.id)).refunds.length).toBeGreaterThan(0);
  });

  test('cancel requires a reason, then cancels', async ({ page, orders }) => {
    const o = await orders.place();
    await page.goto(`/admin/plugins/ordering/orders/${o.id}`);
    await ui.btn(page, '…').click();
    await page.getByRole('menuitem', { name: 'Hủy đơn' }).click();
    const d = ui.dialog(page);
    const submit = d.getByRole('button', { name: 'Hủy đơn', exact: true });
    await expect(submit).toBeDisabled();
    await d.getByRole('combobox').first().click();
    await expect(page.getByRole('option').first()).toBeVisible();
    expect(await page.getByRole('option').count()).toBeGreaterThanOrEqual(6); // 6 seeded reasons (+ any added in Settings)
    await page.getByRole('option', { name: 'Hết món' }).click();
    await d.locator('textarea').first().fill('E2E hủy').catch(() => {});
    await submit.click();
    await expect.poll(async () => (await orders.state(o.id)).status).toBe('canceled');
  });

  test('manual bank transfer from order menu records a payment', async ({ page, orders }) => {
    const o = await orders.place();
    await page.goto(`/admin/plugins/ordering/orders/${o.id}`);
    await ui.btn(page, '…').click();
    await page.getByRole('menuitem', { name: /Ghi nhận chuyển khoản/ }).click();
    const d = ui.dialog(page);
    await d.getByLabel(/Mã giao dịch/).fill(`FTE2E${Date.now().toString().slice(-6)}`);
    await d.getByLabel(/Số tiền/).fill(String(o.total));
    await ui.btn(d, 'Ghi nhận').click();
    await expect.poll(async () => (await orders.state(o.id)).raw.payments?.length ?? 0).toBeGreaterThan(0);
  });

  test('internal note persists after reload', async ({ page, orders }) => {
    const o = await orders.place();
    const note = `Ghi chú E2E ${Date.now()}`;
    await page.goto(`/admin/plugins/ordering/orders/${o.id}`);
    await page.getByPlaceholder(/ghi chú/i).fill(note);
    await ui.btn(page, 'Thêm ghi chú').click();
    await page.reload();
    await expect(page.getByText(note)).toBeVisible();
    const tl = JSON.stringify((await orders.state(o.id)).raw.timeline ?? []);
    expect(tl).toContain(note);
  });

  test('customer self-cancel + token view (API)', async ({ orders, pub }) => {
    const o = await orders.place();
    const v = await pub.call('GET', '/orders', undefined, { 'X-Order-Token': o.token });
    expect(v.status).toBe(200);
    const c = await pub.call('POST', '/orders/cancel', {}, { 'X-Order-Token': o.token });
    expect(c.status).toBe(200);
    expect((await orders.state(o.id)).status).toBe('canceled');
  });

  test('transition after cancel is rejected (API)', async ({ api, orders }) => {
    const o = await orders.place();
    expect((await api.post(`/orders/${o.id}/cancel`, { reasonCode: 'other', note: 'e2e' })).status).toBe(200);
    const r = await api.post(`/orders/${o.id}/transition`, { to: 'preparing' });
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });

  test('customer rating after completion (API)', async ({ api, orders, pub }) => {
    const o = await orders.place();
    await orders.advance(o.id, ['preparing', 'ready']);
    expect((await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' })).status).toBe(200);
    const r = await pub.call('POST', '/orders/rating', { stars: 5, comment: 'e2e' }, { 'X-Order-Token': o.token });
    expect([200, 201]).toContain(r.status);
  });
});
