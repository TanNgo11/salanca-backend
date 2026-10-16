/**
 * Regression tests for BUG-01..BUG-13 (see BAO-CAO-E2E-ORDERING.md). Each asserts the CORRECT
 * behaviour, so it FAILS until the bug is fixed. Run only these: `pnpm test:e2e --grep @bug`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, ui } from '../helpers/fixtures';
import { BASE_URL, storageFile, todayVN, uid } from '../helpers/env';

const ROOT = path.resolve(__dirname, '../..');

test('BUG-01 kitchen board shows a preparing order @bug-01', async ({ page, orders }) => {
  const o = await orders.place(); await orders.advance(o.id, ['preparing']);
  await page.goto('/admin/plugins/ordering/kitchen?branch=Q1');
  await expect(page.getByText(o.code)).toBeVisible({ timeout: 15_000 });
});

test('BUG-02 customer totalSpent is the numeric sum of completed orders @bug-02', async ({ api, orders }) => {
  const phone = `0903${String(Date.now()).slice(-6)}`;
  let sum = 0;
  for (const q of [2, 3]) {
    const o = await orders.place({ phone, quantity: q }); await orders.advance(o.id, ['preparing', 'ready']);
    await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' });
    // `o.total` is the quote: it is taken before a first-order promotion. totalSpent follows what the order really charged.
    const { totals } = (await orders.state(o.id)).raw;
    sum += totals.total;
  }
  await expect.poll(async () => {
    const items = (await api.get('/customers')).body.items as any[];
    return items.find((c) => c.phoneMasked?.endsWith(phone.slice(-4)) && c.orderCount === 2)?.totalSpent;
  }, { timeout: 30_000 }).toBe(sum);
});

test('BUG-03 review-otp-race.mjs finishes (no proxy send recursion) @bug-03 @slow', async () => {
  test.setTimeout(300_000);
  // Own port (the UAT server already uses PORT) and own database: the harness TRUNCATES the ordering tables of
  // ORDERING_TEST_DATABASE, so an inherited value pointing at the UAT database must never reach this child.
  const env = { ...process.env, PORT: String(1700 + Math.floor(Math.random() * 200)), ORDERING_TEST_DATABASE: process.env.E2E_RACE_DB ?? 'salanca_ordering_e2e_race' };
  const r = spawnSync('node', ['scripts/ordering/review-otp-race.mjs'], { cwd: ROOT, timeout: 280_000, encoding: 'utf8', env });
  expect(`${r.stdout}${r.stderr}`).not.toContain('Maximum call stack size exceeded');
  expect(r.status, (r.stderr ?? '').slice(-800)).toBe(0);
});

test('BUG-04 registry.test.ts passes under vitest @bug-04 @slow', async () => {
  test.setTimeout(180_000);
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', 'src/plugins/ordering/server/src/services/registry.test.ts'], { cwd: ROOT, encoding: 'utf8', timeout: 170_000 });
  expect(r.status, `${r.stdout}`.slice(-1500)).toBe(0);
});

test('BUG-05 UAT seed (uat-server.mjs) boots without ITEM_SOLD_OUT @bug-05 @slow', async () => {
  test.setTimeout(300_000);
  // Uses a throwaway DB so the running UAT server's DB is never reset.
  const out = await new Promise<string>((resolve) => {
    const child = spawn('node', ['scripts/ordering/uat-server.mjs'], { cwd: ROOT, env: { ...process.env, ORDERING_TEST_DATABASE: 'salanca_ordering_e2e_seedcheck', UAT_PORT: String(1700 + Math.floor(Math.random() * 200)), UAT_CRED_FILE: '' } });
    let buf = ''; const done = () => { child.kill('SIGTERM'); resolve(buf); };
    child.stdout.on('data', (d) => { buf += d; if (buf.includes('[ordering-uat] ready on')) done(); });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', () => resolve(buf));
    setTimeout(done, 280_000);
  });
  expect(out).not.toContain('ITEM_SOLD_OUT');
  expect(out).toContain('[ordering-uat] ready on');
});

test('BUG-06 cash-closing difference reflects cash collected after closing @bug-06', async ({ page, api, orders }) => {
  const day = todayVN();
  const summary = async () => (await api.get(`/cash-closing/summary?branch=Q1&businessDate=${day}`)).body.rows as any[];
  const collect = async () => {
    const o = await orders.place(); await orders.advance(o.id, ['preparing', 'ready']);
    expect((await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' })).status).toBe(200);
  };
  // The collector is whoever's cash total grew: this suite's admin, whatever the account is called.
  const before = await summary(); await collect();
  const me = (await summary()).find((r) => r.expectedAmount > (before.find((b) => b.collectorRef === r.collectorRef)?.expectedAmount ?? 0));
  expect(me, 'no collector gained cash').toBeTruthy();
  if (!me.closing) expect((await api.post('/cash-closing', { branch: 'Q1', businessDate: day, collectorRef: me.collectorRef, countedAmount: me.expectedAmount })).status).toBeLessThan(300);
  await collect();
  const after = (await summary()).find((r) => r.collectorRef === me.collectorRef);
  const diff = after.closing.countedAmount - after.expectedAmount;
  expect(diff).not.toBe(0);
  // API: the live difference follows the ledger while the frozen audit value stays what it was at close time.
  expect(after.closing.liveDifferenceAmount).toBe(diff);
  expect(after.closing.differenceAmount, 'the frozen difference does not move').not.toBe(diff);
  expect(after.collectorName, 'the collector row is found by name').toBeTruthy();
  await ui.open(page, 'cash-closing');
  // The page opens on the first branch by name (runs create extra branches); make sure it is Q1 and the table has loaded.
  await expect(page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).first()).toHaveText(/Quận 1|Q1/);
  await expect(page.getByRole('columnheader', { name: /chênh lệch/i }).first()).toBeVisible();
  const header = (await page.getByRole('row').filter({ hasText: /chênh lệch/i }).first().locator('th, td, [role=gridcell], [role=columnheader], [role=cell]').allInnerTexts()).map((t) => t.trim());
  const idx = header.findIndex((t) => /chênh lệch/i.test(t.normalize('NFC')));
  expect(idx, `headers: ${header.join(' | ')}`).toBeGreaterThan(-1);
  // Match the collector by the FIRST cell: another row can mention this name in its "closed by" column.
  await expect(page.getByRole('row').filter({ hasText: after.collectorName }).first()).toBeVisible();
  const rows = page.getByRole('row');
  let row = rows.first();
  let texts: string[] = [];
  for (let i = 0, n = await rows.count(); i < n; i += 1) {
    const cells = await rows.nth(i).locator('th, td, [role=gridcell], [role=cell]').allInnerTexts();
    if (cells[0]?.trim().startsWith(after.collectorName)) { row = rows.nth(i); texts = cells; break; }
  }
  expect(texts.length, `no row starts with ${after.collectorName}`).toBeGreaterThan(idx);
  // The cell shows the live difference first, then "Lúc chốt: <frozen>" once cash was posted after the close;
  // take only the first amount so the second line's digits are not glued on.
  const live = texts[idx].match(/\d[\d.]*(?=\s*đ)/)?.[0] ?? '';
  expect(live.replace(/\D/g, ''), `row: ${texts.join(' | ')}`).toBe(String(Math.abs(diff)));
  await expect(row).toContainText('Lúc chốt');
});

test('BUG-07 missing permission shows "no permission" (not a blank page) on Categories @bug-07', async ({ pageAs }) => {
  const page = await pageAs('lan'); test.skip(!page, 'needs lan-q1 credentials');
  await ui.open(page!, 'categories');
  await expect(page!.getByText('Bạn không có quyền truy cập nội dung này')).toBeVisible();
});

test('BUG-08a price list without items explains what is missing @bug-08', async ({ page }) => {
  // server answers PRICE_LIST_INVALID with issues[{path:'lines', message:'choose at least one variant'}]
  await ui.open(page, 'price-lists', null); await ui.btn(page, 'Bảng giá mới').click();
  await page.getByLabel('Tên tiếng Việt').fill(`PL ${uid()}`); await ui.btn(page, 'Lưu').click();
  const alert = page.getByRole('alert').filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/món|biến thể/i);
});


test('BUG-08b loyalty tier validation is shown in Vietnamese @bug-08', async ({ page }) => {
  await ui.open(page, 'loyalty'); await page.getByRole('tab', { name: 'Hạng thành viên' }).click();
  await ui.btn(page, 'Thêm hạng').click(); const d = ui.dialog(page);
  await d.getByLabel(/Mã hạng/).fill(`e2e-${uid()}`); await d.getByLabel('Tên (VI)').fill('x');
  await d.getByLabel(/Hệ số điểm/).fill('2'); // server: multiplier >= 10
  await ui.btn(d, 'Lưu').click();
  await expect(d).toBeVisible();
  await expect(d.getByText(/Hệ số điểm tối thiểu/)).toBeVisible(); // the Vietnamese line, not just the absence of the English one
  await expect(d.getByText(/active tiers need different spend thresholds|Too small|expected number/)).toHaveCount(0);
});


// fixme: the fix plan (docs/plans/ordering-e2e-fixes-2026-10-16.md, Task 11) closed BUG-09 as "not a plugin bug": the editor
// shows the admin's browser time. Whether it should follow the store timezone is an open product decision; drop `.fixme`
// (and the plan's closure) the day the owner says it must.
test.fixme('BUG-09 promotion preview shows the store (VN) time even when the browser is in UTC @bug-09', async ({ browser, api }) => {
  // Observed during manual E2E with a UTC browser: preview showed 04:11 at 11:11 VN.
  // Expected: times follow the store timezone (Asia/Ho_Chi_Minh), not the browser's.
  const r = await api.post('/promotions', { name: { vi: `E2E KM tz ${uid()}` }, kind: 'code', discountType: 'percent', value: 5, target: { kind: 'order', refs: [] }, minSubtotal: 0, receiveKinds: ['pickup'], startsAt: '2030-01-15T01:30:00.000Z', active: false });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  const id = r.body.promotion?.id ?? r.body.item?.id;
  const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: storageFile('admin'), timezoneId: 'UTC', locale: 'vi-VN' });
  const page = await ctx.newPage();
  await page.goto(`/admin/plugins/ordering/promotions/${id}`);
  const preview = page.getByText(/KHÁCH THẤY/i).locator('..');
  await expect(preview).toContainText('2030-01-15');
  await expect(preview).toContainText('08:30'); // 01:30Z == 08:30 ICT
  await ctx.close();
});



test('BUG-10 OpenAPI marks required query params and loyalty settings round-trip @bug-10', async ({ api }) => {
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'docs/ordering-admin-openapi.json'), 'utf8'));
  const params = (doc.paths['/reports/sales'].get.parameters ?? []) as any[];
  expect(params.find((p) => p.name === 'from')?.required).toBe(true);
  for (const route of ['/cash-closing', '/cash-closing/summary']) {
    const q = (doc.paths[route].get.parameters ?? []) as any[];
    expect(q.find((p) => p.name === 'branch')?.required, `${route} branch`).toBe(true);
    expect(q.find((p) => p.name === 'businessDate')?.required, `${route} businessDate`).toBe(true);
  }
  expect(doc.paths['/loyalty/settings'].put.requestBody?.content?.['application/json']?.schema?.properties?.earnPerAmount).toBeTruthy();
  expect(doc.paths['/orders/{id}/cancel'].post.requestBody?.content?.['application/json']?.schema?.properties?.reasonCode).toBeTruthy();
  // The order / payment-review / cash-closing writes all declare a body (retest v3: 14 ops).
  const withBody: [string, string][] = [
    ['/orders/{id}/transition', 'post'], ['/orders/{id}/notes', 'post'], ['/orders/{id}/cash-handover', 'post'],
    ['/orders/{id}/cancel', 'post'], ['/orders/{id}/lines/{lineId}/cancel', 'post'], ['/orders/{id}/refunds', 'post'],
    ['/refunds/{id}/settle', 'post'], ['/orders/{id}/manual-payments', 'post'], ['/cash-closing', 'post'],
    ['/cash-closing/{id}/adjust', 'post'], ['/payment-reviews/{id}/assign', 'post'],
    ['/payment-reviews/{id}/refund-due', 'post'], ['/payment-reviews/{id}/reopen', 'post'],
    ['/payment-reviews/{id}/ignore', 'post'],
  ];
  for (const [route, verb] of withBody) {
    const op = doc.paths[route]?.[verb];
    expect(op?.requestBody?.content?.['application/json']?.schema?.properties, `${verb.toUpperCase()} ${route} has a request body`).toBeTruthy();
  }
  // Ratchet: the writes still without a body (categories, branches, settings, webhooks, ...) must not grow.
  const bodyless = Object.entries(doc.paths).flatMap(([route, ops]: [string, any]) =>
    ['post', 'put', 'patch'].filter((verb) => ops[verb] && !ops[verb].requestBody).map((verb) => `${verb.toUpperCase()} ${route}`));
  expect(bodyless.length, `writes without a request body: ${bodyless.join(', ')}`).toBeLessThanOrEqual(34);
  const s =(await api.get('/loyalty/settings')).body;
  expect((await api.put('/loyalty/settings', s.settings ?? s)).status).toBe(200);
});

test('BUG-11 Providers page has no React key warning @bug-11', async ({ page }) => {
  // React prints the "unique key" warning in development builds only; against a built admin (strapi start) this
  // test would pass whatever the page does. Not reproduced from code either: opt in on a `strapi develop` server.
  test.skip(process.env.E2E_ADMIN_DEV !== '1', 'needs a dev admin build: set E2E_ADMIN_DEV=1 with `strapi develop`');
  const warns: string[] = []; page.on('console', (m) => { if (/unique "key" prop/.test(m.text())) warns.push(m.text()); });
  await ui.open(page, 'providers'); await page.waitForTimeout(3000);
  expect(warns).toEqual([]);
});

test('BUG-12 rating tags render their configured label, not the code @bug-12', async ({ page, api, orders, pub }) => {
  const o = await orders.place(); await orders.advance(o.id, ['preparing', 'ready']); await api.post(`/orders/${o.id}/cash-handover`, { method: 'cash' });
  const comment = `E2E tag ${Date.now()}`;
  const r = await pub.call('POST', '/orders/rating', { stars: 2, tags: ['late'], comment }, { 'X-Order-Token': o.token });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  await ui.open(page, 'ratings', null);
  const row = page.getByRole('row').filter({ hasText: comment });
  await expect(row).toBeVisible();
  await expect(row.getByText('late', { exact: true })).toHaveCount(0);
});

test('BUG-13 unknown ordering sub-route shows a not-found message @bug-13', async ({ page }) => {
  await page.goto('/admin/plugins/ordering/khong-ton-tai');
  await expect(page.getByText(/không tìm thấy|not found|404/i).first()).toBeVisible({ timeout: 15_000 });
});

test('BUG-14 webhook for an unregistered payment provider answers 4xx, not 500 @bug-14', async ({ pub }) => {
  // Found while building this suite: with SePay unconfigured, POST /webhooks/sepay throws PROVIDER_NOT_REGISTERED as HTTP 500
  const r = await pub.call('POST', '/webhooks/sepay', { id: 1, transferAmount: 1000, content: 'SLC-000001' });
  expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
});

test('BUG-15 orders inbox search submits and filters by order code @bug-15', async ({ page, orders }) => {
  // Found while building this suite: OrdersList passes onSubmit to <Searchbar>, but Enter fires no request
  // and the list is not filtered (GET /orders never receives q=).
  const o = await orders.place();
  await ui.open(page, 'orders');
  const req = page.waitForRequest((r) => r.url().includes('/ordering/orders?') && r.url().includes('q='), { timeout: 8000 }).catch(() => null);
  await page.getByRole('searchbox', { name: 'Mã đơn, SĐT, tên' }).fill(o.code);
  await page.getByRole('searchbox', { name: 'Mã đơn, SĐT, tên' }).press('Enter');
  expect(await req, 'no request with q= was sent').not.toBeNull();
  await expect(page.getByRole('row').filter({ hasText: o.code })).toBeVisible();
});

test('UX data-request erase asks for confirmation and is not the default type @ux-erase-confirm', async ({ page, api, orders }) => {
  // A customer of its own with no open order: if the confirmation ever regresses, the erase hits only this throwaway one.
  const o = await orders.place(); await api.post(`/orders/${o.id}/cancel`, { reasonCode: 'other', note: 'e2e' });
  await ui.open(page, 'data-requests'); await ui.btn(page, '+ Tạo yêu cầu').click();
  await expect(page.getByRole('combobox', { name: 'Loại' })).not.toHaveText(/Xóa/);
  await page.getByLabel('Số điện thoại khách').fill(o.phone);
  await page.getByRole('combobox', { name: 'Loại' }).click(); await page.getByRole('option', { name: 'Xóa', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo yêu cầu', exact: true }).last().click();
  const warning = page.locator('[role=alertdialog], [role=dialog]').filter({ hasText: /xác nhận|không thể hoàn tác/i });
  await expect(warning).toBeVisible();
  await expect(warning, 'the warning names the number that is about to be erased').toContainText(o.phone);
  const found = async () => ((await api.get(`/customers?q=${o.phone}`)).body.items as any[]).length;
  expect(await found(), 'nothing is erased before the second confirmation').toBe(1);
  // "Quay lại" returns to the form without sending anything
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await expect(page.getByLabel('Số điện thoại khách')).toBeVisible();
  expect(await found(), 'going back does not erase').toBe(1);
  // the second confirmation erases: the customer leaves the directory
  await page.getByRole('button', { name: 'Tạo yêu cầu', exact: true }).last().click();
  await page.getByRole('button', { name: 'Xóa vĩnh viễn', exact: true }).click();
  await expect.poll(found, { timeout: 30_000 }).toBe(0);
});

test('UX data-request erase over the API needs confirm:true @ux-erase-confirm', async ({ api }) => {
  const phone = `09${String(Date.now()).slice(-8)}`;
  const denied = await api.post('/data-requests', { phone, kind: 'erase' });
  expect(denied.status, JSON.stringify(denied.body)).toBe(400);
  expect(denied.body.error?.details?.field).toBe('confirm');
  // With the flag the request passes the confirm gate. What follows for a phone with no profile (201 for an
  // all-branches admin, 404 for scoped staff) is a separate rule; here it only must not be the confirm 400.
  const confirmed = await api.post('/data-requests', { phone, kind: 'erase', confirm: true });
  expect([201, 404], JSON.stringify(confirmed.body)).toContain(confirmed.status);
});
