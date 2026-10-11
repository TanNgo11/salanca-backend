import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { o3Messages } from './o3';

const ROOT = join(__dirname, '..');
const O3_DIRS = ['inbox', 'components/orders', 'pages/Orders', 'pages/Branches', 'pages/Staff', 'pages/Settings', 'lib'];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

/** Values the screens interpolate into dynamic keys (`state.${status}` …). */
const DYNAMIC: Record<string, string[]> = {
  state: ['awaiting-acceptance', 'awaiting-payment', 'preparing', 'ready', 'delivered', 'rejected', 'canceled', 'expired'],
  tab: ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'],
  payment: ['unpaid', 'paid', 'partially-paid', 'overpaid', 'partially-refunded', 'refunded'],
  origin: ['storefront', 'staff-draft'],
  transition: ['preparing', 'awaiting-payment', 'ready', 'delivered', 'rejected'],
  'orders.empty': ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'],
  'branch.timing': ['asap', 'scheduled', 'both'],
  'branch.paymentTiming': ['prepay', 'accept-then-pay', 'pay-on-pickup'],
  day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  consent: ['web-checkout', 'phone-staff'],
  method: ['cash'],
};

describe('O3 admin translations', () => {
  it('has VI and EN for every key the screens use', () => {
    const used = new Set<string>();
    for (const dir of O3_DIRS) {
      for (const file of files(join(ROOT, dir))) {
        if (file.endsWith('.test.ts')) continue;
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(match[1]);
      }
    }
    for (const [prefix, values] of Object.entries(DYNAMIC)) {
      for (const value of values) used.add(`${prefix}.${value}`);
    }
    const missing = [...used].filter((key) => !o3Messages[key]);
    expect(missing).toEqual([]);
    for (const [key, [vi, en]] of Object.entries(o3Messages)) {
      expect(vi.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
    }
  });
});
