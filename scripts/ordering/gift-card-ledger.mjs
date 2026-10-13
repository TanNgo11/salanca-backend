// O9 plan step 2 verification: the gift-card ledger under a seeded random walk of 200 ops.
// Invariants asserted after EVERY op: `balance = Σ amount` of the card's ledger rows and
// `balance >= 0`. After the walk: each row's `balanceAfter` replays from the previous row,
// the ledger only ever grew (append-only), and no service source updates/deletes ledger rows.
// Cards exercised: a sale card, a preprinted batch card (activate path), and a stale card the
// expiry sweep flips mid-walk.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { services, systemCtx, withApp } from './_harness.mjs';

const CARD_TABLE = 'plugins_ordering_gift_card';
const ctx = systemCtx;

// Deterministic PRNG so a failure replays identically.
const rng = ((seed) => () => (seed = (seed * 48271) % 2147483647) / 2147483647)(20261013);
const amount = (min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (items) => items[Math.floor(rng() * items.length)];

const expectError = async (fn, codes) => {
  try {
    await fn();
    return null;
  } catch (error) {
    assert.ok(
      codes.includes(error.code),
      `expected ${codes.join('|')}, got ${error.code}: ${error.message}`,
    );
    return error.code;
  }
};

await withApp(async (app) => {
  const svc = services(app).giftCard;
  const knex = app.db.connection;

  const issue = (input) =>
    app.db.transaction(async ({ trx }) => svc.issueInTransaction(trx, input, ctx));
  const sale = await issue({ amount: 100000, source: 'sale' });
  const batch = await issue({ amount: 250000, source: 'batch' });
  const stale = await issue({
    amount: 80000,
    source: 'manual',
    expiresAt: new Date(Date.now() - 86_400_000),
  });
  const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$/;
  assert.match(sale.code, CODE_RE, 'sale issue returns the one-time formatted code');
  assert.match(batch.code, CODE_RE, 'generated batch codes are returned for printing');

  const state = {
    [sale.id]: { balance: 100000, status: 'active', expires: null },
    [batch.id]: { balance: 0, status: 'inactive', expires: null },
    [stale.id]: { balance: 80000, status: 'active', expires: new Date(Date.now() - 86_400_000) },
  };
  for (const id of Object.keys(state)) {
    const row = await knex(CARD_TABLE).where({ id }).first();
    state[id].expires = new Date(row.expires_at);
  }

  const assertInvariant = async (cardId, label) => {
    const card = await knex(CARD_TABLE).where({ id: cardId }).first();
    const [{ sum }] = await knex('plugins_ordering_gift_card_ledger as l')
      .join(
        'plugins_ordering_gift_card_ledger_card_lnk as link',
        'link.gift_card_ledger_id',
        'l.id',
      )
      .where('link.gift_card_id', cardId)
      .sum('l.amount as sum');
    const total = Number(sum ?? 0);
    assert.equal(
      Number(card.balance),
      total,
      `${label}: card ${cardId} balance ${card.balance} != Σ ledger ${total}`,
    );
    assert.ok(Number(card.balance) >= 0, `${label}: card ${cardId} went negative`);
  };

  const ops = [];
  for (let step = 0; step < 200; step += 1) {
    const op = pick([
      'redeem', 'redeem', 'redeem',
      'refund', 'refund',
      'adjust', 'adjust',
      'block', 'unblock',
      'extend',
      'activate',
      'expire',
    ]);
    const id = pick([sale.id, batch.id, stale.id]);
    const m = state[id];
    const label = `step ${step} (${op} card ${id})`;
    switch (op) {
      case 'redeem': {
        const wanted = amount(5000, 60000);
        try {
          const result = await app.db.transaction(async ({ trx }) =>
            svc.redeemInTransaction(trx, { cardId: id, amount: wanted }, ctx),
          );
          const expectedApplied = Math.min(wanted, m.balance);
          assert.equal(result.applied, expectedApplied, `${label}: applied ${result.applied} != ${expectedApplied}`);
          assert.equal(result.balanceAfter, m.balance - expectedApplied, `${label}: balanceAfter`);
          m.balance -= expectedApplied;
        } catch (error) {
          const codes = ['GIFT_CARD_INVALID', 'GIFT_CARD_EXPIRED', 'GIFT_CARD_INSUFFICIENT'];
          assert.ok(codes.includes(error.code), `${label}: ${error.code}`);
          if (m.status === 'active' && m.expires > new Date()) {
            assert.equal(error.code, 'GIFT_CARD_INSUFFICIENT', `${label}: unexpected ${error.code}`);
          }
        }
        break;
      }
      case 'refund': {
        const value = amount(5000, 30000);
        const code = await expectError(
          () =>
            app.db.transaction(async ({ trx }) =>
              svc.creditInTransaction(trx, { cardId: id, amount: value, kind: 'refund' }, ctx),
            ),
          ['VALIDATION_ERROR'],
        );
        if (code === null) m.balance += value;
        break;
      }
      case 'adjust': {
        const delta = amount(-15000, 15000);
        const code = await expectError(
          () => svc.adjust(id, delta, 'random-walk', ctx),
          ['VALIDATION_ERROR'],
        );
        if (code === null) m.balance += delta;
        break;
      }
      case 'block': {
        const code = await expectError(() => svc.block(id, 'random-walk', ctx), ['VALIDATION_ERROR']);
        if (code === null) {
          assert.equal(m.status, 'active', `${label}: blocked a ${m.status} card`);
          m.status = 'blocked';
        }
        break;
      }
      case 'unblock': {
        const code = await expectError(() => svc.unblock(id, 'random-walk', ctx), ['VALIDATION_ERROR']);
        if (code === null) {
          assert.equal(m.status, 'blocked', `${label}: unblocked a ${m.status} card`);
          m.status = m.expires > new Date() ? 'active' : 'expired';
        }
        break;
      }
      case 'extend': {
        const next = new Date(m.expires.getTime() + amount(1, 12) * 30 * 86_400_000);
        await svc.extend(id, next, 'random-walk', ctx);
        m.expires = next;
        if (m.status === 'expired') m.status = 'active';
        break;
      }
      case 'activate': {
        const code = await expectError(
          () =>
            app.db.transaction(async ({ trx }) =>
              svc.activateInTransaction(trx, { cardId: id }, ctx),
            ),
          ['GIFT_CARD_INVALID'],
        );
        if (code === null) {
          assert.equal(m.status, 'inactive', `${label}: activated a ${m.status} card`);
          m.status = 'active';
          const row = await knex(CARD_TABLE).where({ id }).first();
          m.balance = Number(row.balance);
          m.expires = new Date(row.expires_at);
        }
        break;
      }
      case 'expire': {
        await svc.expireDue(new Date(), 50);
        for (const [cardId, card] of Object.entries(state)) {
          if (card.status === 'active' && card.expires <= new Date()) {
            card.status = 'expired';
            card.balance = 0;
          }
        }
        break;
      }
    }
    ops.push(op);
    for (const cardId of Object.keys(state)) await assertInvariant(Number(cardId), label);
    const db = await knex(CARD_TABLE).where({ id }).first();
    assert.equal(
      Number(db.balance),
      m.balance,
      `${label}: model balance ${m.balance} != db ${db.balance} (status ${db.status} vs ${m.status})`,
    );
  }

  // Replay every card's ledger: row[i].balanceAfter == row[i-1].balanceAfter + amount.
  for (const cardId of Object.keys(state)) {
    const entries = await svc.entries(Number(cardId));
    let running = 0;
    for (const entry of entries) {
      running += Number(entry.amount);
      assert.equal(
        Number(entry.balanceAfter),
        running,
        `card ${cardId} ledger row ${entry.id} breaks the replay (${entry.kind} ${entry.amount})`,
      );
    }
    assert.equal(running, state[cardId].balance, `card ${cardId} ledger total != final balance`);
  }

  // Append-only: the only way ledger rows change is INSERT (count snapshot matches replay).
  const [{ count }] = await knex('plugins_ordering_gift_card_ledger').count('* as count');
  const replayed = (
    await Promise.all(Object.keys(state).map((cardId) => svc.entries(Number(cardId))))
  ).reduce((sum, rows) => sum + rows.length, 0);
  assert.equal(Number(count), replayed, 'ledger rows exist outside the three cards');

  // No route or service may write UPDATE/DELETE on the ledger: scan sources that mention it.
  // `plugins_ordering_gift_card_ledger\b` does not match the `*_lnk` tables (word char follows).
  const serverSrc = fileURLToPath(new URL('../../src/plugins/ordering/server/src', import.meta.url));
  const tsFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? tsFiles(join(dir, entry.name))
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          ? [join(dir, entry.name)]
          : [],
    );
  const mutatesLedger = /ledger\(\)\s*\.\s*(update|updateMany|delete|deleteMany|del)\s*\(|(UPDATE|DELETE\s+FROM|TRUNCATE)\s+[`'" ]*plugins_ordering_gift_card_ledger\b|plugins_ordering_gift_card_ledger[`'" ]*\)\s*\.\s*(update|del|delete)\s*\(/;
  for (const file of tsFiles(serverSrc)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('gift-card-ledger') && !source.includes('gift_card_ledger')) continue;
    assert.ok(!mutatesLedger.test(source), `${file} mutates the gift-card ledger — it is append-only`);
  }

  console.log(
    `[ordering-test] ledger invariant held across ${ops.length} ops on 3 cards ` +
      `(${Number(count)} ledger rows replayed; balances never negative)`,
  );
});
