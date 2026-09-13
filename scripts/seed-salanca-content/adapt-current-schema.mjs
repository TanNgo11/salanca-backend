/**
 * Strips undefined/null fields from the exported `salanca-content.json`
 * home-page payload before it is sent to the Strapi document service.
 */

import { isPlainObject as isRecord } from './resolve.mjs';

function omitUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(omitUndefined);
  }
  if (!isRecord(value)) return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested === undefined || nested === null) continue;
    next[key] = omitUndefined(nested);
  }
  return next;
}

export function adaptHomePageForCurrentSchema(data) {
  return isRecord(data) ? omitUndefined(data) : data;
}
