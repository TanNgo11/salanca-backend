import { describe, expect, it } from 'vitest';

import { customerTemplateFor, formatLocalTime, formatVnd, renderTemplate } from './templates';

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
    expect(customerTemplateFor('preparing', false)).toBe('customer.order-accepted');
    expect(customerTemplateFor('preparing', true)).toBe('customer.order-delayed');
    expect(customerTemplateFor('rejected', false)).toBe('customer.order-rejected');
    expect(customerTemplateFor('awaiting-acceptance', false)).toBeNull();
  });

  it('formats money and branch-local time', () => {
    expect(formatVnd(175000)).toBe('175.000đ');
    expect(formatLocalTime('2026-10-12T05:30:00.000Z', 'Asia/Ho_Chi_Minh')).toBe('12:30 · 12/10');
  });
});
