// O10 step 8: editable email templates end to end — the Admin routes are gated by
// settings.manage, an unknown {{var}} fails the save with TEMPLATE_VARIABLE_UNKNOWN, a saved
// override renders on the real order-mail path, a broken override falls back to the built-in
// copy and raises `notification-template-broken`, and DELETE restores the default with a
// change-log row for both save and reset.
import assert from 'node:assert/strict';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const noSettings = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'catalog.manage'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });

  try {
    const plugin = app.plugin('ordering');
    const templates = () => app.db.query('plugin::ordering.notification-template');
    const capture = plugin.service('registry').notificationProvider('email');
    const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
    const sentTo = (to) => capture.sent.filter((mail) => mail.to === to);

    // ── Permission gate: every route needs plugin::ordering.settings.manage ─────────────
    for (const [method, path, body] of [
      ['GET', '/notification-templates'],
      ['GET', '/notification-templates/customer.order-placed/vi'],
      ['PUT', '/notification-templates/customer.order-placed/vi', { subject: 'x', body: 'y' }],
      ['POST', '/notification-templates/customer.order-placed/vi/preview', {}],
      ['POST', '/notification-templates/customer.order-placed/vi/test', {}],
      ['DELETE', '/notification-templates/customer.order-placed/vi'],
    ]) {
      const res = await noSettings.as.nv(method, path, body);
      assert.equal(res.status, 403, `${method} ${path} denied without settings.manage`);
    }

    // ── List: every template code × vi/en with "customized" flags ─────────────────────────
    const list = await staff.as.quanly('GET', '/notification-templates');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.results.length, 21, 'all 21 template codes listed');
    for (const row of list.body.results) {
      assert.equal(row.locales.vi.customized, false);
      assert.equal(row.locales.en.customized, false);
      assert.ok(row.name && row.audience && row.code);
    }

    // ── Validation: unknown vars, missing fields, bad code/locale ───────────────────────
    const badVar = await staff.as.quanly('PUT', '/notification-templates/customer.order-placed/vi', {
      subject: 'Đơn {{code}}',
      body: 'Xin chào {{hack}}',
    });
    assert.equal(badVar.status, 400);
    assert.equal(badVar.body.error.code, 'TEMPLATE_VARIABLE_UNKNOWN');
    assert.deepEqual(badVar.body.error.details.variables, ['hack']);

    const empty = await staff.as.quanly('PUT', '/notification-templates/customer.order-placed/vi', {
      subject: '   ',
      body: 'x',
    });
    assert.equal(empty.status, 400, 'blank subject rejected');
    assert.equal(empty.body.error.code, 'VALIDATION_ERROR');

    assert.equal(
      (await staff.as.quanly('GET', '/notification-templates/not-a-code/vi')).status,
      404,
      'unknown code → 404',
    );
    assert.equal(
      (await staff.as.quanly('GET', '/notification-templates/customer.order-placed/fr')).status,
      404,
      'unknown locale → 404',
    );
    assert.equal(
      (await staff.as.quanly('DELETE', '/notification-templates/customer.order-placed/vi')).status,
      404,
      'reset with no override → 404',
    );

    // ── Default view + preview before any override ──────────────────────────────────────
    const before = await staff.as.quanly('GET', '/notification-templates/customer.order-placed/vi');
    assert.equal(before.status, 200);
    assert.equal(before.body.customized, false);
    assert.ok(before.body.defaults.body.includes('{{items}}'), 'default source is editable markdown');
    assert.ok(
      before.body.variables.some((v) => v.name === 'code'),
      'variable list comes with the detail',
    );

    const preview = await staff.as.quanly(
      'POST',
      '/notification-templates/customer.order-placed/vi/preview',
      { subject: 'Xem thử {{code}}', body: 'Đơn {{code}} tại {{branch}}.\n\n{{items}}' },
    );
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.match(preview.body.rendered.subject, /Xem thử A1B2C3/);
    assert.match(preview.body.rendered.text, /Phở bò/);
    assert.ok(preview.body.rendered.html.includes('<li>'), 'items render as a list');

    // ── Save an override → real order mail uses it ──────────────────────────────────────
    const saved = await staff.as.quanly('PUT', '/notification-templates/customer.order-placed/vi', {
      subject: 'TESTSUBJ đơn {{code}}',
      body: 'Cảm ơn bạn đã đặt tại **{{branch}}**.\n\n{{items}}\n\n{{footer}}',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.customized, true);
    assert.ok(saved.body.updatedBy, 'editor recorded');

    await seedBranches(app);
    seedMenu(app);
    capture.sent.length = 0;
    await plugin
      .service('order')
      .createOrder(
        basicOrderInput({ contact: { name: 'Khách Mẫu', phone: '+84900000002', email: 'khach@example.invalid' } }),
        systemCtx,
      );
    await dispatch();
    const customMail = sentTo('khach@example.invalid').find((m) => m.template === 'customer.order-placed');
    assert.ok(customMail, 'customer order mail went out');
    assert.match(customMail.subject, /^TESTSUBJ đơn /, 'saved subject is used on the real send');

    // ── Test mail to the signed-in admin ────────────────────────────────────────────────
    const test = await staff.as.quanly(
      'POST',
      '/notification-templates/customer.order-placed/vi/test',
      {},
    );
    assert.equal(test.status, 200, JSON.stringify(test.body));
    const testMail = capture.sent.at(-1);
    assert.ok(
      testMail.to.startsWith('http-quanly-') && testMail.to.endsWith('@example.invalid'),
      'test mail targets the signed-in admin mailbox',
    );
    assert.equal(testMail.template, 'customer.order-placed');
    assert.match(testMail.subject, /^TESTSUBJ đơn /);

    // ── Broken override (a stale row saved before a var was removed): default + alert ────
    await templates().create({
      data: {
        code: 'customer.order-placed',
        messageLocale: 'en',
        subject: 'Order {{code}}',
        body: 'Thanks {{code}} — {{removedVar}}',
        updatedByRef: 'admin:1',
      },
    });
    capture.sent.length = 0;
    await plugin
      .service('order')
      .createOrder(
        basicOrderInput({
          locale: 'en',
          contact: { name: 'En Guest', phone: '+84900000003', email: 'en@example.invalid' },
        }),
        systemCtx,
      );
    await dispatch();
    const fallbackMail = sentTo('en@example.invalid').find((m) => m.template === 'customer.order-placed');
    assert.ok(fallbackMail, 'mail still goes out when the override is broken');
    assert.ok(!fallbackMail.subject.includes('{{'), 'default copy rendered, not the broken source');
    const brokenAlert = await app.db
      .query('plugin::ordering.ops-alert')
      .findOne({ where: { alertCode: 'notification-template-broken' } });
    assert.ok(brokenAlert, 'notification-template-broken alert raised');
    assert.equal(brokenAlert.dedupeKey, 'notification-template:customer.order-placed:en');

    // ── Reset restores the built-in copy ─────────────────────────────────────────────────
    const reset = await staff.as.quanly(
      'DELETE',
      '/notification-templates/customer.order-placed/vi',
    );
    assert.equal(reset.status, 200);
    assert.equal(reset.body.restored, true);
    const after = await staff.as.quanly('GET', '/notification-templates/customer.order-placed/vi');
    assert.equal(after.body.customized, false);
    assert.deepEqual(after.body.subject, after.body.defaults.subject, 'default subject restored');

    // ── Audit trail ──────────────────────────────────────────────────────────────────────
    const audit = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: { $in: ['notification-template.save', 'notification-template.reset'] } },
      orderBy: { id: 'asc' },
    });
    assert.ok(
      audit.some((row) => row.action === 'notification-template.save'),
      'save recorded in the change log',
    );
    assert.ok(
      audit.some((row) => row.action === 'notification-template.reset'),
      'reset recorded in the change log',
    );

    console.log(
      '[ordering-test] email-templates: 403 gate, 400 var validation, preview, test mail, custom send, broken→default+alert, reset, audit',
    );
  } finally {
    await staff.cleanup();
    await noSettings.cleanup();
  }
});
