import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import {
  markdownToHtml,
  markdownToText,
  renderCustom,
  validateTemplateVars,
} from './render-custom';
import { defaultTemplateSource, type TemplateData } from './templates';
import { buildVars, sampleDataFor, TEMPLATE_CODES, variablesFor } from './template-vars';

const data = sampleDataFor('customer.order-ready') as TemplateData;

describe('renderCustom', () => {
  it('substitutes allowed variables in subject and body', () => {
    const rendered = renderCustom(
      'customer.order-ready',
      'vi',
      { subject: 'Đơn {{code}} xong rồi', body: 'Mời bạn tới **{{branch}}** nhận.' },
      data,
    );
    expect(rendered.subject).toBe('Đơn A1B2C3 xong rồi');
    expect(rendered.text).toBe('Mời bạn tới Quán Quận 1 nhận.');
    expect(rendered.html).toContain('<strong>Quán Quận 1</strong>');
  });

  it('rejects an unknown variable with TEMPLATE_VARIABLE_UNKNOWN', () => {
    try {
      renderCustom('customer.order-ready', 'vi', { subject: 'x', body: '{{hack}}' }, data);
      expect.unreachable();
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('TEMPLATE_VARIABLE_UNKNOWN');
      expect(
        (error as { details?: { variables?: string[] } }).details?.variables,
      ).toEqual(['hack']);
    }
  });

  it('rejects malformed variable names too ({{1bad}}, {{a.b}})', () => {
    for (const bad of ['{{1bad}}', '{{a.b}}', '{{}}']) {
      expect(() =>
        validateTemplateVars('customer.order-ready', 'x', bad),
      ).toThrowError(/unknown template variables/);
    }
  });

  it('escapes HTML everywhere — a <script> stays literal text', () => {
    const rendered = renderCustom(
      'customer.order-ready',
      'vi',
      { subject: 'x', body: 'Chú ý: {{branch}}' },
      { ...data, branchName: '<script>alert(1)</script>' },
    );
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&#60;script&#62;');
    expect(rendered.text).toContain('<script>'); // plain text keeps the literal value
  });

  it('drops a line holding only an empty variable, keeps label rows intact', () => {
    const without = renderCustom(
      'customer.order-ready',
      'vi',
      { subject: 'x', body: 'Chào bạn\n\n{{pickup}}\n- Tổng: {{total}}' },
      { ...data, pickupLabel: undefined },
    );
    expect(without.text).toBe('Chào bạn\n\n- Tổng: 148.000đ');
    const withPickup = renderCustom(
      'customer.order-ready',
      'vi',
      { subject: 'x', body: '{{pickup}}' },
      data,
    );
    expect(withPickup.html).toBe('<ul><li>Giờ lấy: 12:30 · 12/10</li></ul>');
  });

  it('renders https links and drops javascript: URLs', () => {
    const good = markdownToHtml('[Xem đơn](https://a.b/c?x=1&y=2)');
    expect(good).toContain('<a href="https://a.b/c?x=1&#38;y=2"');
    const bad = markdownToHtml('[bấm](javascript:alert(1))');
    expect(bad).not.toContain('javascript:');
    expect(bad).not.toContain('<a ');
    expect(bad).toContain('bấm');
  });

  it('renders - lines as a <ul> list and keeps bullets in text', () => {
    const html = markdownToHtml('- một\n- hai');
    expect(html).toBe('<ul><li>một</li><li>hai</li></ul>');
    expect(markdownToText('- một\n- hai')).toBe('- một\n- hai');
  });

  it('keeps markdown metachars in data literal — no injected bold or links', () => {
    const rendered = renderCustom(
      'customer.order-ready',
      'vi',
      { subject: 'x', body: '{{note}}' },
      { ...data, note: '**không đậm** và [x](javascript:1)' },
    );
    expect(rendered.html).not.toContain('<strong>');
    expect(rendered.html).not.toContain('<a ');
    // Text output shows the literal markers — escaped data never parses as markdown.
    expect(rendered.text).toContain('**không đậm**');
  });

  it('the default source round-trips every template without errors', () => {
    for (const code of TEMPLATE_CODES) {
      for (const locale of ['vi', 'en'] as const) {
        const source = defaultTemplateSource(code, locale);
        const rendered = renderCustom(code, locale, source, sampleDataFor(code));
        expect(rendered.subject.length, `${code}/${locale} subject`).toBeGreaterThan(0);
        expect(rendered.html, `${code}/${locale} html`).toContain('<');
        // Every allowed var name is still valid when the default uses it.
        expect(() =>
          validateTemplateVars(code, source.subject, source.body),
        ).not.toThrow();
      }
    }
  });

  it('buildVars provides a value slot for every declared variable', () => {
    for (const code of TEMPLATE_CODES) {
      const vars = buildVars(code, 'vi', sampleDataFor(code));
      for (const variable of variablesFor(code)) {
        expect(vars, `${code} is missing {{${variable.name}}}`).toHaveProperty(variable.name);
      }
    }
  });
});
