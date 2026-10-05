import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyRequested, backendRoot, withStrapi } from './lib/scoped-seed.mjs';
import { populateFor } from './lib/content-release.helper.mjs';

/**
 * Applies scripts/locale-cleanup-2026-10-05.json: VI pages show Vietnamese only,
 * EN pages show English only.
 *
 * Compare-and-set per field: a field is written only while it still holds the
 * expected old value. A field that already holds the new value is skipped, and
 * a field an editor changed to anything else is kept and reported.
 * Every touched document is checked for unpublished edits before any write.
 * Preview unless --apply.
 */

const apply = applyRequested();
const { edits } = JSON.parse(
  readFileSync(resolve(backendRoot, 'scripts/locale-cleanup-2026-10-05.json'), 'utf8'),
);

const READ_ONLY = new Set(['id', 'documentId', 'locale', 'publishedAt', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations']);

/** Populated row back to Document Service input: ids dropped, media → id, relations → documentId. */
function writable(app, schemaUid, row) {
  if (row === null || row === undefined) return row ?? null;
  const attributes = (app.contentTypes[schemaUid] ?? app.components[schemaUid]).attributes;
  const result = {};
  for (const [key, attribute] of Object.entries(attributes)) {
    if (READ_ONLY.has(key) || attribute.mappedBy || row[key] === undefined) continue;
    const value = row[key];
    if (value === null) result[key] = null;
    else if (attribute.type === 'component') {
      result[key] = attribute.repeatable
        ? value.map((item) => writable(app, attribute.component, item))
        : writable(app, attribute.component, value);
    } else if (attribute.type === 'media') result[key] = Array.isArray(value) ? value.map((file) => file.id) : value.id;
    else if (attribute.type === 'relation') result[key] = Array.isArray(value) ? value.map((item) => item.documentId) : value.documentId;
    else result[key] = value;
  }
  return result;
}

function readPath(value, path) {
  return path.reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), value);
}

function writePath(value, path, next) {
  const parent = readPath(value, path.slice(0, -1));
  if (!parent || typeof parent !== 'object') throw new Error(`Missing parent for ${path.join('.')}`);
  parent[path.at(-1)] = next;
}

const same = (a, b) => (a ?? null) === (b ?? null);
const show = (value) => JSON.stringify(value)?.slice(0, 70);

/** The published row for one edit target, refusing when a newer draft exists. */
async function publishedTarget(app, uid, locale, match) {
  const filters = match ?? {};
  const published = await app.documents(uid).findMany({ locale, status: 'published', filters, populate: populateFor(app, uid), limit: 2 });
  if (published.length === 0) return null;
  if (published.length > 1) throw new Error(`Expected one published ${uid}/${locale} ${show(filters)}; found ${published.length}. No content written.`);
  const [draft] = await app.documents(uid).findMany({ locale, status: 'draft', filters: { documentId: published[0].documentId }, limit: 1 });
  if (draft && new Date(draft.updatedAt).getTime() > new Date(published[0].updatedAt).getTime()) {
    throw new Error(`Unpublished edits on ${uid}/${locale} ${show(filters)}. Publish or discard them in admin first. No content written.`);
  }
  return published[0];
}

await withStrapi(async (app) => {
  // Plan every write before touching anything, so a refusal leaves no partial state.
  const plans = new Map();
  let changed = 0, done = 0, kept = 0;
  for (const edit of edits) {
    const key = `${edit.uid}|${edit.locale}|${JSON.stringify(edit.match ?? null)}`;
    if (!plans.has(key)) {
      const row = await publishedTarget(app, edit.uid, edit.locale, edit.match);
      plans.set(key, row && { ...edit, documentId: row.documentId, row, data: {} });
    }
    const plan = plans.get(key);
    const label = `${edit.uid}/${edit.locale}${edit.match ? ` ${show(edit.match)}` : ''} ${edit.path.join('.')}`;
    if (!plan) {
      console.log(`KEPT  ${label}: no published document`); kept++;
      continue;
    }
    const current = readPath(plan.row, edit.path);
    if (same(current, edit.to)) {
      console.log(`DONE  ${label}`); done++;
      continue;
    }
    if (!same(current, edit.from)) {
      console.log(`KEPT  ${label}: editor value ${show(current)} (expected ${show(edit.from)})`); kept++;
      continue;
    }
    const field = edit.path[0];
    if (!(field in plan.data)) plan.data[field] = writable(app, edit.uid, { [field]: plan.row[field] })[field];
    if (edit.path.length === 1) plan.data[field] = edit.to;
    else writePath(plan.data[field], edit.path.slice(1), edit.to);
    console.log(`WRITE ${label}: ${show(current)} -> ${show(edit.to)}`); changed++;
  }

  const writes = [...plans.values()].filter((plan) => plan && Object.keys(plan.data).length > 0);
  console.log(`${changed} fields to write in ${writes.length} documents; ${done} already done; ${kept} kept as edited.`);
  if (writes.length === 0) return console.log('Nothing to write.');
  if (!apply) return console.log('Preview only. No content written. Re-run with --apply.');

  for (const plan of writes) {
    await app.documents(plan.uid).update({ documentId: plan.documentId, locale: plan.locale, data: plan.data });
    await app.documents(plan.uid).publish({ documentId: plan.documentId, locale: plan.locale });
    console.log(`Published ${plan.uid}/${plan.locale}: ${Object.keys(plan.data).join(', ')}`);
  }
});
