import assert from 'node:assert/strict';

import {
  basicOrderInput,
  cleanupStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const ctxOf = (staff) => ({ actor: staff.actor });

withApp(async (app) => {
  const { order, transition, payment, refund, scope } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  try {
    const q1 = await order.createOrder(basicOrderInput(), systemCtx);
    const q3 = await order.createOrder(
      basicOrderInput({
        locationRef: 'Q3',
        receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
      }),
      systemCtx,
    );

    // lan sees Q1 but Q3 is indistinguishable from missing.
    await order.getOrder(q1.order.order.id, ctxOf(staff.lan));
    await assert.rejects(
      order.getOrder(q3.order.order.id, ctxOf(staff.lan)),
      (error) => error?.code === 'ORDER_NOT_FOUND',
    );
    await assert.rejects(
      transition.transitionGroup(
        {
          orderId: q3.order.order.id,
          groupId: q3.order.groups[0].id,
          to: 'preparing',
        },
        ctxOf(staff.lan),
      ),
      (error) => error?.code === 'ORDER_NOT_FOUND',
    );

    // minh covers both branches.
    await order.getOrder(q3.order.order.id, ctxOf(staff.minh));
    await transition.transitionGroup(
      { orderId: q3.order.order.id, groupId: q3.order.groups[0].id, to: 'preparing' },
      ctxOf(staff.minh),
    );

    // keToan (all locations) lists both; moi has no scope row → deny.
    const all = await order.listOrders({}, ctxOf(staff.keToan));
    assert.equal(all.length, 2);
    await assert.rejects(order.listOrders({}, ctxOf(staff.moi)), (error) =>
      error?.code === 'SCOPE_REQUIRED' ? true : error?.code === 'ORDER_NOT_FOUND',
    );
    await assert.rejects(
      order.getOrder(q1.order.order.id, ctxOf(staff.moi)),
      (error) => error?.code === 'ORDER_NOT_FOUND',
    );

    // Write path: lan cannot create in Q3.
    await assert.rejects(
      order.createOrder(
        basicOrderInput({
          locationRef: 'Q3',
          receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
        }),
        ctxOf(staff.lan),
      ),
      (error) => error?.code === 'BRANCH_NOT_FOUND',
    );

    // Refund scope: lan cannot refund a payment on the Q3 order.
    const q3Payment = await payment.createPayment(
      { orderId: q3.order.order.id, providerCode: 'test' },
      systemCtx,
    );
    await payment.capturePayment(
      { paymentId: q3Payment.id, amount: 5000, providerTransactionId: 'scope-txn' },
      systemCtx,
    );
    await assert.rejects(
      refund.createRefund(
        {
          paymentId: q3Payment.id,
          amount: 1000,
          reason: 'out of scope',
          idempotencyKey: 'scope-refund',
        },
        ctxOf(staff.lan),
      ),
      (error) => error?.code === 'ORDER_NOT_FOUND',
    );

    // The register.ts permission condition is driven by the same scope service.
    assert.equal(await scope.condition(staff.moi.user), false);
    assert.deepEqual(await scope.condition(staff.lan.user), {
      locationRef: { $in: ['Q1'] },
    });
    assert.equal(await scope.condition(staff.keToan.user), true);

    // The same condition must hold inside Strapi's own permission engine (O0 spike pattern):
    // a token ability over `plugin::ordering.order.read` filtered by `same-location`.
    const ORDER = 'plugin::ordering.order';
    const ACTION = 'plugin::ordering.order.read';
    const engineVisible = async (user) => {
      const ability = await app.admin.services.permission.engine.generateTokenAbility(
        [
          {
            action: ACTION,
            subject: ORDER,
            properties: {},
            conditions: ['plugin::ordering.same-location'],
          },
        ],
        user,
      );
      const manager = app.admin.services.permission.createPermissionsManager({
        ability,
        action: ACTION,
        model: ORDER,
      });
      if (!manager.isAllowed) return [];
      const where = manager.getQuery() ?? {};
      const rows = await app.db.query(ORDER).findMany({ where });
      return rows.map((row) => row.locationRef).sort();
    };
    assert.deepEqual(await engineVisible(staff.lan.user), ['Q1']);
    assert.deepEqual(await engineVisible(staff.minh.user), ['Q1', 'Q3']);
    assert.deepEqual(await engineVisible(staff.keToan.user), ['Q1', 'Q3']);
    assert.deepEqual(await engineVisible(staff.moi.user), []);

    const lanList = await order.listOrders({}, ctxOf(staff.lan));
    assert.equal(lanList.length, 1);
    assert.equal(lanList[0].id, q1.order.order.id);
    console.log('[ordering-test] scope: lan Q1-only, minh Q1+Q3, keToan all, moi denied — all paths verified');
  } finally {
    await cleanupStaff(app, staff);
  }
});
