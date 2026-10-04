import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyRequested, backendRoot, requirePublishedSingle, withStrapi } from './lib/scoped-seed.mjs';

/**
 * Writes header-setting.menuLinks only, for vi and en.
 * Preview unless --apply. Does not touch headerLinks, logo, or any other field.
 */

const UID = 'api::header-setting.header-setting';
const apply = applyRequested();
const content = JSON.parse(readFileSync(resolve(backendRoot, 'data/salanca-content.json'), 'utf8'));

function menuLinks(locale) {
  const links = content.headerSetting?.[locale]?.menuLinks;
  if (!Array.isArray(links) || links.length === 0) {
    throw new Error(`No menuLinks for ${locale} in data/salanca-content.json.`);
  }
  return links.map((link) => {
    if (typeof link.label !== 'string' || typeof link.url !== 'string' || typeof link.openInNewTab !== 'boolean') {
      throw new Error(`Invalid menu link for ${locale}.`);
    }
    return { label: link.label, url: link.url, openInNewTab: link.openInNewTab };
  });
}

const planned = ['vi', 'en'].map((locale) => ({ locale, links: menuLinks(locale) }));

await withStrapi(async (app) => {
  for (const { locale, links } of planned) {
    const current = await requirePublishedSingle(app, UID, locale);
    console.log(`${UID}/${locale} document ${current.documentId}: replace menuLinks only (${links.length} links)`);
    for (const link of links) console.log(`  ${link.label} -> ${link.url}`);
    if (!apply) continue;
    await app.documents(UID).update({
      documentId: current.documentId,
      locale,
      data: { menuLinks: links },
    });
    await app.documents(UID).publish({ documentId: current.documentId, locale });
    console.log(`Published menuLinks for ${locale}.`);
  }
  if (!apply) console.log('Preview only. No content written. Re-run with --apply.');
});
