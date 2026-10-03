import { describe, expect, it } from 'vitest';
// Runtime operations helpers are plain ESM; tests assert transport boundaries.
// @ts-expect-error Plain ESM helper has no declaration file.
import { serialize, replaceFiles, sha, validateBundle, editableProjection } from './content-bundle.helper.mjs';
import { resolvePlaceholders } from './seed-salanca-content/resolve.mjs';

describe('content bundle transport', () => {
  it('maps media to the destination id rather than source ids', () => {
    const payload = replaceFiles({ image: { media: { __file: '18' }, alt: 'Salad' } }, new Map([['18', 'packed.webp']]));
    expect(resolvePlaceholders(payload, new Map([['packed.webp', 99]]), new Map())).toEqual({ image: { media: 99, alt: 'Salad' } });
  });
  it('rejects missing media', () => {
    expect(() => resolvePlaceholders({ __file: 'missing.webp' }, new Map(), new Map())).toThrow('Unresolved bundled media');
  });
  it('exports schema fields only and remaps relations without database ids', () => {
    const app = { contentTypes: { meal: { attributes: { title: { type: 'string' }, category: { type: 'relation', target: 'category' } } } }, components: {} };
    expect(serialize(app, 'meal', { id: 88, title: 'Salad', category: { documentId: 'source-id' }, secret: 'excluded' }, new Map([['category:source-id', 'sides']]), new Map())).toEqual({ title: 'Salad', category: { __ref: { uid: 'category', key: 'sides' } } });
    expect(() => serialize(app, 'meal', { category: { documentId: 'draft-only' } }, new Map(), new Map())).toThrow('outside published bundle');
  });
  it('rejects path traversal and non-marketing models', () => {
    const base = { version: 1, payload: { liveSnapshot: true, locales: ['vi', 'en'], pages: {}, collections: {} }, files: [] };
    expect(() => validateBundle({ ...base, files: [{ name: '../.env', sha256: sha('data') }] })).toThrow();
    expect(() => validateBundle({ ...base, payload: { ...base.payload, collections: { 'api::reservation-request.reservation-request': {} } } })).toThrow('outside marketing');
  });
  it('ignores computed inverse links and related drafts while detecting own edits', () => {
    const app = { contentTypes: { page: { attributes: { title: { type: 'string' }, gallery: { type: 'relation', mappedBy: 'location' }, category: { type: 'relation' } } } }, components: {} };
    const draft = { title: 'Menu', gallery: ['draft'], category: { documentId: 'same', title: 'Related draft' } };
    const live = { title: 'Menu', gallery: [], category: { documentId: 'same', title: 'Related live' } };
    expect(editableProjection(app, 'page', draft)).toEqual(editableProjection(app, 'page', live));
    expect(editableProjection(app, 'page', { ...draft, title: 'Own edit' })).not.toEqual(editableProjection(app, 'page', live));
  });
});
