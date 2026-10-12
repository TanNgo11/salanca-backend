import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { o3Messages } from './o3';
import { o4Messages } from './o4';
import { o5Messages } from './o5';
import { o6Messages } from './o6';

const ROOT = join(__dirname, '..');
const O3_DIRS = ['inbox', 'components/orders', 'pages/Orders', 'pages/Deliveries', 'pages/Branches', 'pages/Staff', 'pages/Settings', 'pages/PaymentReview', 'pages/Ops', 'pages/Alerts', 'lib'];
const EXTRA_FILES = ['pages/App.tsx'];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

/** Values the screens interpolate into dynamic keys (`state.${status}` …). */
const DYNAMIC: Record<string, string[]> = {
  state: ['awaiting-acceptance', 'awaiting-payment', 'preparing', 'ready', 'out-for-delivery', 'delivered', 'failed', 'rejected', 'canceled', 'expired'],
  tab: ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'],
  payment: ['unpaid', 'paid', 'partially-paid', 'overpaid', 'partially-refunded', 'refunded'],
  origin: ['storefront', 'staff-draft'],
  transition: ['preparing', 'awaiting-payment', 'ready', 'out-for-delivery', 'delivered', 'failed', 'rejected'],
  'orders.empty': ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'],
  'branch.timing': ['asap', 'scheduled', 'both'],
  'branch.paymentTiming': ['prepay', 'accept-then-pay', 'pay-on-pickup'],
  day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  consent: ['web-checkout', 'phone-staff'],
  method: ['cash', 'sepay'],
  'delivery.when': ['any', 'subtotal-gte', 'subtotal-lt'],
  'deliveries.tab': ['ready', 'out', 'failed'],
  'deliveries.empty': ['ready', 'out', 'failed', 'filtered'],
  'deliveries.failReason': ['unreachable', 'wrong-address', 'refused', 'other'],
};

describe('O3 admin translations', () => {
  it('has VI and EN for every key the screens use', () => {
    const used = new Set<string>();
    const collect = (source: string) => {
      for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(match[1]);
    };
    for (const dir of O3_DIRS) {
      for (const file of files(join(ROOT, dir))) {
        if (file.endsWith('.test.ts')) continue;
        collect(readFileSync(file, 'utf8'));
      }
    }
    for (const file of EXTRA_FILES) collect(readFileSync(join(ROOT, file), 'utf8'));
    for (const [prefix, values] of Object.entries(DYNAMIC)) {
      for (const value of values) used.add(`${prefix}.${value}`);
    }
    const known = (key: string) =>
      Boolean(o3Messages[key] || o4Messages[key] || o5Messages[key] || o6Messages[key]);
    const missing = [...used].filter((key) => !known(key));
    expect(missing).toEqual([]);
    for (const [key, [vi, en]] of Object.entries({
      ...o3Messages,
      ...o4Messages,
      ...o5Messages,
      ...o6Messages,
    })) {
      expect(vi.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
    }
  });
});
