import type { Core, UID } from '@strapi/strapi';

import type { AuditEntry, AuditStatus } from '../../../shared/audit/types';
import type { SeoToolkitConfig } from '../config';

const PAGE_SIZE = 100;

export interface AuditRunInput {
  status: AuditStatus;
  contentTypes?: string[];
  locales?: string[];
}

type Row = Record<string, unknown>;

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Configured locales for this run, restricted to `only` when it is non-empty, sorted. */
const loadLocales = async (strapi: Core.Strapi, only?: string[]): Promise<string[]> => {
  const service = strapi.plugin('i18n').service('locales') as unknown as {
    find: () => Promise<{ code?: unknown }[]>;
  };
  const rows = await service.find();
  const codes = rows
    .map((row) => row.code)
    .filter((code): code is string => typeof code === 'string');
  const scoped = only && only.length > 0 ? codes.filter((code) => only.includes(code)) : codes;
  return [...new Set(scoped)].sort();
};

const isLocalized = (strapi: Core.Strapi, contentType: unknown): boolean => {
  const service = strapi.plugin('i18n').service('content-types') as unknown as {
    isLocalizedContentType: (model: unknown) => boolean;
  };
  return service.isLocalizedContentType(contentType);
};

const buildPopulate = (config: SeoToolkitConfig, seoFields: string[]): Row => {
  const populate: Row = {};
  for (const seoField of seoFields) {
    populate[seoField] =
      config.fields.image === null ? true : { populate: { [config.fields.image]: true } };
  }
  return populate;
};

type FindManyCall = (params: Row) => Promise<Row[]>;

/** The Document Service `findMany` param type is heavily generic; pagination is explicit here. */
const readPage = (strapi: Core.Strapi, uid: string, params: Row): Promise<Row[]> =>
  (strapi.documents(uid as UID.ContentType).findMany as unknown as FindManyCall)(params);

const mapSeo = (config: SeoToolkitConfig, value: unknown): AuditEntry['seo'] => {
  if (!isRecord(value)) return null;
  const { title, description, image, noIndex } = config.fields;
  const rawImage = image === null ? undefined : value[image];
  const rawNoIndex = noIndex === null ? undefined : value[noIndex];
  return {
    title: readString(value[title]),
    description: readString(value[description]),
    // undefined is reserved for "this host has no such field"; a configured but absent
    // value is null (the field exists, nothing was set).
    image:
      image === null
        ? undefined
        : rawImage === null || rawImage === undefined
          ? null
          : { alternativeText: isRecord(rawImage) ? readString(rawImage.alternativeText) : null },
    noIndex: noIndex === null ? undefined : typeof rawNoIndex === 'boolean' ? rawNoIndex : null,
  };
};

/**
 * Reads every configured content type through the Document Service and normalizes the rows
 * into audit entries (spec §3b). Read-only; one paginated query per content type.
 */
export async function collectEntries(
  strapi: Core.Strapi,
  config: SeoToolkitConfig,
  run: AuditRunInput,
): Promise<{ entries: AuditEntry[]; locales: string[] }> {
  const locales = await loadLocales(strapi, run.locales);
  const entries: AuditEntry[] = [];
  const uids = Object.keys(config.contentTypes).filter(
    (uid) => !run.contentTypes || run.contentTypes.includes(uid),
  );

  for (const uid of uids) {
    const contentType = strapi.contentType(uid as UID.ContentType);
    if (!contentType) continue;
    const settings = config.contentTypes[uid] ?? {};
    const seoFields = Array.isArray(settings.seoField)
      ? settings.seoField
      : [settings.seoField ?? 'seo'];
    const localized = isLocalized(strapi, contentType);
    const populate = buildPopulate(config, seoFields);

    let start = 0;
    for (;;) {
      const params = {
        status: run.status,
        populate,
        start,
        limit: PAGE_SIZE,
        sort: ['id:asc'],
        ...(localized ? { locale: '*' } : {}),
      };
      const rows = await readPage(strapi, uid, params);

      for (const row of rows) {
        const locale = localized ? readString(row.locale) : null;
        if (localized && locale !== null && !locales.includes(locale)) continue;
        for (const seoField of seoFields) {
          entries.push({
            uid,
            documentId: readString(row.documentId) ?? '',
            locale,
            localized,
            label: settings.labelField ? readString(row[settings.labelField]) : null,
            seoField,
            seo: mapSeo(config, row[seoField]),
          });
        }
      }

      if (rows.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
    }
  }

  return { entries, locales };
}
