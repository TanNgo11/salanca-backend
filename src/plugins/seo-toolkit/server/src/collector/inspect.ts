import type { Core, UID } from '@strapi/strapi';

import type { SeoToolkitConfig } from '../config';

export interface InspectResult {
  problems: string[];
}

interface AttributeLike {
  type?: string;
  component?: string;
  repeatable?: boolean;
}

interface SchemaLike {
  attributes?: Record<string, AttributeLike>;
}

const STRING_LIKE_ATTRIBUTES = new Set(['string', 'text', 'uid', 'email', 'richtext']);
const MEDIA_ATTRIBUTE = 'media';
const BOOLEAN_ATTRIBUTE = 'boolean';

/** `seoField` is one block name or several; a missing value means the default `seo`. */
const seoFieldsOf = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : [value ?? 'seo'];

const isStringLike = (attribute: AttributeLike | undefined): boolean =>
  Boolean(attribute?.type && STRING_LIKE_ATTRIBUTES.has(attribute.type));

const inspectSeoField = (
  uid: string,
  seoField: string,
  contentType: SchemaLike,
  components: Record<string, SchemaLike>,
  fields: SeoToolkitConfig['fields'],
): string[] => {
  const problems: string[] = [];
  const attribute = contentType.attributes?.[seoField];
  if (!attribute || attribute.type !== 'component') {
    problems.push(`${uid}: SEO field "${seoField}" is not a component attribute`);
    return problems;
  }
  if (attribute.repeatable === true) {
    problems.push(`${uid}: SEO field "${seoField}" must not be repeatable`);
    return problems;
  }

  const componentUid = attribute.component;
  const component = componentUid ? components[componentUid] : undefined;
  if (!component?.attributes) {
    problems.push(`${uid}: component "${componentUid ?? seoField}" is not registered`);
    return problems;
  }
  const componentAttributes = component.attributes;
  if (!componentAttributes[fields.title]) {
    problems.push(`${uid}: component "${componentUid}" has no "${fields.title}" field`);
  }
  if (!componentAttributes[fields.description]) {
    problems.push(`${uid}: component "${componentUid}" has no "${fields.description}" field`);
  }
  if (fields.image !== null && componentAttributes[fields.image]?.type !== MEDIA_ATTRIBUTE) {
    problems.push(`${uid}: component "${componentUid}" has no media field "${fields.image}"`);
  }
  if (fields.noIndex !== null && componentAttributes[fields.noIndex]?.type !== BOOLEAN_ATTRIBUTE) {
    problems.push(`${uid}: component "${componentUid}" has no boolean field "${fields.noIndex}"`);
  }
  return problems;
};

/**
 * Schema check for the configured content types (spec §2). Returns human-readable English
 * problems; it never throws, so an invalid config is logged at bootstrap instead of crashing
 * the CMS. `run` surfaces the problems as a 400 (CLI exit 2).
 */
export function inspectConfig(strapi: Core.Strapi, config: SeoToolkitConfig): InspectResult {
  const problems: string[] = [];
  const components = strapi.components as unknown as Record<string, SchemaLike>;

  for (const [uid, settings] of Object.entries(config.contentTypes)) {
    const contentType = strapi.contentType(uid as UID.ContentType) as unknown as
      | SchemaLike
      | undefined;
    if (!contentType?.attributes) {
      problems.push(`${uid}: content type is not registered`);
      continue;
    }
    if (settings?.labelField && !isStringLike(contentType.attributes[settings.labelField])) {
      problems.push(`${uid}: label field "${settings.labelField}" is not a string attribute`);
    }
    for (const seoField of seoFieldsOf(settings?.seoField)) {
      problems.push(...inspectSeoField(uid, seoField, contentType, components, config.fields));
    }
  }

  return { problems };
}
