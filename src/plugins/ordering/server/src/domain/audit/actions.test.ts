import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  CATALOG_AUDITED_TYPES,
  auditActionForTimeline,
  auditCategoryOf,
  auditLabelOf,
} from './actions';

const SERVER_SRC = join(__dirname, '..', '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });

/** Action literals passed to change-log `record({ action: '…' })` and payment-review `audit('…')`. */
const recordedActions = (): Array<{ file: string; action: string }> => {
  const found: Array<{ file: string; action: string }> = [];
  for (const file of sourceFiles(SERVER_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\.record\(\s*\{\s*action:\s*'([^']+)'/g)) {
      found.push({ file, action: match[1] });
    }
    for (const match of text.matchAll(/\baudit\(\s*'([a-z-]+\.[a-z-]+)'/g)) {
      found.push({ file, action: match[1] });
    }
    for (const match of text.matchAll(/\baudit\(\s*\n\s*'([a-z-]+\.[a-z-]+)'/g)) {
      found.push({ file, action: match[1] });
    }
  }
  return found;
};

describe('audit action catalog', () => {
  it('has a category and both labels for every action', () => {
    for (const [action, def] of Object.entries(AUDIT_ACTIONS)) {
      expect(AUDIT_CATEGORIES, action).toContain(def.category);
      expect(def.label[0].length, action).toBeGreaterThan(0);
      expect(def.label[1].length, action).toBeGreaterThan(0);
    }
  });

  it('covers every literal action recorded in the server source', () => {
    const recorded = recordedActions();
    expect(recorded.length).toBeGreaterThan(15);
    const missing = recorded.filter(({ action }) => !(action in AUDIT_ACTIONS));
    expect(missing).toEqual([]);
  });

  it('covers every catalog middleware action (uid × create/update/delete)', () => {
    for (const [type] of CATALOG_AUDITED_TYPES) {
      for (const verb of ['create', 'update', 'delete']) {
        expect(AUDIT_ACTIONS, `${type}.${verb}`).toHaveProperty(`${type}.${verb}`);
      }
    }
  });

  it('falls back to "other" and the raw code for unknown actions', () => {
    expect(auditCategoryOf('made-up.thing')).toBe('other');
    expect(auditLabelOf('made-up.thing', 'vi')).toBe('made-up.thing');
    expect(auditLabelOf('order.cancel', 'en')).toBe('Cancel order');
    expect(auditLabelOf('order.cancel', 'vi')).toBe('Hủy đơn');
  });
});

describe('auditActionForTimeline', () => {
  const transition = (from: string, to: string, extra: Record<string, unknown> = {}) =>
    auditActionForTimeline('fulfillment-group.transitioned', { from, to, ...extra });

  it('maps group transitions to order/delivery actions', () => {
    expect(transition('preparing', 'canceled')?.action).toBe('order.cancel');
    expect(transition('awaiting-acceptance', 'rejected')?.action).toBe('order.reject');
    expect(transition('ready', 'out-for-delivery')?.action).toBe('delivery.dispatch');
    expect(transition('out-for-delivery', 'failed')?.action).toBe('delivery.fail');
    expect(transition('failed', 'ready')?.action).toBe('delivery.retry');
    expect(transition('ready', 'delivered')?.action).toBe('order.complete');
    expect(transition('awaiting-acceptance', 'preparing')?.action).toBe('order.transition');
  });

  it('keeps only reason codes, never free-text reasons', () => {
    const coded = transition('preparing', 'canceled', { reasonCode: 'out-of-stock', reason: 'x' });
    expect(coded?.after).toEqual({ status: 'canceled', reasonCode: 'out-of-stock' });
    const freeText = transition('preparing', 'canceled', { reason: 'Khách Lan 0901234567 đổi ý' });
    expect(freeText?.after).toEqual({ status: 'canceled' });
  });

  it('maps line cancels, cash captures and draft confirms; ignores the rest', () => {
    expect(
      auditActionForTimeline('order.line.canceled', { lineId: 3, quantity: 1, amount: 45000, reason: 'note' }),
    ).toEqual({ action: 'order.line-cancel', after: { lineId: 3, quantity: 1, amount: 45000 } });
    expect(auditActionForTimeline('payment.captured', { providerCode: 'cash', amount: 1, paymentId: 2 })?.action).toBe(
      'payment.cash-capture',
    );
    expect(auditActionForTimeline('payment.captured', { providerCode: 'sepay', amount: 1 })).toBeNull();
    expect(auditActionForTimeline('order.confirmed', {})?.action).toBe('order.confirm-draft');
    expect(auditActionForTimeline('note', { text: 'x' })).toBeNull();
    expect(auditActionForTimeline('order.placed', {})).toBeNull();
  });
});
