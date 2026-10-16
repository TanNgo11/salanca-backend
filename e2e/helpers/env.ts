import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:1447';
/**
 * All run artifacts live OUTSIDE the repo by default: `strapi develop` watches the project and
 * restarts the server whenever files change inside it (that kills a running suite).
 */
export const ARTIFACTS_DIR = path.resolve(process.env.E2E_ARTIFACTS_DIR ?? path.join(tmpdir(), 'salanca-e2e-artifacts'));
export const AUTH_DIR = path.join(ARTIFACTS_DIR, '.auth');
export const INTAKE_SECRET = process.env.E2E_INTAKE_SECRET ?? process.env.FORM_INTAKE_SHARED_SECRET ?? 'e2e-local-intake-secret';

export type Role = 'admin' | 'lan' | 'chain' | 'courier' | 'manager' | 'accountant' | 'phoneCourier';
export interface Cred { email: string; password: string }

/** UAT seed account names (scripts/ordering/uat-server.mjs) -> suite role. */
const UAT_NAMES: Record<Exclude<Role, 'admin'>, string> = {
  lan: 'lan-q1', chain: 'quan-ly-chuoi', courier: 'giao-q1', manager: 'quanly-q1', accountant: 'ketoan', phoneCourier: 'giao-phone',
};
const ENV_KEYS: Record<Exclude<Role, 'admin'>, string> = {
  lan: 'LAN', chain: 'CHAIN', courier: 'COURIER', manager: 'MANAGER', accountant: 'ACCOUNTANT', phoneCourier: 'PHONE_COURIER',
};

function uatCredFile(): { password: string; accounts: { name: string; email: string }[] } | null {
  const file = process.env.E2E_UAT_CRED_FILE ?? process.env.UAT_CRED_FILE;
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function credFor(role: Role): Cred | null {
  if (role === 'admin') {
    // No built-in default: the suite creates data, so the super admin of the UAT database must be named explicitly.
    const email = process.env.E2E_ADMIN_EMAIL; const password = process.env.E2E_ADMIN_PASSWORD;
    return email && password ? { email, password } : null;
  }
  const key = ENV_KEYS[role];
  const email = process.env[`E2E_${key}_EMAIL`]; const password = process.env[`E2E_${key}_PASSWORD`] ?? process.env.E2E_UAT_PASSWORD;
  if (email && password) return { email, password };
  const file = uatCredFile();
  const acc = file?.accounts.find((a) => a.name === UAT_NAMES[role]);
  return acc && file ? { email: acc.email, password: file.password } : null;
}

export const storageFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);
export const tokenFile = path.join(AUTH_DIR, 'tokens.json');
export function tokens(): Partial<Record<Role, string>> {
  return existsSync(tokenFile) ? JSON.parse(readFileSync(tokenFile, 'utf8')) : {};
}
export const hasRole = (role: Role) => Boolean(tokens()[role]);
/** Unique suffix so every run creates fresh entities (re-runnable). */
export const uid = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 46656).toString(36)}`;
export const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
