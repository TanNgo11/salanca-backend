import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import type { SeoToolkitConfig } from '../config';
import { collectEntries } from './collect';

type Row = Record<string, unknown>;

interface FakeOptions {
  contentTypes?: Record<string, unknown>;
  locales?: { code: string }[];
  localized?: (contentType: unknown) => boolean;
  rowsByUid?: Record<string, Row[]>;
  onFindMany?: (uid: string, params: Record<string, unknown>) => void;
}

const makeStrapi = (options: FakeOptions = {}): Core.Strapi => {
  const contentTypes = options.contentTypes ?? {};
  const locales = options.locales ?? [{ code: 'vi' }, { code: 'en' }];
  return {
    contentType: (uid: string) => contentTypes[uid],
    components: {},
    plugin: (name: string) => ({
      service: (service: string) => {
        if (name === 'i18n' && service === 'locales') {
          return { find: async () => locales, getDefaultLocale: async () => locales[0]?.code };
        }
        if (name === 'i18n' && service === 'content-types') {
          return { isLocalizedContentType: options.localized ?? (() => true) };
        }
        return {};
      },
    }),
    documents: (uid: string) => ({
      findMany: async (params: Record<string, unknown>) => {
        options.onFindMany?.(uid, params);
        const rows = options.rowsByUid?.[uid] ?? [];
        const start = Number(params.start ?? 0);
        const limit = Number(params.limit ?? rows.length);
        return rows.slice(start, start + limit);
      },
    }),
  } as unknown as Core.Strapi;
};

const baseConfig = (over: Partial<SeoToolkitConfig> = {}): SeoToolkitConfig => ({
  contentTypes: { 'api::page.page': {} },
  fields: {
    title: 'metaTitle',
    description: 'metaDescription',
    image: 'shareImage',
    noIndex: 'noIndex',
  },
  status: 'published',
  limits: { title: 60, description: 160 },
  severities: {},
  ...over,
});

