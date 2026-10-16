import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { SEO_TOOLKIT_ACTION, seedAdminHttpStaff, TEST_DATABASE, withApp } from './_harness.mjs';

// Closes the manual UAT gate for the admin route: real HTTP against a dedicated loopback database
// (`salanca_seo_test`), never the dev database. Covers 401/403/200, both 400 paths, the registered
// action, and (on real rows) `media.share-image-alt-missing` and the `status` filter.
const UID = 'api::menu-category.menu-category';
const SMOKE_PREFIX = 'seo-smoke-';
const log = (message) => console.log(`[seo-toolkit-test] ${message}`);

/** Deletes fixtures a previously aborted run may have left in the dedicated test database. */
async function purgeStaleFixtures(app) {
  const documents = app.db.query(UID);
  for (const row of await documents.findMany({ where: { slug: { $startsWith: SMOKE_PREFIX } } })) {
    await app.documents(UID).delete({ documentId: row.documentId }).catch(() => undefined);
  }
  const files = app.db.query('plugin::upload.file');
  for (const row of await files.findMany({ where: { name: { $startsWith: SMOKE_PREFIX } } })) {
    await files.delete({ where: { id: row.id } }).catch(() => undefined);
  }
}

await withApp(async (app) => {
  assert.ok(app.plugin('seo-toolkit'), 'seo-toolkit plugin must be loaded');
  await purgeStaleFixtures(app);
  await app.listen();

  const base = `http://127.0.0.1:${process.env.PORT}`;
  const unauthenticated = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const allowed = await seedAdminHttpStaff(app, { actions: [SEO_TOOLKIT_ACTION] });
  const denied = await seedAdminHttpStaff(app, { actions: [] });
  const files = app.db.query('plugin::upload.file');
  let file;
  let document;

  try {
    // 1. No token → 401.
    const noToken = await unauthenticated('POST', '/seo-toolkit/audit/run', {});
    assert.equal(noToken.status, 401, `no token must be 401 (got ${noToken.status})`);
    log('ca1 no token -> 401');

    // 2. Authenticated but without the action → 403.
    const forbidden = await denied.as('POST', '/audit/run', {});
    assert.equal(
      forbidden.status,
      403,
      `role without permission must be 403 (got ${forbidden.status})`,
    );
    log('ca2 missing permission -> 403');

    // 3. Authenticated with the action → 200 and the report contract.
    const ok = await allowed.as('POST', '/audit/run', {});
    assert.equal(ok.status, 200, `permission must be 200 (got ${ok.status}: ${JSON.stringify(ok.body)})`);
    assert.equal(typeof ok.body.generatedAt, 'string', 'body.generatedAt is a string');
    assert.ok(Array.isArray(ok.body.scope?.contentTypes), 'body.scope.contentTypes is an array');
    assert.equal(typeof ok.body.summary?.entries, 'number', 'body.summary.entries is a number');
    assert.ok(Array.isArray(ok.body.issues), 'body.issues is an array');
    log(`ca3 permission -> 200 contract (entries=${ok.body.summary.entries})`);

    // 4. Malformed body → 400 (not 500).
    const badStatus = await allowed.as('POST', '/audit/run', { status: 'bogus' });
    assert.equal(badStatus.status, 400, `bad status must be 400 (got ${badStatus.status})`);
    const badTypes = await allowed.as('POST', '/audit/run', { contentTypes: 'x' });
    assert.equal(badTypes.status, 400, `bad contentTypes must be 400 (got ${badTypes.status})`);
    log('ca4 malformed body -> 400');

    // 5. Unknown content type → 400.
    const unknown = await allowed.as('POST', '/audit/run', { contentTypes: ['api::nope.nope'] });
    assert.equal(unknown.status, 400, `unknown content type must be 400 (got ${unknown.status})`);
    log('ca5 unknown content type -> 400');

    // 6. The action is registered, so it shows up in the Role editor.
    const provider = app.admin.services.permission.actionProvider;
    assert.ok(provider.has(SEO_TOOLKIT_ACTION), `${SEO_TOOLKIT_ACTION} must be registered`);
    log('ca6 action registered in actionProvider');

    // 7. Real share image without alt (A2 directly on data), then with alt.
    const suffix = randomUUID().slice(0, 8);
    file = await files.create({
      data: {
        name: `${SMOKE_PREFIX}${suffix}.png`,
        hash: `${SMOKE_PREFIX}${suffix}`,
        ext: '.png',
        mime: 'image/png',
        size: 1,
        width: 1,
        height: 1,
        url: `/uploads/${SMOKE_PREFIX}${suffix}.png`,
        provider: 'local',
        folderPath: '/',
        alternativeText: null,
      },
    });
    const locale = await app.plugin('i18n').service('locales').getDefaultLocale();
    document = await app.documents(UID).create({
      locale,
      data: {
        name: `SEO smoke ${suffix}`,
        slug: `${SMOKE_PREFIX}${suffix}`,
        isActive: false,
        seo: {
          metaTitle: `Smoke ${suffix}`,
          metaDescription: 'Share-image audit fixture for the seo-toolkit admin route smoke.',
          shareImage: file.id,
          noIndex: false,
        },
      },
    });

    const withoutAlt = await allowed.as('POST', '/audit/run', {
      status: 'draft',
      contentTypes: [UID],
    });
    assert.equal(withoutAlt.status, 200, `draft audit must be 200 (got ${withoutAlt.status})`);
    const codesWithoutAlt = withoutAlt.body.issues.map((issue) => issue.code);
    assert.ok(
      codesWithoutAlt.includes('media.share-image-alt-missing'),
      `expected media.share-image-alt-missing, got ${JSON.stringify(codesWithoutAlt)}`,
    );
    assert.ok(
      !codesWithoutAlt.includes('media.share-image-missing'),
      'share-image-missing must not fire when an image is set',
    );
    log('ca7 draft + share image without alt -> alt-missing only');

    await files.update({ where: { id: file.id }, data: { alternativeText: 'Salanca share' } });
    const withAlt = await allowed.as('POST', '/audit/run', {
      status: 'draft',
      contentTypes: [UID],
    });
    assert.ok(
      !withAlt.body.issues.some((issue) => issue.code === 'media.share-image-alt-missing'),
      'alt-missing must disappear once alternativeText is set',
    );
    log('ca7b alt set -> alt-missing gone');

    // 8. The same document is invisible while still a draft.
    const asPublished = await allowed.as('POST', '/audit/run', {
      status: 'published',
      contentTypes: [UID],
    });
    assert.equal(asPublished.status, 200, `published audit must be 200 (got ${asPublished.status})`);
    assert.equal(asPublished.body.summary.entries, 0, 'a draft document must not appear as published');
    log('ca8 published scope -> 0 entries for the draft-only document');

    console.log(
      `[seo-toolkit-test] admin-route smoke passed on ${TEST_DATABASE}: 401/403/200, two 400 paths, action registered, share-image alt, status filter`,
    );
  } finally {
    if (document) {
      await app.documents(UID).delete({ documentId: document.documentId }).catch(() => undefined);
    }
    if (file) {
      await files.delete({ where: { id: file.id } }).catch(() => undefined);
    }
    await allowed.cleanup();
    await denied.cleanup();
  }
});
