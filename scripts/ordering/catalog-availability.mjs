import assert from 'node:assert/strict';

import { cleanupStaff, seedBranches, seedStaff, services, systemCtx, withApp } from './_harness.mjs';

const ctxOf = (staff) => ({ actor: staff.actor });

withApp(async (app) => {
  const svc = app.plugin('ordering').service('catalog-availability');
  const changeLog = services(app).changeLog;
  const adapter = app.plugin('ordering').service('registry').catalogAdapter('ordering-catalog');
  await seedBranches(app);
  const staff = await seedStaff(app);
  try {
    // --- Seed catalog entities -----------------------------------------------------------
    const product = await app.documents('plugin::ordering.catalog-product').create({
      data: {
        productType: 'food', status: 'active', sellOnline: true,
        fulfillmentKinds: ['pickup'], name: { vi: 'Trà đào cam sả' },
      },
    });
    const variant = await app.documents('plugin::ordering.catalog-variant').create({
      data: { product: product.documentId, name: { vi: 'Ly lớn' }, sku: 'TDCS-L' },
    });
    const group = await app.documents('plugin::ordering.catalog-modifier-group').create({
      data: { name: { vi: 'Topping' }, selectionType: 'multiple', rank: 0 },
    });
    const modifier = await app.documents('plugin::ordering.catalog-modifier').create({
      data: { group: group.documentId, name: { vi: 'Giò heo' }, priceDelta: 15000 },
    });

    // --- Scoped branch lists -------------------------------------------------------------
    const codes = async (ctx) => (await svc.listLocations(ctx)).items.map((b) => b.code);
    assert.deepEqual(await codes(ctxOf(staff.lan)), ['Q1'], 'lan sees only Q1');
    assert.deepEqual(await codes(ctxOf(staff.minh)), ['Q1', 'Q3'], 'minh sees both');
    assert.deepEqual((await codes(ctxOf(staff.keToan))).sort(), ['Q1', 'Q3'], 'keToan sees all');
    assert.deepEqual(await codes(ctxOf(staff.moi)), [], 'unscoped staff sees nothing');

    // --- Flat list defaults to selling ----------------------------------------------------
    const rows = (await svc.list('Q1', systemCtx)).items;
    assert.equal(rows.length, 3, 'product + variant + modifier listed');
    assert.ok(rows.every((row) => row.selling === true && row.outOfStockUntil === null));
    assert.deepEqual(
      rows.map((row) => row.entityType).sort(),
      ['modifier', 'product', 'variant'],
    );

    // --- Toggle off until end of business day ---------------------------------------------
    const off = await svc.toggle(
      {
        entityType: 'product',
        entityDocumentId: product.documentId,
        locationRef: 'Q1',
        selling: false,
        untilKind: 'end-of-business-day',
      },
      ctxOf(staff.lan),
    );
    assert.equal(off.item.selling, false);
    assert.equal(off.item.untilKind, 'end-of-business-day');
    const until = Date.parse(off.item.outOfStockUntil);
    assert.ok(until > Date.now() && until < Date.now() + 26 * 3600 * 1000,
      'EOD cutoff lands within the next ~day');
    assert.equal(off.item.toggledBy, `admin:${staff.lan.user.id}`, 'actor recorded on the row');

    // The adapter honours it at Q1 but not at Q3.
    const adapterCtx = (locationRef) => ({ locationRef, now: new Date().toISOString() });
    const q1 = await adapter.getSellable(adapterCtx('Q1'), { uid: product.documentId }, { locale: 'vi' });
    const q3 = await adapter.getSellable(adapterCtx('Q3'), { uid: product.documentId }, { locale: 'vi' });
    assert.equal(q1.purchasable, false, 'toggled off at Q1');
    assert.equal(q3.purchasable, true, 'still sells at Q3');

    // --- Scope enforcement on writes -------------------------------------------------------
    await assert.rejects(
      svc.toggle(
        { entityType: 'product', entityDocumentId: product.documentId, locationRef: 'Q3', selling: false },
        ctxOf(staff.lan),
      ),
      (error) => error?.code === 'SCOPE_REQUIRED',
      'lan cannot toggle at Q3',
    );
    await assert.rejects(svc.list('Q3', ctxOf(staff.lan)), (error) => error?.code === 'SCOPE_REQUIRED');
    await assert.rejects(svc.list('Q1', ctxOf(staff.moi)), (error) => error?.code === 'SCOPE_REQUIRED');
    await svc.toggle(
      { entityType: 'modifier', entityDocumentId: modifier.documentId, locationRef: 'Q3', selling: false },
      ctxOf(staff.keToan),
    );

    // --- Specific-time toggle ('HH:mm' branch-local) ---------------------------------------
    const timed = await svc.toggle(
      {
        entityType: 'variant',
        entityDocumentId: variant.documentId,
        locationRef: 'Q1',
        selling: false,
        untilKind: 'specific-time',
        until: '14:00',
      },
      ctxOf(staff.minh),
    );
    assert.equal(timed.item.untilKind, 'specific-time');
    const timedUntil = Date.parse(timed.item.outOfStockUntil);
    assert.ok(timedUntil > Date.now() && timedUntil < Date.now() + 25 * 3600 * 1000);

    // Validation paths.
    await assert.rejects(
      svc.toggle(
        { entityType: 'product', entityDocumentId: product.documentId, locationRef: 'Q1',
          selling: false, untilKind: 'specific-time', until: '2000-01-01T00:00:00Z' },
        ctxOf(staff.keToan),
      ),
      (error) => error?.code === 'VALIDATION_ERROR',
      'a past instant is rejected',
    );
    await assert.rejects(
      svc.toggle(
        { entityType: 'product', entityDocumentId: 'missing-ref', locationRef: 'Q1', selling: false },
        ctxOf(staff.keToan),
      ),
      (error) => error?.code === 'SELLABLE_NOT_FOUND',
    );
    await assert.rejects(
      svc.toggle(
        { entityType: 'spaceship', entityDocumentId: product.documentId, locationRef: 'Q1', selling: false },
        ctxOf(staff.keToan),
      ),
      (error) => error?.code === 'VALIDATION_ERROR',
    );

    // --- Toggle back on clears the timer ---------------------------------------------------
    const on = await svc.toggle(
      { entityType: 'product', entityDocumentId: product.documentId, locationRef: 'Q1', selling: true },
      ctxOf(staff.lan),
    );
    assert.equal(on.item.selling, true);
    assert.equal(on.item.outOfStockUntil, null);
    const relisted = (await svc.list('Q1', ctxOf(staff.lan))).items.find(
      (row) => row.entityDocumentId === product.documentId,
    );
    assert.equal(relisted.selling, true);

    // --- Change log ------------------------------------------------------------------------
    const logs = await changeLog.list({ entityType: 'catalog-location-state', limit: 20 });
    const toggles = logs.filter((row) => row.action === 'catalog-availability.toggle');
    assert.ok(toggles.length >= 4, 'every successful toggle is logged');
    assert.ok(
      toggles.some((row) => row.actorRef === `admin:${staff.lan.user.id}` && row.locationRef === 'Q1'),
      'lan toggles recorded under her branch',
    );

    // --- Route is mounted and guarded (no token → 401) ------------------------------------
    await app.listen();
    const res = await fetch(
      `http://127.0.0.1:${process.env.PORT}/ordering/availability?locationRef=Q1`,
    );
    assert.equal(res.status, 401, 'unauthenticated admin call must be rejected');

    console.log('[ordering-test] catalog-availability: scoped lists, EOD/specific-time toggles, guardrails, audit verified');
  } finally {
    await cleanupStaff(app, staff);
  }
});
