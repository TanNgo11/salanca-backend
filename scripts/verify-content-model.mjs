import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const components = [
  'cta',
  'editorial-card',
  'hero',
  'image',
  'link',
  'list-item',
  'operating-period',
  'option',
  'seo',
  'social-link',
  'step',
  'timeline-entry',
];
const contentTypes = {
  'booking-page': 'singleType',
  campaign: 'collectionType',
  'campaign-page': 'singleType',
  'contact-page': 'singleType',
  'experience-page': 'singleType',
  'gallery-item': 'collectionType',
  'global-setting': 'singleType',
  'home-page': 'singleType',
  location: 'collectionType',
  'menu-category': 'collectionType',
  'menu-item': 'collectionType',
  'menu-package': 'collectionType',
  'menu-page': 'singleType',
  'space-page': 'singleType',
  'story-page': 'singleType',
};
const nonLocalizedByContentType = {
  'booking-page': [],
  campaign: ['kind', 'startsAt', 'endsAt', 'isFeatured', 'displayOrder'],
  'campaign-page': [],
  'contact-page': [],
  'experience-page': [],
  'gallery-item': ['area', 'displayOrder', 'isActive'],
  'global-setting': ['hotline', 'email', 'mapUrl'],
  'home-page': [],
  location: ['mapUrl', 'phone', 'email', 'isActive', 'displayOrder'],
  'menu-category': ['displayOrder', 'isActive'],
  'menu-item': ['price', 'isFeatured', 'isActive', 'displayOrder'],
  'menu-package': ['adultPrice', 'childPrice', 'isFeatured', 'isActive', 'displayOrder'],
  'menu-page': [],
  'space-page': [],
  'story-page': [],
};
const nonLocalizedByComponent = {
  cta: [],
  'editorial-card': [],
  hero: [],
  image: ['media'],
  link: ['openInNewTab'],
  'list-item': [],
  'operating-period': ['opensAt', 'closesAt'],
  option: ['value', 'displayOrder'],
  seo: ['shareImage', 'noIndex'],
  'social-link': ['platform', 'url'],
  step: ['number'],
  'timeline-entry': [],
};
const forbiddenTypes = [
  'availability-slot',
  'contact-message',
  'page',
  'payment',
  'reservation-request',
  'table',
];
const errors = [];

function loadJson(path, label) {
  if (!existsSync(path)) {
    errors.push(`Missing ${label}: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`Invalid JSON in ${label}: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const componentSchemas = {};
for (const component of components) {
  const path = join(root, 'src', 'components', 'shared', `${component}.json`);
  const schema = loadJson(path, `component shared.${component}`);
  if (schema) componentSchemas[component] = schema;
}

const schemas = {};
for (const [name, expectedKind] of Object.entries(contentTypes)) {
  const schemaPath = join(
    root,
    'src',
    'api',
    name,
    'content-types',
    name,
    'schema.json',
  );
  const schema = loadJson(schemaPath, `content type ${name}`);
  if (!schema) continue;
  schemas[name] = schema;
  assert(schema.kind === expectedKind, `${name}: expected kind ${expectedKind}`);
  assert(schema.options?.draftAndPublish === true, `${name}: Draft & Publish must be enabled`);
  assert(schema.info?.singularName === name, `${name}: singularName must match directory name`);
  assert(schema.pluginOptions?.i18n?.localized === true, `${name}: i18n must be enabled`);

  const nonLocalizedFields = new Set(nonLocalizedByContentType[name]);
  for (const [field, attribute] of Object.entries(schema.attributes ?? {})) {
    if (attribute.type === 'relation') continue;
    const isLocalized = attribute.pluginOptions?.i18n?.localized === true;
    assert(
      nonLocalizedFields.has(field) ? !isLocalized : isLocalized,
      `${name}.${field}: localization setting does not match the Phase 3 matrix`,
    );
  }

  for (const layer of ['controllers', 'routes', 'services']) {
    const path = join(root, 'src', 'api', name, layer, `${name}.ts`);
    assert(existsSync(path), `${name}: missing ${layer}/${name}.ts`);
  }
}

for (const [component, schema] of Object.entries(componentSchemas)) {
  const nonLocalizedFields = new Set(nonLocalizedByComponent[component]);
  for (const [field, attribute] of Object.entries(schema.attributes ?? {})) {
    const isLocalized = attribute.pluginOptions?.i18n?.localized === true;
    assert(
      nonLocalizedFields.has(field) ? !isLocalized : isLocalized,
      `shared.${component}.${field}: localization setting does not match the Phase 3 matrix`,
    );
  }
}

for (const forbidden of forbiddenTypes) {
  const path = join(root, 'src', 'api', forbidden);
  assert(!existsSync(path), `Forbidden Phase 2 content type exists: ${forbidden}`);
}

const menuItem = schemas['menu-item']?.attributes;
const menuCategory = schemas['menu-category']?.attributes;
const location = schemas.location?.attributes;
const galleryItem = schemas['gallery-item']?.attributes;
const campaign = schemas.campaign?.attributes;

assert(menuItem?.price?.type === 'decimal' && menuItem.price.min === 0, 'menu-item.price must be a non-negative decimal');
assert(menuItem?.category?.relation === 'manyToOne', 'menu-item.category must be manyToOne');
assert(menuItem?.category?.target === 'api::menu-category.menu-category', 'menu-item.category target is invalid');
assert(menuItem?.category?.inversedBy === 'items', 'menu-item.category must be inversedBy items');
assert(menuItem?.category?.required === true, 'menu-item.category must be required');
assert(menuCategory?.items?.relation === 'oneToMany', 'menu-category.items must be oneToMany');
assert(menuCategory?.items?.mappedBy === 'category', 'menu-category.items must be mappedBy category');
assert(location?.galleryItems?.mappedBy === 'location', 'location.galleryItems must be mappedBy location');
assert(galleryItem?.location?.inversedBy === 'galleryItems', 'gallery-item.location must be inversedBy galleryItems');
assert(
  JSON.stringify(campaign?.kind?.enum) === JSON.stringify(['promotion', 'event', 'private_event']),
  'campaign.kind enum is invalid',
);

if (errors.length > 0) {
  console.error(`Content model verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Content model verified: ${components.length} components, ${Object.keys(contentTypes).length} localized content types, localization matrix, and all core CRUD layers.`);
