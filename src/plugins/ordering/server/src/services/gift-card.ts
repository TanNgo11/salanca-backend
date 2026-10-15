import { createHmac } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { OutboxEvent } from '../contracts';
import { OrderingError } from '../domain/errors';
import {
  formatGiftCardCode,
  generateGiftCardCode,
  giftCardCodeHash,
  last4Of,
  normalizeGiftCardCode,
} from '../domain/gift-cards/code';
import { payableTotal } from '../domain/payable';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../domain/token-cipher';
import { GIFT_CARD_WORKFLOW_NAME } from '../domain/workflow/definitions';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type alertFactory from './alert';
import { actorRefOf, nowOf, type ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

const CARD_UID = 'plugin::ordering.gift-card';
const LEDGER_UID = 'plugin::ordering.gift-card-ledger';
const CARD_TABLE = 'plugins_ordering_gift_card';

export type GiftCardRow = {
  id: number;
  documentId: string;
  codeHash: string;
  last4: string;
  initialAmount: number | string;
  balance: number | string;
  currency: string;
  status: 'inactive' | 'active' | 'blocked' | 'expired';
  source: 'sale' | 'manual' | 'batch';
  issuedAt: string | null;
  expiresAt: string;
  soldAt: string | null;
  recipientEmailHash: string | null;
  issuedBy: string | null;
  note: string | null;
  sealedCode: string | null;
  order?: { id: number; code?: string } | number | null;
  orderLine?: { id: number } | number | null;
  batch?: { id: number; code?: string } | number | null;
};

export type GiftCardLedgerRow = {
  id: number;
  kind: string;
  amount: number | string;
  balanceAfter: number | string;
  actorRef: string | null;
  reason: string | null;
  at: string;
  order?: { id: number; code?: string } | number | null;
  payment?: { id: number } | number | null;
  refund?: { id: number } | number | null;
};

/** Same dev fallback as O11 identity hashing — production boots with a real key or warns loudly. */
const DEV_FALLBACK_KEY = 'ordering-o11-dev-hash-key!!32bytes';

const asInt = (value: number | string | null | undefined): number =>
  typeof value === 'number' ? value : Number(value ?? 0);

/** Row lock for admin status ops — a missing card is a 404 here, not an oracle. */
const lockCard = async (
  trx: TransactionClient,
  id: number,
): Promise<{ status: string; expires_at: string; balance: number | string }> => {
  const { rows } = await trx.raw(
    `SELECT status, expires_at, balance FROM ${CARD_TABLE} WHERE id = ? FOR UPDATE`,
    [id],
  );
  const row = rows?.[0] as { status: string; expires_at: string; balance: number | string } | undefined;
  if (!row) {
    throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found', { details: { id } });
  }
  return row;
};

/**
 * The gift-card ledger service (O9 plan step 2). Every balance write happens inside the caller's
 * transaction: `db.query` calls pick up Strapi's ambient transaction, raw statements get `trx`.
 * The card row is the concurrency guard — `redeemInTransaction` debits with a conditional UPDATE
 * so two parallel orders can never overspend a card, and `CHECK (balance >= 0)` backstops it.
 */
const giftCard = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const plugin = () => strapi.plugin('ordering');
  const cards = () => strapi.db.query(CARD_UID);
  const ledger = () => strapi.db.query(LEDGER_UID);
  const outbox = () =>
    plugin().service('outbox') as {
      enqueue(
        input: {
          type: string;
          aggregateType: string;
          aggregateId: string;
          payload: Record<string, unknown>;
          uniqueKey?: string;
        },
        ctx: ServiceContext,
      ): Promise<unknown>;
    };
  const notifications = () =>
    plugin().service('notification') as {
      sendGiftCardIssued(
        event: OutboxEvent,
        input: {
          orderId: number;
          email: string;
          recipientName?: string;
          message?: string;
          cards: Array<{ code: string; amount: number }>;
          includeOrderLink: boolean;
          expiresAt?: string;
        },
      ): Promise<void>;
    };
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const alert = () => plugin().service('alert') as ReturnType<typeof alertFactory>;
  const refund = () =>
    plugin().service('refund') as {
      createRefundInTransaction(
        trx: TransactionClient,
        input: { paymentId: number; amount?: number; reason: string; idempotencyKey?: string },
        ctx: ServiceContext,
      ): Promise<{ amount: number; status: string }>;
    };

  let keyBuffer: Buffer | null = null;
  const key = (): Buffer => {
    if (!keyBuffer) {
      const parsed = parseEncryptionKey(config().encryptionKey ?? '');
      keyBuffer = parsed.valid
        ? parsed.key
        : Buffer.from(DEV_FALLBACK_KEY.padEnd(32, '!').slice(0, 32));
    }
    return keyBuffer;
  };

  const codeHashOf = (normalized: string): string => giftCardCodeHash(key(), normalized);

  /** HMAC of the recipient address — enough for resend, useless without the key. */
  const recipientHash = (email: string): string =>
    createHmac('sha256', key())
      .update(`gift-card-recipient:${email.trim().toLowerCase()}`)
      .digest('hex');

  /** AES-GCM seal of any short secret (code, recipient email); null without a valid key. */
  const sealText = (text: string): string | null => {
    const parsed = parseEncryptionKey(config().encryptionKey ?? '');
    if (!parsed.valid) return null;
    return encryptSecret(text, parsed.key);
  };

  const unseal = (sealed: string | null | undefined): string | null => {
    if (!sealed) return null;
    const parsed = parseEncryptionKey(config().encryptionKey ?? '');
    if (!parsed.valid) return null;
    try {
      return decryptSecret(sealed, parsed.key);
    } catch {
      return null;
    }
  };

  /** Sealed copy for the one-time staff display; absent when no encryption key is configured. */
  const seal = (normalized: string): string | null => sealText(formatGiftCardCode(normalized));

  const appendLedger = async (input: {
    cardId: number;
    kind: string;
    amount: number;
    balanceAfter: number;
    orderId?: number | null;
    paymentId?: number | null;
    refundId?: number | null;
    actorRef?: string | null;
    reason?: string | null;
    at: Date;
  }): Promise<void> => {
    await ledger().create({
      data: {
        card: input.cardId,
        kind: input.kind,
        amount: input.amount,
        balanceAfter: input.balanceAfter,
        ...(input.orderId ? { order: input.orderId } : {}),
        ...(input.paymentId ? { payment: input.paymentId } : {}),
        ...(input.refundId ? { refund: input.refundId } : {}),
        actorRef: input.actorRef ?? null,
        reason: input.reason ?? null,
        at: input.at,
      },
    });
  };

  const toCard = (row: GiftCardRow) => ({
    id: row.id,
    documentId: row.documentId,
    last4: row.last4,
    initialAmount: asInt(row.initialAmount),
    balance: asInt(row.balance),
    currency: row.currency,
    status: row.status,
    source: row.source,
    issuedAt: row.issuedAt ? String(row.issuedAt) : null,
    expiresAt: String(row.expiresAt),
    soldAt: row.soldAt ? String(row.soldAt) : null,
    recipientEmailHash: row.recipientEmailHash ?? null,
    issuedBy: row.issuedBy ?? null,
    note: row.note ?? null,
    // sealedCode and codeHash never leave the service.
    orderId:
      typeof row.order === 'object' && row.order ? row.order.id : ((row.order as number | null) ?? null),
    orderCode: typeof row.order === 'object' && row.order ? (row.order.code ?? null) : null,
    orderLineId:
      typeof row.orderLine === 'object' && row.orderLine
        ? row.orderLine.id
        : ((row.orderLine as number | null) ?? null),
    batchId:
      typeof row.batch === 'object' && row.batch ? row.batch.id : ((row.batch as number | null) ?? null),
    batchCode: typeof row.batch === 'object' && row.batch ? (row.batch.code ?? null) : null,
  });

  const addMonths = (at: Date, months: number): Date => {
    const out = new Date(at.getTime());
    out.setUTCMonth(out.getUTCMonth() + months);
    return out;
  };

  /**
   * Money the order really holds: captured minus refunded, minus refunds still pending. Value can
   * leave an order after its gift-card group reached `issued` but before this consumer ran (a
   * wallet/transfer refund on another payment, a `refund-due` row on the review queue), and a
   * card must never be issued against money that is no longer there (audit O-04 remainder).
   */
  const heldForOrder = async (trx: TransactionClient, orderId: number): Promise<number> => {
    const paymentRows = (await trx('plugins_ordering_payment as p')
      .join('plugins_ordering_payment_order_lnk as link', 'link.payment_id', 'p.id')
      .where('link.order_id', orderId)
      .select('p.captured_amount', 'p.refunded_amount')) as Array<{
      captured_amount: string | number;
      refunded_amount: string | number;
    }>;
    const held = paymentRows.reduce(
      (sum, row) => sum + asInt(row.captured_amount) - asInt(row.refunded_amount),
      0,
    );
    const pending = (await trx('plugins_ordering_refund as refund')
      .join('plugins_ordering_refund_order_lnk as link', 'link.refund_id', 'refund.id')
      .where('link.order_id', orderId)
      .where('refund.status', 'pending')
      .sum({ value: 'refund.amount' })
      .first()) as { value: string | number | null } | undefined;
    return held - asInt(pending?.value ?? 0);
  };

  const service = {
    recipientHash,
    codeHashOf,

    /** Public card shape (masked surfaces) — admin reads share the mapper; secrets stay out. */
    mapCard: (row: GiftCardRow) => toCard(row),

    /**
     * HMAC lookup. Timing is made uniform by always hashing (a dummy for malformed input) and
     * always running the same unique-index query — the caller answers GIFT_CARD_INVALID either
     * way, so "unknown" and "malformed" stay indistinguishable.
     */
    async findByCode(rawCode: unknown): Promise<ReturnType<typeof toCard> | null> {
      const normalized = normalizeGiftCardCode(rawCode);
      const hash = codeHashOf(normalized ?? 'AAAAAAAAAAAAAAAA');
      const row = (await cards().findOne({ where: { codeHash: hash } })) as GiftCardRow | null;
      if (!normalized || !row) return null;
      return toCard(row);
    },

    async findById(id: number): Promise<ReturnType<typeof toCard> | null> {
      const row = (await cards().findOne({
        where: { id },
        populate: { order: true, orderLine: true, batch: true },
      })) as GiftCardRow | null;
      return row ? toCard(row) : null;
    },

    /**
     * Creates a card plus its `issue` ledger entry inside the caller's transaction. Codes are
     * generated unless `input.code` supplies one (physical-batch import); a collision is caught
     * by a pre-check so the transaction survives and a fresh code is generated (imports fail
     * loudly instead — a duplicated imported code is a data error). `source: 'batch'` cards
     * start `inactive` with zero balance and no ledger row — activation writes `activate` at
     * the counter sale.
     */
    async issueInTransaction(
      trx: TransactionClient,
      input: {
        amount: number;
        currency?: string;
        expiresAt?: Date;
        source: 'sale' | 'manual' | 'batch';
        code?: string;
        sealCode?: boolean;
        orderId?: number | null;
        orderLineId?: number | null;
        batchId?: number | null;
        recipientEmail?: string | null;
        issuedBy?: string | null;
        note?: string | null;
        issuedAt?: Date;
      },
      ctx: ServiceContext,
    ): Promise<{ id: number; code: string | null; last4: string; expiresAt: Date }> {
      const now = input.issuedAt ?? nowOf(ctx);
      const expiresAt = input.expiresAt ?? addMonths(now, config().giftCards.validityMonths);
      const inactive = input.source === 'batch';
      const actorRef = input.issuedBy ?? actorRefOf(ctx);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const normalized = input.code ? normalizeGiftCardCode(input.code) : generateGiftCardCode();
        if (!normalized) {
          throw new OrderingError('VALIDATION_ERROR', 'gift-card code is malformed', {
            details: { field: 'code' },
          });
        }
        const codeHash = codeHashOf(normalized);
        const { rows: taken } = await trx.raw(
          `SELECT 1 FROM ${CARD_TABLE} WHERE code_hash = ?`,
          [codeHash],
        );
        if (taken?.length) {
          if (input.code) {
            throw new OrderingError('VALIDATION_ERROR', 'gift-card code is already on file', {
              details: { field: 'code' },
            });
          }
          continue;
        }
        const row = (await cards().create({
          data: {
            codeHash,
            last4: last4Of(normalized),
            initialAmount: input.amount,
            balance: inactive ? 0 : input.amount,
            currency: input.currency ?? 'VND',
            status: inactive ? 'inactive' : 'active',
            source: input.source,
            issuedAt: inactive ? null : now,
            expiresAt,
            ...(input.orderId ? { order: input.orderId } : {}),
            ...(input.orderLineId ? { orderLine: input.orderLineId } : {}),
            ...(input.batchId ? { batch: input.batchId } : {}),
            recipientEmailHash: input.recipientEmail ? recipientHash(input.recipientEmail) : null,
            // Sealed original recipient for resend/masked display — the row's only PII, still
            // encrypted at rest; `sealedCode` has a retention job, this stays for the card's life.
            sealedRecipient: input.recipientEmail
              ? sealText(input.recipientEmail.trim().toLowerCase())
              : null,
            issuedBy: actorRef,
            note: input.note ?? null,
            sealedCode: input.sealCode === false ? null : seal(normalized),
          },
        })) as GiftCardRow;
        if (!inactive) {
          await appendLedger({
            cardId: row.id,
            kind: 'issue',
            amount: input.amount,
            balanceAfter: input.amount,
            orderId: input.orderId ?? null,
            actorRef,
            reason: input.note ?? null,
            at: now,
          });
        }
        return {
          id: row.id,
          code: input.code ? null : formatGiftCardCode(normalized),
          last4: row.last4,
          expiresAt,
        };
      }
      throw new OrderingError('INTERNAL', 'could not allocate a unique gift-card code');
    },

    /**
     * Debits a card inside the order-creation transaction (O9 plan step 4 decision):
     * `UPDATE … WHERE status='active' AND expires_at > now AND balance >= n`. A miss re-reads
     * the row FOR UPDATE — blocked/expired answer their own errors, a positive balance is tried
     * once with the real amount, zero balance is GIFT_CARD_INSUFFICIENT. The ledger entry and
     * the returned `applied` always reflect the amount actually debited, which can be lower than
     * the quote promised when a concurrent order drained the card first.
     */
    async redeemInTransaction(
      trx: TransactionClient,
      input: { cardId: number; amount: number; orderId?: number | null; paymentId?: number | null },
      ctx: ServiceContext,
    ): Promise<{ applied: number; balanceAfter: number }> {
      const now = nowOf(ctx);
      const debit = async (amount: number) =>
        trx.raw(
          `UPDATE ${CARD_TABLE}
             SET balance = balance - ?, updated_at = ?
           WHERE id = ? AND status = 'active' AND expires_at > ? AND balance >= ?
           RETURNING balance`,
          [amount, now, input.cardId, now, amount],
        );

      let applied = input.amount;
      let { rows } = await debit(applied);
      if (rows.length === 0) {
        const row = await lockCard(trx, input.cardId);
        // Public callers must not learn which failure it was beyond the code contract.
        if (row.status !== 'active') {
          throw new OrderingError('GIFT_CARD_INVALID', 'gift card cannot be used');
        }
        if (new Date(row.expires_at).getTime() <= now.getTime()) {
          throw new OrderingError('GIFT_CARD_EXPIRED', 'gift card has expired');
        }
        const fresh = asInt(row.balance);
        if (fresh <= 0) {
          throw new OrderingError('GIFT_CARD_INSUFFICIENT', 'gift card balance is exhausted');
        }
        applied = Math.min(fresh, input.amount);
        ({ rows } = await debit(applied));
        if (rows.length === 0) {
          throw new OrderingError('GIFT_CARD_INSUFFICIENT', 'gift card balance is exhausted');
        }
      }
      const balanceAfter = asInt(rows[0].balance);
      await appendLedger({
        cardId: input.cardId,
        kind: 'redeem',
        amount: -applied,
        balanceAfter,
        orderId: input.orderId ?? null,
        paymentId: input.paymentId ?? null,
        actorRef: actorRefOf(ctx),
        at: now,
      });
      return { applied, balanceAfter };
    },

    /**
     * Credits a card inside the caller's transaction (refund, adjust, expire). `amount` is
     * signed; the conditional UPDATE refuses a debit that would take the balance below zero
     * (the CHECK constraint is the backstop) and refuses any credit on an `inactive` card —
     * unactivated stock has no value, and crediting it would be wiped by `activate`'s
     * `balance = initial_amount`, breaking `balance = Σ amount`. Blocked and expired cards
     * still take refunds; what staff do with restored value is an admin decision.
     */
    async creditInTransaction(
      trx: TransactionClient,
      input: {
        cardId: number;
        amount: number;
        kind: 'refund' | 'adjust' | 'issue' | 'activate';
        orderId?: number | null;
        paymentId?: number | null;
        refundId?: number | null;
        reason?: string | null;
        actorRef?: string | null;
      },
      ctx: ServiceContext,
    ): Promise<{ balanceAfter: number }> {
      const now = nowOf(ctx);
      const { rows } = await trx.raw(
        `UPDATE ${CARD_TABLE}
           SET balance = balance + ?, updated_at = ?
         WHERE id = ? AND status != 'inactive' AND balance + ? >= 0
         RETURNING balance`,
        [input.amount, now, input.cardId, input.amount],
      );
      if (!rows?.length) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          'gift card is inactive or the adjustment would make the balance negative',
          { details: { cardId: input.cardId, amount: input.amount } },
        );
      }
      const balanceAfter = asInt(rows[0].balance);
      await appendLedger({
        cardId: input.cardId,
        kind: input.kind,
        amount: input.amount,
        balanceAfter,
        orderId: input.orderId ?? null,
        paymentId: input.paymentId ?? null,
        refundId: input.refundId ?? null,
        actorRef: input.actorRef ?? actorRefOf(ctx),
        reason: input.reason ?? null,
        at: now,
      });
      return { balanceAfter };
    },

    /**
     * Counter-sale activation of a preprinted (`batch`, `inactive`) card: the denomination
     * loads and the card goes live in one conditional UPDATE; validity starts at activation.
     */
    async activateInTransaction(
      trx: TransactionClient,
      input: {
        cardId: number;
        orderId?: number | null;
        paymentId?: number | null;
        reason?: string | null;
        /** Counter-sale recipient mailbox — sealed for resend/masked display like a fresh issue. */
        recipientEmail?: string | null;
      },
      ctx: ServiceContext,
    ): Promise<{ activatedAmount: number; balanceAfter: number }> {
      const now = nowOf(ctx);
      const expiresAt = addMonths(now, config().giftCards.validityMonths);
      const { rows } = await trx.raw(
        `UPDATE ${CARD_TABLE}
           SET status = 'active', balance = initial_amount, issued_at = ?, sold_at = ?,
               expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'inactive'
         RETURNING balance`,
        [now, now, expiresAt, now, input.cardId],
      );
      if (!rows?.length) {
        throw new OrderingError('GIFT_CARD_INVALID', 'gift card is not awaiting activation');
      }
      const balanceAfter = asInt(rows[0].balance);
      if (input.recipientEmail) {
        const email = input.recipientEmail.trim().toLowerCase();
        await trx(CARD_TABLE)
          .where({ id: input.cardId })
          .update({
            recipient_email_hash: recipientHash(email),
            sealed_recipient: sealText(email),
          });
      }
      await appendLedger({
        cardId: input.cardId,
        kind: 'activate',
        amount: balanceAfter,
        balanceAfter,
        orderId: input.orderId ?? null,
        paymentId: input.paymentId ?? null,
        actorRef: actorRefOf(ctx),
        reason: input.reason ?? null,
        at: now,
      });
      return { activatedAmount: balanceAfter, balanceAfter };
    },

    /** Admin status ops — each locks the card FOR UPDATE, flips status and writes the
     *  matching zero-amount ledger entry; the caller adds the change-log row. */
    async block(id: number, reason: string, ctx: ServiceContext): Promise<void> {
      await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const row = await lockCard(trx, id);
        if (row.status !== 'active') {
          throw new OrderingError('VALIDATION_ERROR', 'only an active card can be blocked', {
            details: { status: row.status },
          });
        }
        await trx(CARD_TABLE).where({ id }).update({ status: 'blocked', updated_at: nowOf(ctx) });
        await appendLedger({
          cardId: id, kind: 'block', amount: 0, balanceAfter: asInt(row.balance),
          actorRef: actorRefOf(ctx), reason, at: nowOf(ctx),
        });
      });
    },

    async unblock(id: number, reason: string | null, ctx: ServiceContext): Promise<void> {
      await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const row = await lockCard(trx, id);
        if (row.status !== 'blocked') {
          throw new OrderingError('VALIDATION_ERROR', 'only a blocked card can be unblocked', {
            details: { status: row.status },
          });
        }
        const next =
          new Date(row.expires_at).getTime() > nowOf(ctx).getTime() ? 'active' : 'expired';
        await trx(CARD_TABLE).where({ id }).update({ status: next, updated_at: nowOf(ctx) });
        await appendLedger({
          cardId: id, kind: 'unblock', amount: 0, balanceAfter: asInt(row.balance),
          actorRef: actorRefOf(ctx), reason, at: nowOf(ctx),
        });
      });
    },

    async extend(id: number, expiresAt: Date, reason: string, ctx: ServiceContext): Promise<void> {
      await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const row = await lockCard(trx, id);
        if (new Date(row.expires_at).getTime() >= expiresAt.getTime()) {
          throw new OrderingError('VALIDATION_ERROR', 'expiresAt must move the expiry forward', {
            details: { expiresAt: row.expires_at },
          });
        }
        // Extending an expired card reactivates it at whatever balance remains.
        const status = row.status === 'expired' ? 'active' : row.status;
        await trx(CARD_TABLE)
          .where({ id })
          .update({ expires_at: expiresAt, status, updated_at: nowOf(ctx) });
        await appendLedger({
          cardId: id, kind: 'extend', amount: 0, balanceAfter: asInt(row.balance),
          actorRef: actorRefOf(ctx), reason, at: nowOf(ctx),
        });
      });
    },

    /** Signed balance correction — the gift-card.adjust permission guards the route. */
    async adjust(id: number, amount: number, reason: string, ctx: ServiceContext): Promise<void> {
      await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const row = await lockCard(trx, id);
        if (row.status === 'inactive') {
          throw new OrderingError(
            'VALIDATION_ERROR',
            'an unactivated card has no balance to adjust',
          );
        }
        await service.creditInTransaction(
          trx,
          { cardId: id, amount, kind: 'adjust', reason, actorRef: actorRefOf(ctx) },
          ctx,
        );
      });
    },

    /** Append-only ledger, oldest first — the admin detail pane reads this verbatim. */
    async entries(cardId: number): Promise<GiftCardLedgerRow[]> {
      return (await ledger().findMany({
        where: { card: cardId },
        orderBy: [{ at: 'asc' }, { id: 'asc' }],
        populate: { order: true, payment: true, refund: true },
      })) as unknown as GiftCardLedgerRow[];
    },

    /**
     * Expiry sweep for the `gift-card-expiry` job (O9 step 6): every active card past its
     * `expiresAt` becomes `expired` and its remaining balance is written off with an `expire`
     * ledger entry so `balance = Σ amount` keeps holding (balance lands on 0).
     */
    async expireDue(now: Date, limit: number): Promise<number> {
      const due = (await strapi.db
        .connection(CARD_TABLE)
        .select('id')
        .where('status', 'active')
        .where('expires_at', '<=', now)
        .orderBy('id')
        .limit(limit)) as Array<{ id: number }>;
      let count = 0;
      for (const { id } of due) {
        await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          const row = await lockCard(trx, id);
          if (row.status !== 'active' || new Date(row.expires_at).getTime() > now.getTime()) {
            return;
          }
          const balance = asInt(row.balance);
          await trx(CARD_TABLE)
            .where({ id })
            .update({ status: 'expired', balance: 0, updated_at: now });
          await appendLedger({
            cardId: id, kind: 'expire', amount: -balance, balanceAfter: 0,
            actorRef: 'job:gift-card-expiry', at: now,
          });
          count += 1;
        });
      }
      return count;
    },

    /**
     * Retention: a sealed plaintext code lives only `sealedCodeHours` after issue — or, for
     * unsold paper stock (`issued_at` still NULL), after the card row was created.
     */
    async purgeSealedCodes(olderThan: Date, limit: number): Promise<number> {
      return strapi.db
        .connection(CARD_TABLE)
        .whereNotNull('sealed_code')
        .where((where) =>
          where
            .where('issued_at', '<', olderThan)
            .orWhere((inner) => inner.whereNull('issued_at').where('created_at', '<', olderThan)),
        )
        .orderBy('id')
        .limit(limit)
        .update({ sealed_code: null });
    },

    /**
     * `fulfillment-group.transitioned` consumer (O9 plan step 3): when a `gift-card` group
     * reaches `issued` after payment capture, every live line unit becomes one card —
     * `source: 'sale'`, denomination = the line's unit amount. Idempotent by counting cards
     * already linked to a line inside a `FOR UPDATE` lock, so a redelivered event can only
     * finish a half-completed run, never double-issue. One `gift-card.issued` webhook event
     * rides the same transaction per new card; the recipient mail sends after commit, deduped
     * by the delivery log like every other template.
     */
    async onGroupIssued(event: OutboxEvent): Promise<void> {
      if (String(event.payload?.to ?? '') !== 'issued') return;
      if (String(event.payload?.workflowName ?? '') !== GIFT_CARD_WORKFLOW_NAME) return;
      const orderId = Number(event.payload.orderId);
      const groupId = Number(event.payload.groupId);
      if (!Number.isSafeInteger(orderId) || !Number.isSafeInteger(groupId)) return;

      const aggregate = await orderRepository({ strapi }).loadOrderAggregate(orderId);
      if (!aggregate) return;
      const group = aggregate.groups.find((item) => item.id === groupId);
      if (!group || group.workflowName !== GIFT_CARD_WORKFLOW_NAME || group.status !== 'issued') {
        return;
      }
      const receive = aggregate.order.receiveMethod as {
        kind?: string;
        recipientEmail?: string;
        recipientName?: string;
        message?: string;
        physicalCardIds?: number[];
      };
      if (receive.kind !== 'digital') return;
      const contactEmail =
        ((aggregate.order.contactSnapshot as { email?: string }).email ?? '').trim();
      const recipientEmail = (receive.recipientEmail ?? '').trim() || contactEmail;
      // Counter sale of preprinted stock: staff scanned the cards the customer takes home;
      // create resolved the scans to card ids (the codes are never stored on the order) and
      // those activate instead of minting, in line-id order — the order create checked.
      const physicalQueue = Array.isArray(receive.physicalCardIds)
        ? receive.physicalCardIds.map(Number).filter(Number.isSafeInteger)
        : [];
      const ctx: ServiceContext = { actor: { kind: 'system' } };

      const freshCodes = new Map<number, string>();
      let underfunded = false;
      await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        // Lock this group's lines so two dispatches of the same event can never double-issue.
        const { rows: locked } = (await trx.raw(
          `SELECT ol.id, ol.quantity, ol.canceled_quantity, ol.unit_amount, ol.option_amount,
                  ol.currency
             FROM plugins_ordering_order_line ol
             JOIN plugins_ordering_order_line_fulfillment_group_lnk lnk
               ON lnk.order_line_id = ol.id
            WHERE lnk.fulfillment_group_id = ?
            ORDER BY ol.id
              FOR UPDATE OF ol`,
          [groupId],
        )) as {
          rows: Array<{
            id: number;
            quantity: number;
            canceled_quantity: number;
            unit_amount: number | string;
            option_amount: number | string;
            currency: string;
          }>;
        };
        // Redelivery tolerance: a code whose card is already sold on THIS order was consumed by
        // a committed run — drop it now so leftover scans only ever hold unsold stock. A card
        // sold on a different order stays in the queue and fails the strict check below.
        while (physicalQueue.length > 0) {
          const stock = await service.findById(physicalQueue[0]);
          if (
            !stock ||
            stock.source !== 'batch' ||
            stock.status === 'inactive' ||
            stock.orderId !== orderId
          ) {
            break;
          }
          physicalQueue.shift();
        }
        // The value about to be handed over must be backed by money the order still holds. When
        // it is not, issuing would create cards the customer can spend against a refunded order:
        // nothing is issued, one alert opens, and staff settle that order by hand. The group stays
        // `issued` — a redelivered event is refused the same way until the money is back.
        const issueValue = locked.reduce(
          (sum, line) =>
            sum +
            (asInt(line.quantity) - asInt(line.canceled_quantity)) *
              (asInt(line.unit_amount) + asInt(line.option_amount)),
          0,
        );
        // A discounted sale pays less than the face value, so the bar is what the order was
        // supposed to collect (its payable total), never more than the face value being issued.
        const mustHold = Math.min(issueValue, payableTotal(aggregate.order));
        if (mustHold > 0 && (await heldForOrder(trx, orderId)) < mustHold) {
          underfunded = true;
          await alert().open(
            {
              alertCode: 'gift-card-underfunded',
              dedupeKey: `gift-card-underfunded:${orderId}`,
              severity: 'critical',
              locationRef: aggregate.order.locationRef,
              aggregateRef: `order:${orderId}`,
            },
            ctx,
          );
          return;
        }
        for (const line of locked) {
          const live = asInt(line.quantity) - asInt(line.canceled_quantity);
          if (live <= 0) continue;
          const existing = await cards().count({ where: { orderLine: line.id } });
          for (let i = existing; i < live; i += 1) {
            let cardId: number;
            let last4: string;
            const physical = physicalQueue.shift();
            const lineAmount = asInt(line.unit_amount) + asInt(line.option_amount);
            if (physical) {
              const stock = await service.findById(physical);
              if (!stock || stock.status !== 'inactive' || stock.source !== 'batch') {
                throw new OrderingError(
                  'GIFT_CARD_INVALID',
                  'a scanned card is not sellable stock',
                  { details: { orderId } },
                );
              }
              if (stock.initialAmount !== lineAmount) {
                throw new OrderingError(
                  'GIFT_CARD_INVALID',
                  'a scanned card does not match the sold denomination',
                  { details: { orderId, cardId: stock.id } },
                );
              }
              await service.activateInTransaction(
                trx,
                {
                  cardId: stock.id,
                  orderId,
                  reason: `order:${aggregate.order.code}`,
                  recipientEmail: recipientEmail || null,
                },
                ctx,
              );
              await cards().update({
                where: { id: stock.id },
                data: { order: orderId, orderLine: line.id },
              });
              cardId = stock.id;
              last4 = stock.last4;
            } else {
              const card = await service.issueInTransaction(
                trx,
                {
                  amount: lineAmount,
                  currency: line.currency,
                  source: 'sale',
                  orderId,
                  orderLineId: line.id,
                  recipientEmail: recipientEmail || null,
                  issuedBy: `order:${aggregate.order.code}`,
                },
                ctx,
              );
              cardId = card.id;
              last4 = card.last4;
              if (card.code) freshCodes.set(card.id, card.code);
            }
            // Webhook subscribers see one event per card; the consumer reads the card row,
            // so the event must ride this transaction — a crash before commit replays
            // cleanly because no card exists either.
            await outbox().enqueue(
              {
                type: 'gift-card.issued',
                aggregateType: 'gift-card',
                aggregateId: String(cardId),
                payload: {
                  orderId,
                  cardId,
                  last4,
                  amount: lineAmount,
                  currency: line.currency,
                  locationRef: aggregate.order.locationRef,
                },
                uniqueKey: `gift-card.issued:${cardId}`,
              },
              ctx,
            );
          }
        }
        if (physicalQueue.length > 0) {
          // More scanned cards than live units — the staff entry was wrong; fail so the
          // event retries loudly instead of silently dropping a sold card.
          throw new OrderingError('GIFT_CARD_INVALID', 'scanned more cards than the order sells', {
            details: { orderId, remaining: physicalQueue.length },
          });
        }
      });

      // Short of money: no cards were issued, so there is nothing to mail (the alert is the
      // signal). Waiting for the money to come back is the staff action, not a retry of this send.
      if (underfunded) return;
      // After commit: mail the codes we can reveal — fresh ones from this run, or the sealed
      // copies while retention holds. No recipient mailbox means a counter sale: staff hands
      // the codes over through the admin reveal instead.
      if (!recipientEmail) return;
      const rows = (await cards().findMany({
        where: { order: orderId },
        select: ['id', 'initialAmount', 'expiresAt'],
        orderBy: [{ id: 'asc' }],
      })) as Array<{ id: number; initialAmount: number | string; expiresAt: string }>;
      const mailCards: Array<{ code: string; amount: number }> = [];
      for (const row of rows) {
        const code = freshCodes.get(row.id) ?? (await service.revealCode(row.id));
        if (code) mailCards.push({ code, amount: asInt(row.initialAmount) });
      }
      if (mailCards.length === 0) {
        strapi.log.warn(
          `[ordering] gift-card order ${orderId} issued ${rows.length} card(s) but no code can be mailed`,
        );
        return;
      }
      await notifications().sendGiftCardIssued(event, {
        orderId,
        email: recipientEmail,
        recipientName: receive.recipientName,
        message: receive.message,
        cards: mailCards,
        // The order link carries the purchaser's token — only for the purchaser's own address.
        includeOrderLink: recipientEmail.toLowerCase() === contactEmail.toLowerCase(),
        expiresAt: rows[0]?.expiresAt ? String(rows[0].expiresAt) : undefined,
      });
    },

    /**
     * Cancel-terminal safety net (O9 step 4): refund gift-card money still held on the
     * order. Staff cancel already runs refundHeld; this covers payment expiry, customer
     * cancel, rejection and any close path that skipped it — and stays a no-op on replay
     * because the remaining held amount is re-read under the payment lock inside
     * createRefundInTransaction.
     */
    async onGroupClosed(event: OutboxEvent): Promise<void> {
      const payload = event.payload as {
        orderId?: number;
        to?: string;
        workflowName?: string;
        workflowVersion?: string;
        reason?: string;
      };
      if (!payload.orderId || !payload.to || !payload.workflowName || !payload.workflowVersion) {
        return;
      }
      const definition = registry().workflow(payload.workflowName, payload.workflowVersion);
      if (isTerminal(definition, payload.to) !== 'canceled') return;
      const orderId = payload.orderId;
      const ctx: ServiceContext = { actor: { kind: 'system' } };
      const aggregate = await orderRepository({ strapi }).loadOrderAggregate(orderId);
      const held = (aggregate?.payments ?? []).filter(
        (payment) => payment.providerCode === 'gift-card' && payment.capturedAmount - payment.refundedAmount > 0,
      );
      if (held.length === 0) return;
      await strapi.db.transaction(async ({ trx }) => {
        for (const payment of held) {
          try {
            await refund().createRefundInTransaction(
              trx,
              {
                paymentId: payment.id,
                amount: payment.capturedAmount - payment.refundedAmount,
                reason: payload.reason ? `gift-card.close:${payload.reason}` : 'gift-card.close',
                idempotencyKey: `gift-card-close:${orderId}:${payment.id}`,
              },
              ctx,
            );
          } catch (err) {
            // A replay racing refundHeld can observe a stale read: re-check the live row and
            // swallow REFUND_* when nothing is held any more — anything else must still fail.
            if (!(err instanceof OrderingError)) throw err;
            const live = (await trx('plugins_ordering_payment')
              .where('id', payment.id)
              .select('captured_amount', 'refunded_amount')
              .first()) as { captured_amount: string; refunded_amount: string } | undefined;
            if (!live || asInt(live.captured_amount) - asInt(live.refunded_amount) > 0) throw err;
          }
        }
      });
    },

    /** One-time reveal for staff resend/order screens — only while the seal survives. */
    async revealCode(id: number): Promise<string | null> {
      const row = (await cards().findOne({
        where: { id },
        select: ['sealedCode'],
      })) as { sealedCode: string | null } | null;
      return unseal(row?.sealedCode);
    },

    /** Plaintext recipient — for the resend mailer only; never leaves the service otherwise. */
    async revealRecipient(id: number): Promise<string | null> {
      const row = (await cards().findOne({
        where: { id },
        select: ['sealedRecipient'],
      })) as { sealedRecipient: string | null } | null;
      return unseal(row?.sealedRecipient);
    },
  };

  return service;
};

export type GiftCardService = ReturnType<typeof giftCard>;

export default giftCard;
