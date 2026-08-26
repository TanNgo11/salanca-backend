/**
 * Turns the exported payload's placeholders into real Strapi values.
 *
 * `{ __media }` becomes a media id, `{ __ref }` becomes a document id (or a
 * list of them). Both are resolved late, because the ids only exist once the
 * upload and the referenced collections have been seeded.
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param value    payload fragment
 * @param mediaIds Map of file name -> media id
 * @param refIds   Map of `${uid}:${entryKey}` -> documentId
 */
export function resolvePlaceholders(value, mediaIds, refIds) {
  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholders(item, mediaIds, refIds));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (typeof value.__media === 'string') {
    const id = mediaIds.get(value.__media);
    if (id === undefined) {
      throw new Error(`Unresolved media reference "${value.__media}".`);
    }
    const { __media, ...rest } = value;
    return { ...rest, media: id };
  }

  if (isPlainObject(value.__ref)) {
    return resolveRelation(value.__ref, refIds);
  }

  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = resolvePlaceholders(nested, mediaIds, refIds);
  }
  return output;
}

/**
 * Missing targets are skipped rather than fatal: a page may point at a cut the
 * menu does not carry in that locale, and dropping the link beats failing the
 * whole seed.
 */
function resolveRelation(spec, refIds) {
  if (spec.many === true) {
    return (spec.keys ?? [])
      .map((key) => refIds.get(`${spec.uid}:${key}`))
      .filter((id) => id !== undefined);
  }

  return refIds.get(`${spec.uid}:${spec.key}`) ?? null;
}
