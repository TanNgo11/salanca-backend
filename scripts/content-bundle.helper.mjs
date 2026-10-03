import { createHash } from 'node:crypto';

export const locales = ['vi', 'en'];
export const collectionFields = {
  'api::location.location': 'slug',
  'api::menu-category.menu-category': 'slug',
  'api::menu-package.menu-package': 'slug',
  'api::menu-item.menu-item': 'slug',
  'api::campaign.campaign': 'slug',
  'api::gallery-item.gallery-item': 'title',
};
export const singleNames = ['global-setting', 'header-setting', 'footer-setting', 'home-page', 'menu-page', 'story-page', 'experience-page', 'space-page', 'campaign-page', 'contact-page', 'booking-page'];
export const singleUids = singleNames.map(name => `api::${name}.${name}`);
export const allUids = [...Object.keys(collectionFields), ...singleUids];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const excluded = new Set(['id', 'documentId', 'locale', 'publishedAt', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations']);

export function populateFor(app, uid) {
  const attributes = (app.contentTypes[uid] ?? app.components[uid]).attributes;
  return Object.fromEntries(Object.entries(attributes).filter(([key, a]) => !excluded.has(key) && !a.mappedBy && ['component', 'media', 'relation'].includes(a.type)).map(([key, a]) => [key, a.type === 'component' ? { populate: populateFor(app, a.component) } : true]));
}

export function serialize(app, uid, row, refs, media) {
  if (row === null) return null;
  const attributes = (app.contentTypes[uid] ?? app.components[uid]).attributes;
  const result = {};
  for (const [key, a] of Object.entries(attributes)) {
    if (excluded.has(key) || a.private || a.mappedBy || row[key] === undefined) continue;
    const value = row[key];
    if (value === null) { result[key] = null; continue; }
    if (a.type === 'component') {
      result[key] = a.repeatable ? value.map(v => serialize(app, a.component, v, refs, media)) : serialize(app, a.component, value, refs, media);
    } else if (a.type === 'media') {
      const file = v => { media.set(v.id, v); return { __file: String(v.id) }; };
      result[key] = a.multiple ? value.map(file) : file(value);
    } else if (a.type === 'relation') {
      const relation = v => {
        const identity = refs.get(`${a.target}:${v.documentId}`);
        if (!identity) throw new Error(`Relation outside published bundle: ${uid}.${key}`);
        return identity;
      };
      result[key] = Array.isArray(value) ? { __ref: { uid: a.target, many: true, keys: value.map(relation) } } : { __ref: { uid: a.target, key: relation(value) } };
    } else if (a.type === 'dynamiczone') {
      throw new Error(`Unsupported dynamic zone: ${uid}.${key}`);
    } else result[key] = value;
  }
  return result;
}

export function editableProjection(app, uid, row) {
  if (!row) return null;
  const attributes = (app.contentTypes[uid] ?? app.components[uid]).attributes;
  const result = {};
  for (const [key, a] of Object.entries(attributes)) {
    if (excluded.has(key) || a.private || a.mappedBy) continue;
    const value = row[key];
    if (value === null || value === undefined) { result[key] = null; continue; }
    if (a.type === 'component') result[key] = a.repeatable ? value.map(v => editableProjection(app, a.component, v)) : editableProjection(app, a.component, value);
    else if (a.type === 'relation') result[key] = Array.isArray(value) ? value.map(v => v.documentId) : value.documentId;
    else if (a.type === 'media') result[key] = Array.isArray(value) ? value.map(v => v.id) : value.id;
    else result[key] = value;
  }
  return result;
}

export function replaceFiles(value, names) {
  if (Array.isArray(value)) return value.map(v => replaceFiles(v, names));
  if (!value || typeof value !== 'object') return value;
  if (value.__file) {
    const name = names.get(value.__file);
    if (!name) throw new Error('Missing bundled file.');
    return { __file: name };
  }
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replaceFiles(v, names)]));
}

export function validateBundle(bundle) {
  if (bundle.version !== 1 || bundle.payload.liveSnapshot !== true || JSON.stringify(bundle.payload.locales) !== JSON.stringify(locales)) throw new Error('Invalid content bundle.');
  const uids = [...Object.keys(bundle.payload.pages), ...Object.keys(bundle.payload.collections)];
  if (uids.some(uid => !allUids.includes(uid))) throw new Error('Bundle contains a model outside marketing scope.');
  for (const file of bundle.files) {
    if (!/^[a-f0-9]{64}\.(png|jpg|jpeg|webp|svg|avif)$/.test(file.name) || file.sha256 !== file.name.split('.')[0]) throw new Error('Unsafe bundle media path or hash.');
  }
}

/** Only republish an old gallery draft when its editable content matches the approved restoration. */
export function matchesRestoredGallery(app, row, incoming, bundle, refs) {
  try {
    const media = new Map();
    const data = serialize(app, 'api::gallery-item.gallery-item', row, refs, media);
    const names = new Map([...media].map(([id, file]) => [String(id), bundle.files.find(f => f.name === file.name || f.sourceFile === file.name)?.name]));
    const restored = replaceFiles(data, names);
    const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : value;
    return Object.keys(incoming).every(key => JSON.stringify(normalize(restored[key])) === JSON.stringify(normalize(incoming[key])))
      && Object.entries(restored).every(([key, value]) => Object.hasOwn(incoming, key) || value === null);
  } catch { return false; }
}
