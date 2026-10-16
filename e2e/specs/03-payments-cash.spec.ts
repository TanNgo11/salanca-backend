import { test, expect, ui } from '../helpers/fixtures';
import { todayVN } from '../helpers/env';

test.describe('Payment review', () => {
  test('manual transfer from Payment Review page records payment on an order', async ({ page, orders }) => {
    const o = await orders.place();
    await ui.open(page, 'payment-review');
    await ui.btn(page, 'Ghi nhận chuyển khoản thủ công').click();
    const d = ui.dialog(page);
    await d.getByLabel(/^Đơn/).fill(o.code);
    await ui.btn(d, 'Tìm').click();
    const hit = d.getByRole('button', { name: new RegExp(`${o.code} · Cần thu`) });
    const due = Number((await hit.innerText()).split('Cần thu')[1].replace(/\D/g, ''));
    await hit.click();
    await d.getByLabel(/Mã giao dịch/).fill(`FTPR${Date.now().toString().slice(-6)}`);
    await d.getByLabel(/Số tiền/).fill(String(due));
    await ui.btn(d, 'Ghi nhận').click();
    await expect.poll(async () => (await orders.state(o.id)).raw.payments?.length ?? 0).toBeGreaterThan(0);
  });
  test('reopen a closed payment review (API) when one exists', async ({ api }) => {
    const list = (await api.get('/payment-reviews')).body;
    const closed = (list.results ?? list.items ?? []).find((r: any) => ['ignored', 'resolved', 'assigned'].includes(r.status));
    test.skip(!closed, 'seed has no closed payment-review event (needs SePay webhook traffic)');
    expect((await api.post(`/payment-reviews/${closed.id}/reopen`, { reason: 'e2e reopen' })).status).toBe(200);
  });
});

test.describe('Cash closing', () => {
  test('close (or adjust if already closed) the admin collector for today via UI', async ({ page, api, orders }) => {
    const o = await orders.place();
    await orders.advance(o.id, ['preparing', 'ready']);
    expect((await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' })).status).toBe(200);
    const sum = (await api.get(`/cash-closing/summary?branch=Q1&businessDate=${todayVN()}`)).body;
    const me = sum.rows.find((r: any) => r.collectorName === 'Local Admin') ?? sum.rows[0];
    await ui.open(page, 'cash-closing');
    // first matching row is the collector summary; history rows below also mention the name
    const row = page.getByRole('row').filter({ hasText: me.collectorName }).first();
    await expect(row).toBeVisible();
    if (!me.closing) {
      await row.getByRole('button', { name: 'Chốt', exact: true }).click();
      await ui.btn(ui.dialog(page), 'Chốt').click();
      await expect.poll(async () => (await api.get(`/cash-closing/summary?branch=Q1&businessDate=${todayVN()}`)).body.rows.find((r: any) => r.collectorRef === me.collectorRef).closing).toBeTruthy();
    } else {
      const rev0 = me.closing.revision ?? 1;
      await row.getByRole('button', { name: 'Điều chỉnh' }).click();
      const d = ui.dialog(page);
      await d.getByLabel('Đếm được').fill(String(me.expectedAmount));
      await d.getByLabel('Ghi chú').fill('E2E điều chỉnh');
      await d.getByLabel(/Lý do điều chỉnh/).fill('E2E đếm lại');
      await d.getByRole('button', { name: 'Điều chỉnh', exact: true }).click();
      await expect.poll(async () => (await api.get(`/cash-closing/summary?branch=Q1&businessDate=${todayVN()}`)).body.rows.find((r: any) => r.collectorRef === me.collectorRef).closing.revision).toBeGreaterThan(rev0);
    }
  });
  test('duplicate close is refused with CASH_CLOSING_EXISTS (API)', async ({ api }) => {
    const sum = (await api.get(`/cash-closing/summary?branch=Q1&businessDate=${todayVN()}`)).body;
    const closed = sum.rows.find((r: any) => r.closing);
    test.skip(!closed, 'no closed collector today');
    const r = await api.post('/cash-closing', { branch: 'Q1', businessDate: todayVN(), collectorRef: closed.collectorRef, countedAmount: closed.expectedAmount });
    expect(r.body.error?.code).toBe('CASH_CLOSING_EXISTS');
  });
});
