import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyRequested, backendRoot, requirePublishedSingle, withStrapi } from './lib/scoped-seed.mjs';
import { ensureContentMedia } from './lib/content-import/media.mjs';

/**
 * Fills the CMS fields that replaced frontend hardcoding, for vi and en:
 * global/footer logo, opening hours and WhatsApp; menu-page catering;
 * space-page video thumbs, closing secondary link and amenity icons;
 * campaign-page newsletter copy.
 *
 * Only empty fields are written, so anything an editor already entered stays.
 * Values come from data/salanca-content.json. Preview unless --apply.
 */

const apply = applyRequested();
const content = JSON.parse(readFileSync(resolve(backendRoot, 'data/salanca-content.json'), 'utf8'));
const LOCALES = ['vi', 'en'];

/** Amenity icons by band position; the rows' own title/body stay as entered. */
const AMENITY_ICONS = ['amenity-private.png', 'amenity-table.png', 'amenity-event.png', 'amenity-service.png'];

const IMAGE = { populate: { media: true } };
const LINK = true;

const TARGETS = [
  {
    uid: 'api::global-setting.global-setting',
    source: (locale) => content.globalSetting[locale],
    fields: ['logo', 'openingHours', 'whatsapp'],
    populate: { logo: IMAGE, openingHours: true },
  },
  {
    uid: 'api::footer-setting.footer-setting',
    source: (locale) => content.footerSetting[locale],
    fields: ['logo', 'openingHours', 'whatsapp'],
    populate: { logo: IMAGE, openingHours: true },
  },
  {
    uid: 'api::menu-page.menu-page',
    source: (locale) => content.pages['api::menu-page.menu-page'][locale],
    fields: ['catering'],
    populate: { catering: { populate: { image: IMAGE, link: LINK } } },
  },
  {
    uid: 'api::space-page.space-page',
    source: (locale) => content.pages['api::space-page.space-page'][locale],
    fields: ['videoThumbs', 'closingSecondaryLink'],
    amenityIcons: true,
    populate: {
      videoThumbs: IMAGE,
      closingSecondaryLink: LINK,
      amenities: { populate: { image: IMAGE, link: LINK } },
    },
  },
  {
    uid: 'api::campaign-page.campaign-page',
    source: (locale) => content.pages['api::campaign-page.campaign-page'][locale],
    fields: ['newsletterHeading', 'newsletterNote'],
    populate: {},
  },
];

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Drops Strapi row ids so components are rewritten from plain data. */
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['id', '__component', 'documentId'].includes(key))
      .map(([key, nested]) => [key, plain(nested)]),
  );
}

function collectMedia(value, into) {
  if (Array.isArray(value)) return value.forEach((item) => collectMedia(item, into));
  if (!value || typeof value !== 'object') return;
  if (typeof value.__media === 'string') into.add(value.__media);
  for (const nested of Object.values(value)) collectMedia(nested, into);
}

/** `{ __media: name }` (seed payload) → `{ media: id }` (Document Service). */
function resolveMedia(value, ids) {
  if (Array.isArray(value)) return value.map((item) => resolveMedia(item, ids));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) =>
      key === '__media' ? ['media', ids.get(nested)] : [key, resolveMedia(nested, ids)],
    ),
  );
}

/** Existing image component back to writable data (media relation → id). */
function writableImage(image) {
  if (!image) return null;
  const { media, ...rest } = plain(image);
  return { ...rest, media: media?.id ?? null };
}

function iconImage(file, row) {
  return {
    __media: file,
    alt: `${row.title} ${row.body}`.trim(),
    caption: null,
    focalPointX: 50,
    focalPointY: 50,
  };
}

await withStrapi(async (app) => {
  const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) && !process.env.DATABASE_URL;
  if (!localDatabase && app.config.get('plugin::upload.provider') !== 'aws-s3') {
    throw new Error('This seed uploads media. Production requires the S3 provider. No content written.');
  }
  if (!localDatabase) process.env.SALANCA_SEED_REQUIRE_S3 = 'true';

  // Plan every write before touching anything, so a refusal leaves no partial state.
  const plans = [];
  for (const target of TARGETS) {
    for (const locale of LOCALES) {
      const published = await requirePublishedSingle(app, target.uid, locale);
      const current = await app.documents(target.uid).findOne({
        documentId: published.documentId,
        locale,
        status: 'published',
        populate: target.populate,
      });
      const source = target.source(locale);
      const data = {};
      for (const field of target.fields) {
        if (!isEmpty(current?.[field])) {
          console.log(`${target.uid}/${locale} ${field}: already set, kept`);
          continue;
        }
        if (isEmpty(source?.[field])) {
          console.log(`${target.uid}/${locale} ${field}: no seed value, skipped`);
          continue;
        }
        data[field] = source[field];
        console.log(`${target.uid}/${locale} ${field}: empty -> seed value`);
      }

      if (target.amenityIcons) {
        const rows = current?.amenities ?? [];
        const missing = rows.some((row, index) => !row.image && AMENITY_ICONS[index]);
        if (missing) {
          data.amenities = rows.map((row, index) => {
            const { image, link, ...rest } = plain(row);
            return {
              ...rest,
              link: link ?? null,
              image: row.image ? writableImage(row.image) : AMENITY_ICONS[index] ? iconImage(AMENITY_ICONS[index], row) : null,
            };
          });
          rows.forEach((row, index) => {
            const state = row.image ? 'kept' : AMENITY_ICONS[index] ? `-> ${AMENITY_ICONS[index]}` : 'no icon available';
            console.log(`${target.uid}/${locale} amenities[${index}] "${row.title}": icon ${state}`);
          });
        } else {
          console.log(`${target.uid}/${locale} amenities: icons already set, kept`);
        }
      }

      if (Object.keys(data).length > 0) {
        plans.push({ uid: target.uid, locale, documentId: published.documentId, data });
      }
    }
  }

  if (plans.length === 0) {
    console.log('Nothing to fill. No content written.');
    return;
  }
  if (!apply) {
    console.log(`Preview only: ${plans.length} localized documents would change. Re-run with --apply.`);
    return;
  }

  const files = new Set();
  for (const plan of plans) collectMedia(plan.data, files);
  const ids = await ensureContentMedia(app, { record() {} }, [...files]);

  for (const plan of plans) {
    await app.documents(plan.uid).update({
      documentId: plan.documentId,
      locale: plan.locale,
      data: resolveMedia(plan.data, ids),
    });
    await app.documents(plan.uid).publish({ documentId: plan.documentId, locale: plan.locale });
    console.log(`Published ${plan.uid}/${plan.locale}: ${Object.keys(plan.data).join(', ')}`);
  }
});
