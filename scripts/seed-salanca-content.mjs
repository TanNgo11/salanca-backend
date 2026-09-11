/**
 * Idempotent mockup seed: upload FE media, upsert homepage chrome + home-page,
 * open Public find. Reads data/salanca-content.json from `pnpm run export:cms-seed`.
 *
 * Usage (from salanca-backend):
 *   node scripts/seed-salanca-content.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const strapiRoot = dirname(require.resolve('@strapi/strapi/package.json'));
const { compileStrapi, createStrapi } = require(
  require.resolve('@strapi/core', { paths: [strapiRoot] }),
);

process.env.PORT = process.env.SEED_PORT ?? '1342';

const root = process.cwd();
const payloadPath = resolve(root, process.argv[2] ?? 'data/salanca-content.json');
const mediaDir = resolve(
  root,
  process.env.SEED_MEDIA_DIR ?? '../salanca-web/public/media/salanca',
);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const PUBLIC_FIND = [
  'api::home-page.home-page.find',
  'api::header-setting.header-setting.find',
  'api::footer-setting.footer-setting.find',
  'api::global-setting.global-setting.find',
  'api::menu-item.menu-item.find',
  'api::menu-package.menu-package.find',
  'api::menu-category.menu-category.find',
  'api::location.location.find',
  'plugin::upload.content-api.find',
  'plugin::upload.content-api.findOne',
];

const COLLECTION_ORDER = [
  'api::location.location',
  'api::menu-category.menu-category',
  'api::menu-item.menu-item',
  'api::menu-package.menu-package',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function walkReplace(value, replace) {
  if (Array.isArray(value)) {
    return value.map((item) => walkReplace(item, replace));
  }
  if (!isRecord(value)) {
    return value;
  }
  const swapped = replace(value);
  if (swapped !== value) {
    return swapped;
  }
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    next[key] = walkReplace(nested, replace);
  }
  return next;
}

function mimeFor(filename) {
  const ext = extname(filename).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw new Error(`Unsupported media type for ${filename}`);
  }
  return mime;
}

async function enablePublicFind(strapi) {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });
  if (!role) {
    throw new Error('Public role is missing.');
  }

  for (const action of PUBLIC_FIND) {
    const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: { action, role: role.id },
    });
    if (existing) continue;
    await strapi.db.query('plugin::users-permissions.permission').create({
      data: { action, role: role.id },
    });
    console.log(`  public find enabled: ${action}`);
  }
}

async function uploadNamed(app, uploadService, filename) {
  const filepath = resolve(mediaDir, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Media file missing: ${filepath}`);
  }
  const existing = await app.db.query('plugin::upload.file').findOne({
    where: { name: filename },
  });
  if (existing) {
    return existing;
  }

  const [file] = await uploadService.upload({
    data: {
      fileInfo: {
        name: filename,
        alternativeText: filename,
        caption: null,
      },
    },
    files: {
      filepath,
      originalFilename: filename,
      mimetype: mimeFor(filename),
      size: statSync(filepath).size,
    },
  });
  return file;
}

async function upsertCollection(app, uid, matchField, key, locale, data) {
  const matchValue = data[matchField];
  const found = await app.documents(uid).findFirst({
    locale,
    filters: { [matchField]: { $eq: matchValue } },
  });
  if (!found) {
    return app.documents(uid).create({ locale, data });
  }
  return app.documents(uid).update({
    documentId: found.documentId,
    locale,
    data,
  });
}

async function upsertSingleton(app, uid, locale, data) {
  const found = await app.documents(uid).findFirst({ locale });
  if (!found) {
    return app.documents(uid).create({ locale, data });
  }
  return app.documents(uid).update({
    documentId: found.documentId,
    locale,
    data,
  });
}

async function publishBoth(app, uid, documentId) {
  await app.documents(uid).publish({ documentId, locale: 'vi' });
  await app.documents(uid).publish({ documentId, locale: 'en' });
}

const appContext = await compileStrapi();
const app = await createStrapi(appContext).load();

try {
  if (!existsSync(payloadPath)) {
    throw new Error(
      `Missing ${payloadPath}. Run pnpm run export:cms-seed from salanca-web first.`,
    );
  }
  if (!existsSync(mediaDir)) {
    throw new Error(`Missing media directory ${mediaDir}`);
  }

  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const uploadService = app.plugin('upload').service('upload');
  const mediaByName = new Map();

  console.log('Uploading media…');
  for (const filename of payload.media ?? []) {
    const file = await uploadNamed(app, uploadService, filename);
    mediaByName.set(filename, file);
    console.log(`  ${filename} → ${file.id}`);
  }

  const idMap = new Map();

  const resolveData = (value) =>
    walkReplace(value, (node) => {
      if (typeof node.__media === 'string') {
        const file = mediaByName.get(node.__media);
        if (!file) {
          throw new Error(`Seed media not uploaded: ${node.__media}`);
        }
        return {
          media: file.id,
          alt: node.alt,
          caption: node.caption ?? null,
        };
      }
      if (isRecord(node.__ref)) {
        const ref = node.__ref;
        if (ref.many === true) {
          return (ref.keys ?? []).map((key) => {
            const id = idMap.get(`${ref.uid}:${key}`);
            if (!id) throw new Error(`Missing relation ${ref.uid}:${key}`);
            return id;
          });
        }
        const id = idMap.get(`${ref.uid}:${ref.key}`);
        if (!id) throw new Error(`Missing relation ${ref.uid}:${ref.key}`);
        return id;
      }
      return node;
    });

  console.log('Seeding collections…');
  for (const uid of COLLECTION_ORDER) {
    const rawBundle = payload.collections?.[uid];
    const bundle = rawBundle?.entries
      ? rawBundle
      : rawBundle?.vi && rawBundle?.en
        ? {
            matchField: 'slug',
            entries: [
              {
                key: rawBundle.vi.slug ?? 'default',
                vi: rawBundle.vi,
                en: rawBundle.en,
              },
            ],
          }
        : null;
    if (!bundle?.entries) continue;
    for (const entry of bundle.entries) {
      const viData = resolveData(entry.vi);
      const created = await upsertCollection(
        app,
        uid,
        bundle.matchField,
        entry.key,
        'vi',
        viData,
      );
      idMap.set(`${uid}:${entry.key}`, created.documentId);
      await app.documents(uid).update({
        documentId: created.documentId,
        locale: 'en',
        data: resolveData(entry.en),
      });
      await publishBoth(app, uid, created.documentId);
      console.log(`  ${uid} ${entry.key}`);
    }
  }

  const singletons = [
    ['api::header-setting.header-setting', payload.headerSetting],
    ['api::footer-setting.footer-setting', payload.footerSetting],
    ['api::global-setting.global-setting', payload.globalSetting],
    ['api::home-page.home-page', payload.pages?.['api::home-page.home-page']],
  ];

  console.log('Seeding single types…');
  for (const [uid, locales] of singletons) {
    if (!locales?.vi || !locales?.en) {
      throw new Error(`Seed payload missing ${uid} vi/en`);
    }
    const viDoc = await upsertSingleton(app, uid, 'vi', resolveData(locales.vi));
    await app.documents(uid).update({
      documentId: viDoc.documentId,
      locale: 'en',
      data: resolveData(locales.en),
    });
    await publishBoth(app, uid, viDoc.documentId);
    console.log(`  ${uid}`);
  }

  console.log('Opening Public find permissions…');
  await enablePublicFind(app);

  console.log('Seed complete.');
} finally {
  await app.destroy();
  process.exit(0);
}
