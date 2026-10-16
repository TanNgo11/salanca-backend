import { chromium, request, type FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AUTH_DIR, BASE_URL, credFor, storageFile, tokenFile, type Role } from './helpers/env';

const ROLES: Role[] = ['admin', 'lan', 'chain', 'courier', 'manager', 'accountant', 'phoneCourier'];

/**
 * Logs every configured role in ONCE (Strapi rate-limits POST /admin/login) and stores
 * a browser storageState + a bearer token per role under e2e/.auth/.
 */
export default async function globalSetup(_config: FullConfig) {
  if (!credFor('admin')) {
    throw new Error('[e2e] set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to a super admin of the seeded UAT database (see e2e/README.md)');
  }
  mkdirSync(AUTH_DIR, { recursive: true });
  const toks: Partial<Record<Role, string>> = {};
  const browser = await chromium.launch();
  for (const role of ROLES) {
    const cred = credFor(role);
    if (!cred) { console.warn(`[e2e] no credentials for role "${role}" — role tests will be skipped`); continue; }
    const ctx = await browser.newContext({ baseURL: BASE_URL, locale: 'vi-VN' });
    const page = await ctx.newPage();
    let resp;
    // Strapi rate-limits /admin/login (HTTP 429): back off and retry.
    for (let attempt = 1; ; attempt++) {
      await page.goto('/admin/auth/login');
      await page.locator('input[name=email]').fill(cred.email);
      await page.locator('input[name=password]').fill(cred.password);
      [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/admin/login') && r.request().method() === 'POST'),
        page.locator('button[type=submit]').click(),
      ]);
      if (resp.status() !== 429 || attempt >= 6) break;
      console.warn(`[e2e] login rate-limited for ${role}, waiting 30s (attempt ${attempt})`);
      await page.waitForTimeout(30_000);
    }
    if (!resp.ok()) throw new Error(`[e2e] login failed for ${role} (${cred.email}): HTTP ${resp.status()}`);
    toks[role] = (await resp.json()).data.token;
    await page.waitForURL(/\/admin(?!\/auth)/);
    await ctx.storageState({ path: storageFile(role) });
    await ctx.close();
  }
  await browser.close();
  if (!toks.admin) throw new Error('[e2e] admin login is required');
  writeFileSync(tokenFile, JSON.stringify(toks, null, 1));
  // Sanity: the ordering plugin answers.
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${toks.admin}` } });
  const r = await api.get('/ordering/branches');
  if (!r.ok()) throw new Error(`[e2e] /ordering/branches -> ${r.status()} (is ORDERING_ENABLED=true and the UAT seed loaded?)`);
  await api.dispose();
}
