import { randomUUID } from 'node:crypto';
import { test as base, expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BASE_URL, INTAKE_SECRET, storageFile, tokens, type Role } from './env';

export interface ApiResult<T = any> { status: number; body: T }

/** Admin plugin API (`/ordering/*`) as a given role, using the token saved by globalSetup. */
export class AdminApi {
  constructor(private ctx: APIRequestContext) {}
  async call<T = any>(method: string, path: string, data?: unknown): Promise<ApiResult<T>> {
    const res = await this.ctx.fetch(`/ordering${path}`, { method, data: data === undefined ? undefined : data });
    const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status(), body };
  }
  get<T = any>(p: string) { return this.call<T>('GET', p); }
  post<T = any>(p: string, d: unknown = {}) { return this.call<T>('POST', p, d); }
  put<T = any>(p: string, d: unknown) { return this.call<T>('PUT', p, d); }
  del<T = any>(p: string) { return this.call<T>('DELETE', p); }
}

/** Storefront API (`/api/v1/ordering/*`) with intake secret + a random visitor IP (avoids the shared rate-limit bucket). */
export class PublicApi {
  constructor(private ctx: APIRequestContext) {}
  async call<T = any>(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
    const res = await this.ctx.fetch(`/api/v1/ordering${path}`, {
      method, data, headers: { 'x-salanca-intake-secret': INTAKE_SECRET, 'x-salanca-visitor-ip': `203.0.113.${1 + Math.floor(Math.random() * 250)}`, ...headers },
    });
    const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status(), body };
  }
}

export interface PlacedOrder { id: number; code: string; token: string; total: number; phone: string }

export class Orders {
  constructor(private pub: PublicApi, private admin: AdminApi) {}
  async product(branch = 'Q1', match = /Trà/) {
    const r = await this.pub.call('GET', `/catalog/products?branch=${branch}&locale=vi`);
    const items: any[] = r.body.items ?? [];
    const p = items.find((i) => match.test(i.name?.vi ?? i.name ?? '')) ?? items.find((i) => !/quà/i.test(i.name?.vi ?? i.name ?? ''));
    if (!p) throw new Error(`no product at ${branch}`);
    return p;
  }
  /** Places a pickup (ASAP or first open slot) cash order at a branch and returns its admin id. */
  async place(opts: { branch?: string; quantity?: number; phone?: string; payment?: string; receiveMethod?: any; email?: string } = {}): Promise<PlacedOrder> {
    const branch = opts.branch ?? 'Q1';
    const cfg = (await this.pub.call('GET', `/config?branch=${branch}`)).body;
    const p = await this.product(branch);
    const phone = opts.phone ?? `0906${String(Date.now()).slice(-6)}`;
    const base: any = { branch, locale: 'vi', lines: [{ sellableUid: p.id, quantity: opts.quantity ?? 2 }], ...(opts.payment ? { payment: { providerCode: opts.payment } } : {}) };
    let cart = { ...base, receiveMethod: opts.receiveMethod ?? { kind: 'pickup', asap: true } };
    let q = await this.pub.call('POST', '/quote', cart);
    if (q.status !== 200 && !opts.receiveMethod) {
      const date = cfg.branch.pickup.bookableTo;
      const slots = await this.pub.call('GET', `/slots?branch=${branch}&date=${date}&receiveMethod=pickup`);
      cart = { ...base, receiveMethod: { kind: 'pickup', slot: { startsAt: slots.body.items.find((s: any) => s.available).startsAt } } };
      q = await this.pub.call('POST', '/quote', cart);
    }
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const c = await this.pub.call('POST', '/orders', {
      ...cart, contact: { name: 'E2E Playwright', phone, email: opts.email ?? 'e2e@example.invalid' },
      consent: { policyVersion: cfg.consentPolicyVersion, accepted: true }, expectedCartHash: q.body.cartHash, captchaToken: 'pass',
    }, { 'Idempotency-Key': randomUUID() });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const code = c.body.order.code as string;
    const found = await this.admin.get(`/orders?tab=all&q=${code}`);
    const row = (found.body.results ?? []).find((r: any) => r.code === code) ?? (await this.admin.get('/orders?tab=awaiting')).body.results.find((r: any) => r.code === code);
    return { id: row.id, code, token: c.body.token, total: q.body.totals.grandTotal, phone };
  }
  async state(id: number) {
    const d = (await this.admin.get(`/orders/${id}`)).body;
    return { status: d.order?.status as string, group: d.group?.status as string, payment: d.order?.paymentStatus as string, refunds: (d.refunds ?? []) as any[], totals: d.totals, raw: d };
  }
  async advance(id: number, to: string[]) { for (const t of to) expect((await this.admin.post(`/orders/${id}/transition`, { to: t })).status).toBe(200); }
}

/** Small UI helpers shared by specs. */
export const ui = {
  dialog: (page: Page): Locator => page.locator('[role=dialog],[role=alertdialog]').last(),
  /**
   * Opens an ordering admin page. Pages with a "Chi nhánh" picker default to the first branch by
   * name (test runs create extra branches), so the branch is selected explicitly (default Quận 1).
   */
  async open(page: Page, sub: string, branchLabel: string | null = 'Quận 1') {
    await page.goto(`/admin/plugins/ordering/${sub}`);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('main, [role=main]').first().waitFor({ timeout: 30_000 }).catch(() => {});
    if (branchLabel) await ui.branch(page, branchLabel);
  },
  async branch(page: Page, label: string) {
    const picker = page.getByRole('combobox', { name: 'Chi nhánh', exact: true }).first();
    // isVisible() does not wait, so wait explicitly for the picker to render
    if (!(await picker.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false))) return;
    const current = (await picker.innerText()).trim();
    if (current === label || (label === 'Quận 1' && current === 'Q1')) return;
    await picker.click();
    // some pickers label branches by name ("Quận 1"), others by code ("Q1")
    const alt = label === 'Quận 1' ? 'Q1' : label;
    await page.getByRole('option', { name: label, exact: true }).or(page.getByRole('option', { name: alt, exact: true })).first().click();
  },
  btn: (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: typeof name === 'string' }).first(),
  /** Captures console errors / failed ordering requests for assertions. */
  watch(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/ordering/')) errors.push(`${r.status()} ${r.url()}`); });
    return errors;
  },
};

type Fixtures = { api: AdminApi; apiAs: (role: Role) => Promise<AdminApi | null>; pub: PublicApi; orders: Orders; pageAs: (role: Role) => Promise<Page | null> };

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${tokens().admin}` } });
    await use(new AdminApi(ctx)); await ctx.dispose();
  },
  apiAs: async ({}, use) => {
    const made: APIRequestContext[] = [];
    await use(async (role) => { const t = tokens()[role]; if (!t) return null; const c = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${t}` } }); made.push(c); return new AdminApi(c); });
    for (const c of made) await c.dispose();
  },
  pub: async ({}, use) => { const ctx = await request.newContext({ baseURL: BASE_URL }); await use(new PublicApi(ctx)); await ctx.dispose(); },
  orders: async ({ pub, api }, use) => { await use(new Orders(pub, api)); },
  pageAs: async ({ browser }, use) => {
    const ctxs: any[] = [];
    await use(async (role) => { if (!tokens()[role]) return null; const c = await browser.newContext({ baseURL: BASE_URL, storageState: storageFile(role), locale: 'vi-VN', viewport: { width: 1440, height: 900 } }); ctxs.push(c); return c.newPage(); });
    for (const c of ctxs) await c.close();
  },
});
export { expect };