describe('collectEntries', () => {
  it('paginates explicitly and reads every row', async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      documentId: `d${index}`,
      seo: null,
    }));
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::page.page': {} },
      localized: () => false,
      rowsByUid: { 'api::page.page': rows },
      onFindMany: (_uid, params) => calls.push(params),
    });

    const result = await collectEntries(strapi, baseConfig(), { status: 'published' });

    expect(result.entries).toHaveLength(250);
    expect(calls.map((call) => call.start)).toEqual([0, 100, 200]);
    expect(calls.every((call) => call.limit === 100)).toBe(true);
  });

  it('requests every locale for an i18n content type and maps row locales', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::page.page': {} },
      localized: () => true,
      locales: [{ code: 'vi' }, { code: 'en' }],
      rowsByUid: {
        'api::page.page': [
          { documentId: 'd1', locale: 'vi', seo: null },
          { documentId: 'd1', locale: 'en', seo: null },
        ],
      },
      onFindMany: (_uid, params) => calls.push(params),
    });

    const result = await collectEntries(strapi, baseConfig(), { status: 'published' });

    expect(calls[0].locale).toBe('*');
    expect(result.entries.map((entry) => entry.locale)).toEqual(['vi', 'en']);
    expect(result.locales).toEqual(['en', 'vi']);
  });

  it('does not pass a locale for a non-i18n content type and maps locale null', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::plain.plain': {} },
      localized: () => false,
      rowsByUid: { 'api::plain.plain': [{ documentId: 'd1', locale: 'vi', seo: null }] },
      onFindMany: (_uid, params) => calls.push(params),
    });

    const result = await collectEntries(
      strapi,
      baseConfig({ contentTypes: { 'api::plain.plain': {} } }),
      { status: 'published' },
    );

    expect('locale' in calls[0]).toBe(false);
    expect(result.entries[0].locale).toBeNull();
  });

  it('passes the requested status to the document service', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::plain.plain': {} },
      localized: () => false,
      rowsByUid: { 'api::plain.plain': [] },
      onFindMany: (_uid, params) => calls.push(params),
    });

    await collectEntries(strapi, baseConfig({ contentTypes: { 'api::plain.plain': {} } }), {
      status: 'draft',
    });

    expect(calls[0].status).toBe('draft');
  });

  it('normalizes the SEO block, image and noIndex', async () => {
    const strapi = makeStrapi({
      contentTypes: { 'api::plain.plain': {} },
      localized: () => false,
      rowsByUid: {
        'api::plain.plain': [
          { documentId: 'a', seo: null },
          {
            documentId: 'b',
            seo: { metaTitle: 'T', metaDescription: 'D', shareImage: null, noIndex: true },
          },
          { documentId: 'c', seo: { shareImage: { alternativeText: '  ' } } },
          { documentId: 'd', seo: { shareImage: { alternativeText: 'ok' } } },
        ],
      },
    });

    const result = await collectEntries(
      strapi,
      baseConfig({ contentTypes: { 'api::plain.plain': {} } }),
      { status: 'published' },
    );
    const byId = Object.fromEntries(result.entries.map((entry) => [entry.documentId, entry]));

    expect(byId.a.seo).toBeNull();
    expect(byId.b.seo).toEqual({
      title: 'T',
      description: 'D',
      image: null,
      noIndex: true,
    });
    expect(byId.c.seo).toEqual({
      title: null,
      description: null,
      image: { alternativeText: '  ' },
      noIndex: null,
    });
    expect(byId.d.seo?.image).toEqual({ alternativeText: 'ok' });
  });

  it('skips rows outside the requested locale scope', async () => {
    const strapi = makeStrapi({
      contentTypes: { 'api::page.page': {} },
      localized: () => true,
      locales: [{ code: 'vi' }, { code: 'en' }, { code: 'fr' }],
      rowsByUid: {
        'api::page.page': [
          { documentId: 'd1', locale: 'vi', seo: null },
          { documentId: 'd1', locale: 'en', seo: null },
        ],
      },
    });

    const result = await collectEntries(strapi, baseConfig(), {
      status: 'published',
      locales: ['vi'],
    });

    expect(result.locales).toEqual(['vi']);
    expect(result.entries.map((entry) => entry.locale)).toEqual(['vi']);
  });

  it('only reads the requested content types', async () => {
    const seen: string[] = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::a.a': {}, 'api::b.b': {} },
      localized: () => false,
      rowsByUid: { 'api::a.a': [], 'api::b.b': [] },
      onFindMany: (uid) => seen.push(uid),
    });

    await collectEntries(strapi, baseConfig({ contentTypes: { 'api::a.a': {}, 'api::b.b': {} } }), {
      status: 'published',
      contentTypes: ['api::b.b'],
    });

    expect(seen).toEqual(['api::b.b']);
  });

  it('populates the share image only when the field is configured', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::plain.plain': {} },
      localized: () => false,
      rowsByUid: { 'api::plain.plain': [] },
      onFindMany: (_uid, params) => calls.push(params),
    });

    await collectEntries(strapi, baseConfig({ contentTypes: { 'api::plain.plain': {} } }), {
      status: 'published',
    });
    await collectEntries(
      strapi,
      baseConfig({
        contentTypes: { 'api::plain.plain': {} },
        fields: { title: 'metaTitle', description: 'metaDescription', image: null, noIndex: null },
      }),
      { status: 'published' },
    );

    expect(calls[0].populate).toEqual({ seo: { populate: { shareImage: true } } });
    expect(calls[1].populate).toEqual({ seo: true });
  });

  it('reads the label from the configured label field', async () => {
    const strapi = makeStrapi({
      contentTypes: { 'api::plain.plain': {} },
      localized: () => false,
      rowsByUid: { 'api::plain.plain': [{ documentId: 'd1', slug: 'hello', seo: null }] },
    });

    const result = await collectEntries(
      strapi,
      baseConfig({ contentTypes: { 'api::plain.plain': { labelField: 'slug' } } }),
      { status: 'published' },
    );

    expect(result.entries[0].label).toBe('hello');
  });

  it('emits one entry per SEO block and populates every block', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const strapi = makeStrapi({
      contentTypes: { 'api::page.page': {} },
      localized: () => false,
      rowsByUid: {
        'api::page.page': [{ documentId: 'd1', seo: { metaTitle: 'A' }, cateringSeo: null }],
      },
      onFindMany: (_uid, params) => calls.push(params),
    });

    const result = await collectEntries(
      strapi,
      baseConfig({ contentTypes: { 'api::page.page': { seoField: ['seo', 'cateringSeo'] } } }),
      { status: 'published' },
    );

    expect(result.entries.map((entry) => entry.seoField)).toEqual(['seo', 'cateringSeo']);
    expect(result.entries[0].seo?.title).toBe('A');
    expect(result.entries[1].seo).toBeNull();
    expect(calls[0].populate).toEqual({
      seo: { populate: { shareImage: true } },
      cateringSeo: { populate: { shareImage: true } },
    });
  });
});
