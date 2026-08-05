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
/** Localized marketing content: Draft & Publish + i18n required. */
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
/** Lead / form intake: no i18n plugin, no Draft & Publish. */
const leadContentTypes = {
  'contact-message': 'collectionType',
  'reservation-request': 'collectionType',
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
  image: ['media', 'focalPointX', 'focalPointY'],
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
  'page',
  'payment',
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

const leadSchemas = {};
for (const [name, expectedKind] of Object.entries(leadContentTypes)) {
  const schemaPath = join(
    root,
    'src',
    'api',
    name,
    'content-types',
    name,
    'schema.json',
  );
  const schema = loadJson(schemaPath, `lead content type ${name}`);
  if (!schema) continue;
  leadSchemas[name] = schema;
  assert(schema.kind === expectedKind, `${name}: expected kind ${expectedKind}`);
  assert(
    schema.options?.draftAndPublish === false,
    `${name}: Draft & Publish must be disabled for lead intake`,
  );
  assert(schema.info?.singularName === name, `${name}: singularName must match directory name`);
  assert(
    schema.pluginOptions?.i18n?.localized !== true,
    `${name}: i18n must not be enabled for lead intake`,
  );

  for (const layer of ['controllers', 'routes', 'services']) {
    const path = join(root, 'src', 'api', name, layer, `${name}.ts`);
    assert(existsSync(path), `${name}: missing ${layer}/${name}.ts`);
  }
}

const contactMessage = leadSchemas['contact-message']?.attributes;
assert(contactMessage?.fullName?.required === true, 'contact-message.fullName must be required');
assert(contactMessage?.message?.required === true, 'contact-message.message must be required');
assert(
  JSON.stringify(contactMessage?.sourceLocale?.enum) === JSON.stringify(['vi', 'en']),
  'contact-message.sourceLocale enum is invalid',
);
assert(contactMessage?.locale === undefined, 'contact-message must not use locale attribute name');
assert(
  JSON.stringify(contactMessage?.status?.enum) === JSON.stringify(['new', 'read', 'archived']),
  'contact-message.status enum is invalid',
);
assert(contactMessage?.status?.default === 'new', 'contact-message.status default must be new');
assert(contactMessage?.website === undefined, 'contact-message must not persist honeypot website field');

const reservationRequest = leadSchemas['reservation-request']?.attributes;
assert(reservationRequest?.fullName?.required === true, 'reservation-request.fullName must be required');
assert(reservationRequest?.phone?.required === true, 'reservation-request.phone must be required');
assert(reservationRequest?.preferredDate?.type === 'date', 'reservation-request.preferredDate must be date');
assert(reservationRequest?.preferredTime?.required === true, 'reservation-request.preferredTime must be required');
assert(reservationRequest?.guestCount?.type === 'integer', 'reservation-request.guestCount must be integer');
assert(
  JSON.stringify(reservationRequest?.menuSelectionMode?.enum) === JSON.stringify(['later', 'now']),
  'reservation-request.menuSelectionMode enum is invalid',
);
assert(
  JSON.stringify(reservationRequest?.sourceLocale?.enum) === JSON.stringify(['vi', 'en']),
  'reservation-request.sourceLocale enum is invalid',
);
assert(reservationRequest?.locale === undefined, 'reservation-request must not use locale attribute name');
assert(
  JSON.stringify(reservationRequest?.status?.enum) === JSON.stringify(['new', 'read', 'archived']),
  'reservation-request.status enum is invalid',
);
assert(reservationRequest?.status?.default === 'new', 'reservation-request.status default must be new');
assert(reservationRequest?.hasOverlap === undefined, 'reservation-request must not persist derived hasOverlap');
assert(reservationRequest?.clientIpHash === undefined, 'reservation-request must not persist clientIpHash');
assert(reservationRequest?.overlapCount?.type === 'integer', 'reservation-request.overlapCount must be integer');
assert(reservationRequest?.website === undefined, 'reservation-request must not persist honeypot website field');
assert(
  reservationRequest?.menuPackages?.relation === 'manyToMany'
    && reservationRequest?.menuPackages?.target === 'api::menu-package.menu-package',
  'reservation-request.menuPackages must be manyToMany menu-package',
);
assert(
  reservationRequest?.menuItems?.relation === 'manyToMany'
    && reservationRequest?.menuItems?.target === 'api::menu-item.menu-item',
  'reservation-request.menuItems must be manyToMany menu-item',
);

for (const forbidden of forbiddenTypes) {
  const path = join(root, 'src', 'api', forbidden);
  assert(!existsSync(path), `Forbidden content type exists: ${forbidden}`);
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

console.log(
  `Content model verified: ${components.length} components, ${Object.keys(contentTypes).length} localized content types, ${Object.keys(leadContentTypes).length} lead type(s), localization matrix, and all core CRUD layers.`,
);
