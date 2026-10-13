// O10 step 5: OpenAPI gate. Cross-checks the declarative operation table against every route
// in routes/index.ts (an undocumented route fails check:ordering), validates the 3.1 document
// shape by hand (no validator dependency), and fetches the served public document over HTTP.
// `--write` additionally generates docs/ordering-admin-openapi.json (`pnpm run ordering:openapi`).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenApi } from '../../src/plugins/ordering/dist/server/src/openapi/index.js';
import { withApp } from './_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const write = process.argv.includes('--write');

// ── Extract every declared route from the route table source ──────────────────
const source = readFileSync(
  join(repo, 'src/plugins/ordering/server/src/routes/index.ts'),
  'utf8',
);
const section = (name) => source.slice(source.indexOf(`'${name}'`));
const publicSource = section('content-api').slice(0, section('content-api').indexOf("'admin'"));
const adminSource = section('admin');

const routesOf = (text, scope) => {
  const found = [];
  for (const match of text.matchAll(
    /(?:publicRoute|adminRoute)\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'([^']+)'/g,
  )) {
    found.push({ method: match[1].toLowerCase(), path: match[2], scope });
  }
  // Literal route objects (inline config) — method then path within the same object literal.
  for (const match of text.matchAll(
    /method:\s*'(GET|POST|PUT|PATCH|DELETE)',\s*\n?\s*path:\s*'([^']+)'/g,
  )) {
    found.push({ method: match[1].toLowerCase(), path: match[2], scope });
  }
  return found;
};

const declared = [...routesOf(publicSource, 'public'), ...routesOf(adminSource, 'admin')];
assert.ok(declared.length > 70, `route extraction should find most routes (got ${declared.length})`);

const openapiPath = (path) => path.replace(/:([A-Za-z]+)/g, '{$1}');

// ── Coverage: every route has an operation in the matching document ───────────
const publicDoc = buildOpenApi('public');
const adminDoc = buildOpenApi('admin');
const docs = { public: publicDoc, admin: adminDoc };
const missing = declared.filter(
  (route) => !docs[route.scope].paths?.[openapiPath(route.path)]?.[route.method],
);
assert.deepEqual(missing, [], 'every declared route needs an OpenAPI operation');

// ── Structural checks on both documents (manual, no validator dep) ────────────
const operationIds = new Set();
for (const [scope, doc] of Object.entries(docs)) {
  assert.equal(doc.openapi, '3.1.0', `${scope}: OpenAPI 3.1`);
  assert.equal(doc.info.version, '2026-10');
  assert.ok(doc.info.title && doc.info.description, `${scope}: info`);
  assert.ok(Object.keys(doc.paths).length > 0, `${scope}: paths`);
  assert.ok(doc.servers?.[0]?.url, `${scope}: server`);
  for (const [path, item] of Object.entries(doc.paths)) {
    const pathParams = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]);
    for (const [method, operation] of Object.entries(item)) {
      assert.ok(['get', 'post', 'put', 'patch', 'delete'].includes(method), `${method} ${path}`);
      assert.ok(operation.summary, `${method} ${path}: summary`);
      assert.ok(operation.operationId, `${method} ${path}: operationId`);
      assert.ok(!operationIds.has(operation.operationId), `duplicate ${operation.operationId}`);
      operationIds.add(operation.operationId);
      assert.ok(
        operation.responses['200'] || operation.responses['201'],
        `${method} ${path}: success response`,
      );
      const documented = (operation.parameters ?? [])
        .filter((param) => param.in === 'path')
        .map((param) => param.name);
      for (const param of pathParams) {
        assert.ok(documented.includes(param), `${method} ${path}: :${param} must be documented`);
        assert.ok(
          (operation.parameters ?? []).find((p) => p.name === param)?.required === true,
          `${method} ${path}: :${param} required`,
        );
      }
      for (const response of Object.values(operation.responses)) {
        const content = response.content?.['application/json'];
        if (content) assert.ok(content.schema, `${method} ${path}: response needs a schema`);
      }
    }
  }
}

// ── The served document matches the builder and carries the cache header ───────
if (!write) {
  await withApp(async (app) => {
    await app.listen();
    const res = await fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/ordering/openapi.json`);
    assert.equal(res.status, 200, 'public route answers 200 without auth');
    assert.match(res.headers.get('cache-control') ?? '', /max-age=3600/, 'cached one hour');
    const served = await res.json();
    assert.deepEqual(served, publicDoc, 'served document equals buildOpenApi(public)');
  });
  console.log('[ordering-test] openapi: route coverage, 3.1 structure, served document');
} else {
  const target = join(repo, 'docs/ordering-admin-openapi.json');
  writeFileSync(target, `${JSON.stringify(adminDoc, null, 2)}\n`, 'utf8');
  console.log(`[ordering-openapi] wrote docs/ordering-admin-openapi.json (${Object.keys(adminDoc.paths).length} paths)`);
}
