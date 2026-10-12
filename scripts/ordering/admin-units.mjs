// O5 step 1: the public catalog is the test fixture (prefix XT) when no official file
// is present, search ignores diacritics, and the response is cached.
import assert from 'node:assert/strict';

process.env.FORM_INTAKE_SHARED_SECRET = 'admin-units-test-secret';

import { withApp } from './_harness.mjs';

withApp(async (app) => {
  const units = app.plugin('ordering').service('admin-units');
  const resolved = units.load();
  assert.equal(resolved.origin, 'test-fixture');
  assert.equal(resolved.catalog.version, 'test-fixture');
  assert.equal(resolved.catalog.provinces.length, 2);
  assert.equal(resolved.catalog.communes.length, 5);
  assert.ok(resolved.catalog.source.includes('TEST FIXTURE'));
  for (const row of resolved.catalog.communes) {
    assert.ok(row.code.startsWith('XT'), row.code);
  }

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const call = async (path) => {
    const res = await fetch(`${base}${path}`, {
      headers: {
        'x-salanca-intake-secret': 'admin-units-test-secret',
        'x-salanca-visitor-ip': '192.0.2.40',
      },
    });
    const text = await res.text();
    return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null };
  };

  const all = await call('/admin-units');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.cache, 'public, max-age=86400');
  assert.equal(all.body.available, true);
  assert.equal(all.body.provinceCount, 2);
  assert.equal(all.body.communeCount, 5);
  assert.equal(all.body.communes.length, 0, 'communes stay out of the unfiltered payload');

  const found = await call('/admin-units?province=xt01&q=ben%20thu');
  assert.equal(found.status, 200);
  assert.deepEqual(
    found.body.communes.map((row) => row.code),
    ['XT01001'],
  );
  assert.equal(found.body.communes[0].name, 'Phường Bến Thử');

  const dang = await call('/admin-units?q=dang');
  assert.ok(dang.body.communes.some((row) => row.code === 'XT01003'));

  console.log('[ordering-test] admin-units catalog: test fixture, unaccented search, long cache');
});
