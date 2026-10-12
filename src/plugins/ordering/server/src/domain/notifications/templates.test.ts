import { describe, expect, it } from 'vitest';

import {
  customerTemplateFor,
  deliveryFailureReason,
  formatLocalTime,
  formatVnd,
  renderTemplate,
} from './templates';

const data = {
  code: 'SLC-000124',
  branchName: 'Salanca Q1',
  total: 175000,
  items: [{ title: 'Bún bò <Huế>', quantity: 1 }],
  readyLabel: '12:50 · 12/10',
  link: 'https://salanca.example/don-hang#t=abc',
};

describe('email templates', () => {
  it('renders VI by default and EN for English orders', () => {
    const vi = renderTemplate('customer.order-delayed', 'vi', data);
    expect(vi.subject).toBe('Đơn SLC-000124: giờ lấy mới');
    expect(vi.text).toContain('Dự kiến sẵn sàng: 12:50 · 12/10');
    expect(vi.text).toContain('Tổng: 175.000đ');
    const en = renderTemplate('customer.order-ready', 'en', data);
    expect(en.subject).toBe('Order SLC-000124 is ready');
    expect(renderTemplate('customer.order-ready', null, data).subject).toBe('Đơn SLC-000124 đã sẵn sàng');
  });

  it('escapes HTML and falls back to the lookup hint without a link', () => {
    const html = renderTemplate('customer.order-placed', 'vi', data).html;
    expect(html).toContain('Bún bò &#60;Huế&#62;');
    expect(html).not.toContain('<Huế>');
    const noLink = renderTemplate('customer.order-placed', 'vi', { ...data, link: undefined });
    expect(noLink.text).toContain('Tra cứu đơn bằng mã đơn');
  });

  it('maps transitions to customer templates', () => {
    expect(customerTemplateFor('preparing', {})).toBe('customer.order-accepted');
    expect(customerTemplateFor('preparing', { delayed: true })).toBe('customer.order-delayed');
    expect(customerTemplateFor('rejected', {})).toBe('customer.order-rejected');
    expect(customerTemplateFor('awaiting-acceptance', {})).toBeNull();
  });

  it('uses delivery wording on delivery orders, never pickup phrases', () => {
    const delivery = { receiveKind: 'delivery' };
    expect(customerTemplateFor('out-for-delivery', delivery)).toBe('customer.delivery-out');
    expect(customerTemplateFor('delivered', delivery)).toBe('customer.delivery-delivered');
    expect(customerTemplateFor('failed', delivery)).toBe('customer.delivery-failed');
    // The first "ready" of a delivery leg mails nothing; the dispatch mail follows right after.
    expect(customerTemplateFor('ready', { receiveKind: 'delivery', from: 'preparing' })).toBeNull();
    expect(customerTemplateFor('ready', { receiveKind: 'delivery', from: 'failed' })).toBe(
      'customer.delivery-retry',
    );
    // Pickup keeps its wording on the same targets.
    expect(customerTemplateFor('ready', {})).toBe('customer.order-ready');
    expect(customerTemplateFor('delivered', {})).toBe('customer.order-delivered');

    const vi = renderTemplate('customer.delivery-out', 'vi', data);
    expect(vi.subject).toBe('Đơn SLC-000124 đang được giao');
    expect(vi.text).not.toContain('đến');
    expect(vi.text).not.toContain('nhận.');
    const en = renderTemplate('customer.delivery-failed', 'en', {
      ...data,
      reason: deliveryFailureReason('unreachable', 'en'),
    });
    expect(en.subject).toBe('Delivery of order SLC-000124 failed');
    expect(en.text).toContain('Reason: We could not reach you');
    expect(deliveryFailureReason('refused', 'vi')).toBe('Khách từ chối nhận');
  });

  it('labels a delivery slot as "Giao lúc", not "Giờ lấy"', () => {
    const text = renderTemplate('customer.delivery-out', 'vi', {
      ...data,
      deliveryLabel: '14:00 · 13/10',
    }).text;
    expect(text).toContain('Giao lúc: 14:00 · 13/10');
    expect(text).not.toContain('Giờ lấy');
  });

  it('formats money and branch-local time', () => {
    expect(formatVnd(175000)).toBe('175.000đ');
    expect(formatLocalTime('2026-10-12T05:30:00.000Z', 'Asia/Ho_Chi_Minh')).toBe('12:30 · 12/10');
  });
});
