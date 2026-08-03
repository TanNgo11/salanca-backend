/**
 * Idempotent Document Service helpers for seed scripts.
 */

export async function findBySlug(app, uid, locale, slug) {
  const rows = await app.documents(uid).findMany({
    locale,
    filters: { slug: { $eq: slug } },
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function upsertBySlug(app, uid, locale, slug, data, { publish = true } = {}) {
  const existing = await findBySlug(app, uid, locale, slug);

  if (existing) {
    const updated = await app.documents(uid).update({
      documentId: existing.documentId,
      locale,
      data,
    });
    if (publish) {
      await app.documents(uid).publish({ documentId: existing.documentId, locale });
    }
    return { action: 'updated', documentId: existing.documentId, document: updated };
  }

  const created = await app.documents(uid).create({
    locale,
    data: { ...data, slug },
  });
  if (publish) {
    await app.documents(uid).publish({ documentId: created.documentId, locale });
  }
  return { action: 'created', documentId: created.documentId, document: created };
}

/**
 * Ensures an EN localization exists on the same documentId (create via update+locale).
 */
export async function upsertLocalization(
  app,
  uid,
  documentId,
  locale,
  data,
  { publish = true } = {},
) {
  const existing = await app.documents(uid).findOne({
    documentId,
    locale,
    status: 'draft',
  });

  if (existing) {
    const updated = await app.documents(uid).update({
      documentId,
      locale,
      data,
    });
    if (publish) {
      await app.documents(uid).publish({ documentId, locale });
    }
    return { action: 'updated', documentId, document: updated };
  }

  const created = await app.documents(uid).update({
    documentId,
    locale,
    data,
  });
  if (publish) {
    await app.documents(uid).publish({ documentId, locale });
  }
  return { action: 'created', documentId, document: created };
}

export async function upsertSingleType(app, uid, locale, data, { publish = true } = {}) {
  const existing = await app.documents(uid).findFirst({ locale, status: 'draft' });

  if (existing) {
    const updated = await app.documents(uid).update({
      documentId: existing.documentId,
      locale,
      data,
    });
    if (publish) {
      await app.documents(uid).publish({ documentId: existing.documentId, locale });
    }
    return { action: 'updated', documentId: existing.documentId, document: updated };
  }

  const created = await app.documents(uid).create({ locale, data });
  if (publish) {
    await app.documents(uid).publish({ documentId: created.documentId, locale });
  }
  return { action: 'created', documentId: created.documentId, document: created };
}

export function createSummary() {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    record(action) {
      if (action === 'created') this.created += 1;
      else if (action === 'updated') this.updated += 1;
      else this.skipped += 1;
    },
    toString() {
      return `created=${this.created} updated=${this.updated} skipped=${this.skipped}`;
    },
  };
}
