import { describe, expect, it } from 'vitest';

import config from './index';

const defaults = config.default;
const validate = (value: unknown) => config.validator(value);
const withOverrides = (over: Record<string, unknown>) => ({
  ...structuredClone(defaults),
  ...over,
});

describe('seo-toolkit config validator', () => {
  it('accepts the defaults', () => {
    expect(() => validate(structuredClone(defaults))).not.toThrow();
  });

  it('rejects contentTypes given as an array and names the key', () => {
    expect(() => validate(withOverrides({ contentTypes: [] }))).toThrow(/contentTypes/);
  });

  it('rejects a non-positive or non-integer title limit', () => {
    for (const title of [0, -1, 1.5]) {
      expect(() =>
        validate(withOverrides({ limits: { title, description: 160 } })),
      ).toThrow(/limits\.title/);
    }
  });

  it('rejects an unknown severity code', () => {
    expect(() => validate(withOverrides({ severities: { 'seo.unknown': 'warn' } }))).toThrow(
      /seo\.unknown/,
    );
  });

  it('rejects an unknown severity value', () => {
    expect(() => validate(withOverrides({ severities: { 'seo.noindex-set': 'loud' } }))).toThrow();
  });

  it('accepts null image and noIndex field names', () => {
    expect(() =>
      validate(
        withOverrides({
          fields: {
            title: 'metaTitle',
            description: 'metaDescription',
            image: null,
            noIndex: null,
          },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects an empty title field name', () => {
    expect(() => validate(withOverrides({ fields: { ...defaults.fields, title: '' } }))).toThrow(
      /fields\.title/,
    );
  });

  it('accepts seoField as an array of block names', () => {
    expect(() =>
      validate(
        withOverrides({
          contentTypes: { 'api::page.page': { seoField: ['seo', 'cateringSeo'] } },
        }),
      ),
    ).not.toThrow();
  });
});
