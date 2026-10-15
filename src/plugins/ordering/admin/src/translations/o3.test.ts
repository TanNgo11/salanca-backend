import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { o3Messages } from './o3';
import { o4Messages } from './o4';
import { o5Messages } from './o5';
import { o6Messages } from './o6';
import { o7Messages } from './o7';
import { o15Messages } from './o15';
import { o10Messages } from './o10';
import { o8Messages } from './o8';
import { o9Messages } from './o9';
import { o11Messages } from './o11';
import { o13Messages } from './o13';
import { o14Messages } from './o14';
import { o12Messages } from './o12';
import { o16Messages } from './o16';

const ROOT = join(__dirname, '..');
const O3_DIRS = ['inbox', 'components/orders', 'pages/Orders', 'pages/Deliveries', 'pages/Courier', 'pages/Branches', 'pages/Staff', 'pages/Settings', 'pages/PaymentReview', 'pages/Ops', 'pages/Alerts', 'pages/CashClosing', 'pages/Reports', 'pages/AuditLog', 'pages/Webhooks', 'pages/CatalogImport', 'pages/ApiDocs', 'pages/Customers', 'pages/DataRequests', 'pages/Promotions', 'pages/Ratings', 'pages/PriceLists', 'pages/CustomerGroups', 'pages/GiftCards', 'pages/Loyalty', 'pages/Kitchen', 'pages/Tables', 'pages/TableSessions', 'pages/Print', 'custom-fields', 'lib'];
const EXTRA_FILES = ['pages/App.tsx', 'components/OrderExportModal.tsx'];

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
  method: ['cash', 'sepay', 'gift-card'],
  'delivery.when': ['any', 'subtotal-gte', 'subtotal-lt'],
  'deliveries.tab': ['ready', 'out', 'failed'],
  'deliveries.empty': ['ready', 'out', 'failed', 'filtered'],
  'deliveries.failReason': ['unreachable', 'wrong-address', 'refused', 'other'],
  'audit.category': ['all', 'money', 'order', 'catalog', 'delivery', 'config', 'access', 'ops', 'promotion', 'other'],
  'promo.tab': ['running', 'scheduled', 'off', 'expired', 'all'],
  'promo.col': ['name', 'discount', 'conditions', 'time', 'used', 'total', 'active'],
  'promo.kind': ['code', 'auto'],
  'promo.type': ['percent', 'amount', 'free-delivery', 'delivery-amount'],
  'promo.target': ['order', 'products', 'categories'],
  'promo.receive': ['pickup', 'delivery'],
  'promo.codes.col': ['code', 'used', 'batch', 'active', 'created'],
  'promo.stats.col': ['order', 'date', 'branch', 'code', 'amount', 'status'],
  'promo.redemption': ['reserved', 'applied', 'released'],
  'promo.reason': ['invalid', 'not-started', 'ended', 'code-used', 'usage-limit', 'min-subtotal', 'location', 'receive-kind', 'time', 'products', 'fulfillment', 'not-best'],
  'rating.col': ['stars', 'tags', 'comment', 'order', 'branch', 'at'],
  'settings.rating.sentiment': ['positive', 'negative'],
  'reports.group': ['day', 'category', 'product', 'payment', 'receive', 'promotion'],
  'reports.col': ['promotion', 'discount'],
  'alert.code': ['low-rating', 'gift-card-probing', 'notification-daily-limit'],
  'webhook.group': ['order', 'fulfillment', 'payment', 'refund', 'ops', 'promotion', 'gift-card', 'rating'],
  'webhook.deliveries.filter': ['all', 'pending', 'succeeded', 'failed'],
  'error.WEBHOOK_URL_INVALID': ['scheme', 'invalid', 'private-address', 'unresolvable'],
  'x3.kind': ['products', 'modifiers'],
  'x3.status': ['validated', 'applied', 'failed'],
  'x4.audience': ['staff', 'customer'],
  'price.kind': ['override', 'adjust'],
  'price.channel': ['pickup', 'delivery', 'dine-in', 'staff'],
  'price.adjust': ['percent', 'amount'],
  'price.target': ['all', 'categories', 'products'],
  'group.source': ['manual', 'auto'],
  'card.tab': ['active', 'blocked', 'expired', 'zero', 'all'],
  'card.filter': ['sold', 'manual'],
  'card.source': ['sale', 'manual', 'batch'],
  'card.status': ['inactive', 'active', 'blocked', 'expired'],
  'card.mail': ['sent', 'pending', 'failed', 'skipped', 'none'],
  'card.summary': ['outstanding', 'sold', 'redeemed'],
  'card.col': ['card', 'denomination', 'balance', 'expiry', 'source', 'status', 'issuedAt'],
  'ledger.col': ['at', 'kind', 'amount', 'balanceAfter', 'order', 'actor', 'reason'],
  'ledger.kind': ['issue', 'activate', 'redeem', 'refund', 'adjust', 'expire', 'block', 'unblock', 'extend'],
  'batch.col': ['code', 'source', 'denomination', 'quantity', 'sold', 'remaining', 'created'],
  'batch.source': ['generated', 'imported'],
  'ops.webhook': ['ok', 'slow', 'failing'],
  'p1.provider': ['cash', 'sepay', 'momo', 'vnpay', 'gift-card', 'self-delivery', 'ahamove', 'ghn', 'email', 'zalo', 'sms'],
  'p1.group': ['payment', 'fulfillment', 'notification'],
  'p1.state': ['configured', 'unconfigured', 'error', 'not-implemented'],
  'p1.env': ['sandbox', 'production'],
  'loyalty.tiers.col': ['name', 'spend', 'multiplier', 'group', 'customers', 'active'],
  'loyalty.customer.col': ['points', 'remaining', 'expires', 'source', 'at', 'kind', 'balanceAfter', 'order', 'actor', 'reason'],
  'loyalty.channel': ['pickup', 'delivery', 'dine-in'],
  'loyalty.kind': ['earn', 'redeem', 'release', 'reverse', 'expire', 'adjust', 'history', 'forfeit'],
  'loyalty.source': ['earn', 'adjust', 'restore'],
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
      Boolean(
        o3Messages[key] ||
          o4Messages[key] ||
          o5Messages[key] ||
          o6Messages[key] ||
          o7Messages[key] ||
          o15Messages[key] ||
          o10Messages[key] ||
          o11Messages[key] ||
          o8Messages[key] ||
          o9Messages[key] ||
          o13Messages[key] ||
          o14Messages[key] ||
          o12Messages[key] ||
          o16Messages[key],
      );
    const missing = [...used].filter((key) => !known(key));
    expect(missing).toEqual([]);
    for (const [key, [vi, en]] of Object.entries({
      ...o3Messages,
      ...o4Messages,
      ...o5Messages,
      ...o6Messages,
      ...o7Messages,
      ...o15Messages,
      ...o10Messages,
      ...o11Messages,
      ...o8Messages,
      ...o9Messages,
      ...o13Messages,
      ...o14Messages,
      ...o12Messages,
      ...o16Messages,
    })) {
      expect(vi.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
    }
  });
});
