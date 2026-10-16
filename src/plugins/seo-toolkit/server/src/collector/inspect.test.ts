import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import type { SeoToolkitConfig } from '../config';
import { inspectConfig } from './inspect';

type Schema = { attributes?: Record<string, Record<string, unknown>> };
type Fields = SeoToolkitConfig['fields'];

const makeStrapi = (
  contentTypes: Record<string, Schema>,
  components: Record<string, Schema>,
): Core.Strapi =>
  ({ contentType: (uid: string) => contentTypes[uid], components }) as unknown as Core.Strapi;

const defaultFields: Fields = {
  title: 'metaTitle',
  description: 'metaDescription',
  image: 'shareImage',
  noIndex: 'noIndex',
};

const cfg = (
  contentTypes: Record<string, { seoField?: string | string[]; labelField?: string }>,
  fields: Fields = defaultFields,
): SeoToolkitConfig => ({
  contentTypes,
  fields,
  status: 'published',
  limits: { title: 60, description: 160 },
  severities: {},
});

const seoComponent: Schema = {
  attributes: {
    metaTitle: { type: 'string' },
    metaDescription: { type: 'text' },
    shareImage: { type: 'media' },
    noIndex: { type: 'boolean' },
  },
};

const pageType: Schema = {
  attributes: {
    seo: { type: 'component', component: 'shared.seo', repeatable: false },
    slug: { type: 'uid' },
  },
};

describe('inspectConfig', () => {
  it('accepts a valid configuration', () => {
    const strapi = makeStrapi({ 'api::page.page': pageType }, { 'shared.seo': seoComponent });

    expect(inspectConfig(strapi, cfg({ 'api::page.page': {} })).problems).toEqual([]);
  });

  it('reports an unregistered content type', () => {
    const strapi = makeStrapi({}, {});

    expect(inspectConfig(strapi, cfg({ 'api::missing.missing': {} })).problems[0]).toContain(
      'api::missing.missing',
    );
  });

  it('reports a seoField that is not a component', () => {
    const strapi = makeStrapi({ 'api::page.page': { attributes: { seo: { type: 'string' } } } }, {});

    expect(inspectConfig(strapi, cfg({ 'api::page.page': {} })).problems.join(' ')).toContain(
      'not a component',
    );
  });

  it('reports a component missing a required field', () => {
    const strapi = makeStrapi({ 'api::page.page': pageType }, {
      'shared.seo': { attributes: { metaTitle: { type: 'string' } } },
    });

    expect(inspectConfig(strapi, cfg({ 'api::page.page': {} })).problems.join(' ')).toContain(
      'metaDescription',
    );
  });

  it('accepts a component without image/noIndex when those fields are null', () => {
    const strapi = makeStrapi({ 'api::page.page': pageType }, {
      'shared.seo': { attributes: { metaTitle: { type: 'string' }, metaDescription: { type: 'text' } } },
    });

    expect(
      inspectConfig(strapi, cfg({ 'api::page.page': {} }, { ...defaultFields, image: null, noIndex: null }))
        .problems,
    ).toEqual([]);
  });

  it('reports a labelField that is not a string attribute', () => {
    const strapi = makeStrapi(
      {
        'api::page.page': {
          attributes: {
            seo: { type: 'component', component: 'shared.seo', repeatable: false },
            order: { type: 'integer' },
          },
        },
      },
      { 'shared.seo': seoComponent },
    );

    expect(
      inspectConfig(strapi, cfg({ 'api::page.page': { labelField: 'order' } })).problems.join(' '),
    ).toContain('label field "order"');
  });

  it('validates every block when seoField is an array', () => {
    const strapi = makeStrapi(
      {
        'api::page.page': {
          attributes: {
            seo: { type: 'component', component: 'shared.seo', repeatable: false },
            cateringSeo: { type: 'string' },
          },
        },
      },
      { 'shared.seo': seoComponent },
    );

    expect(
      inspectConfig(strapi, cfg({ 'api::page.page': { seoField: ['seo', 'cateringSeo'] } }))
        .problems.join(' '),
    ).toContain('cateringSeo');
  });
});
