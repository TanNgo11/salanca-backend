import { randomInt } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { buildCsv } from '../domain/csv';
import { OrderingError } from '../domain/errors';
import { normalizeGiftCardCode } from '../domain/gift-cards/code';
import { maskEmail } from '../domain/pii';
import type { TransactionClient } from '../migrations/runner';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type { GiftCardRow, GiftCardService } from './gift-card';

/**
 * Staff side of gift cards (O9 plan step 5, screens G1–G3), gated by `gift-card.manage` —
 * balance adjustment additionally needs `gift-card.adjust`. No card code ever crosses this
 * surface: lists and details carry `last4` only, the full code leaves the server once in the
 * complimentary-issue response and once inside a batch CSV (the printing hand-off). Every
 * mutation writes its ledger entry inside `gift-card` and an append-only change-log row here.
 */
const CARD_UID = 'plugin::ordering.gift-card';
const BATCH_UID = 'plugin::ordering.gift-card-batch';
const CARD_TABLE = 'plugins_ordering_gift_card';
const LEDGER_TABLE = 'plugins_ordering_gift_card_ledger';
const CARD_ORDER_LNK = 'plugins_ordering_gift_card_order_lnk';
const CARD_BATCH_LNK = 'plugins_ordering_gift_card_batch_lnk';
const LEDGER_ORDER_LNK = 'plugins_ordering_gift_card_ledger_order_lnk';

const PAGE_SIZE = 20;
const MAX_MESSAGE = 300;
const MAX_REASON = 500;

export const CARD_TABS = ['active', 'blocked', 'expired', 'zero', 'all'] as const;
export type CardTab = (typeof CARD_TABS)[number];

export const SOURCE_FILTERS = ['sold', 'manual'] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requiredReason = (value: unknown, field = 'reason'): string => {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason || reason.length > MAX_REASON) {
    throw new OrderingError('VALIDATION_ERROR', 'a reason is required (1–500 characters)', {
      details: { field },
    });
  }
  return reason;
};

const optionalEmail = (value: unknown, field: string): string | undefined => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return undefined;
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} is not a valid address`, {
      details: { field },
    });
  }
  return email;
};

const positiveAmount = (value: unknown, field: string, max?: number): number => {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || (max !== undefined && amount > max)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be a positive integer`, {
      details: { field, max },
    });
  }
  return amount;
};

const batchCode = (): string => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i += 1) tail += alphabet[randomInt(alphabet.length)];
  const now = new Date();
  const day = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `LOT-${day}-${tail}`;
};

const giftCardAdmin = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const plugin = () => strapi.plugin('ordering');
  const knex = () => strapi.db.connection;
  const cards = () => strapi.db.query(CARD_UID);
  const batches = () => strapi.db.query(BATCH_UID);
  const giftCard = () => plugin().service('gift-card') as GiftCardService;
  const changeLog = () =>
    plugin().service('change-log') as ReturnType<typeof changeLogFactory>;
  const notifications = () =>
    plugin().service('notification') as {
      sendGiftCardManual(input: {
        dedupeKey: string;
        email: string;
        recipientName?: string;
        message?: string;
        cards: Array<{ code: string; amount: number }>;
        expiresAt?: string;
        locationRef?: string | null;
        locale?: string;
      }): Promise<void>;
    };

  type MappedCard = ReturnType<GiftCardService['mapCard']>;

  const view = (card: MappedCard) => ({
    id: card.id,
    masked: `•••• ${card.last4}`,
    last4: card.last4,
    initialAmount: card.initialAmount,
    balance: card.balance,
    currency: card.currency,
    status: card.status,
    source: card.source,
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
    soldAt: card.soldAt,
    orderId: card.orderId,
    orderCode: card.orderCode,
    batchId: card.batchId,
    batchCode: card.batchCode,
  });

  /** Row with order+batch populated — `findById` deliberately fetches relations lazily. */
  const load = async (id: number): Promise<GiftCardRow> => {
    const row = (await cards().findOne({
      where: { id },
      populate: {
        order: { select: ['id', 'code'] },
        orderLine: { select: ['id'] },
        batch: { select: ['id', 'code'] },
      },
    })) as GiftCardRow | null;
    if (!row) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
    return row;
  };

  const maskedRecipientOf = async (id: number): Promise<string | null> =>
    maskEmail(await giftCard().revealRecipient(id));

  const requireReason = (body: Record<string, unknown>) => requiredReason(body.reason);

  /** Shared issue loop for generate + import — everything rides the caller's transaction. */
  const issueBatchInTransaction = async (
    trx: TransactionClient,
    input: {
      batchId: number;
      denomination: number;
      codes: Array<string | undefined>;
      ctx: ServiceContext;
    },
  ): Promise<string[]> => {
    const codes: string[] = [];
    for (const candidate of input.codes) {
      const issued = await giftCard().issueInTransaction(
        trx,
        {
          amount: input.denomination,
          source: 'batch',
          batchId: input.batchId,
          sealCode: true,
          ...(candidate ? { code: candidate } : {}),
          issuedBy: actorRefOf(input.ctx),
        },
        input.ctx,
      );
      codes.push(candidate ? candidate : (issued.code as string));
    }
    return codes;
  };

  const record = async (
    action: string,
    entityType: 'gift-card' | 'gift-card-batch',
    entityId: number,
    entityLabel: string,
    input: {
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      locationRef?: string;
      orderId?: number | null;
    },
    ctx: ServiceContext,
  ) =>
    changeLog().record(
      {
        action,
        entityType,
        entityId,
        entityLabel,
        ...(input.locationRef ? { locationRef: input.locationRef } : {}),
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
      },
      ctx,
    );

  const service = {
    /**
     * GET /gift-cards (G1): `q` is a 4-char tail or an order code — a full code is hashed
     * server-side too so staff may paste one, but the GET contract keeps it out of URLs by
     * pointing staff at POST /gift-cards/search instead. `sold` = sold cards (sale source or
     * an activated batch card); `manual` = complimentary. Unsold batch stock lives in Batches.
     */
    async list(
      query: { q?: string; status?: string; source?: string; page?: number },
      ctx: ServiceContext,
    ) {
      const now = nowOf(ctx);
      const tab = (query.status ?? 'active') as CardTab;
      if (!CARD_TABS.includes(tab)) {
        throw new OrderingError('VALIDATION_ERROR', 'status must be a card tab', {
          details: { field: 'status' },
        });
      }
      const source = query.source as SourceFilter | undefined;
      if (source !== undefined && !SOURCE_FILTERS.includes(source)) {
        throw new OrderingError('VALIDATION_ERROR', 'source must be sold or manual', {
          details: { field: 'source' },
        });
      }
      const builder = knex().from(`${CARD_TABLE} as c`).select('c.id');
      if (tab === 'zero') builder.where('c.balance', 0);
      else if (tab !== 'all') builder.where('c.status', tab);
      if (source === 'manual') builder.where('c.source', 'manual');
      if (source === 'sold') {
        builder.where((where) =>
          where
            .where('c.source', 'sale')
            .orWhere((inner) =>
              inner.where('c.source', 'batch').whereNot('c.status', 'inactive'),
            ),
        );
      }
      const q = query.q?.trim();
      if (q) {
        const normalizedCode = normalizeGiftCardCode(q);
        const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        builder.where((where) => {
          where.where('c.last_4', q.toUpperCase()).orWhereExists(
            knex()
              .from(`${CARD_ORDER_LNK} as lnk`)
              .join('plugins_ordering_order as o', 'o.id', 'lnk.order_id')
              .whereRaw('lnk.gift_card_id = c.id')
              .whereRaw('o.code ILIKE ?', [like]),
          );
          // A pasted full code resolves by HMAC too — same hit as the POST search body.
          if (normalizedCode) {
            where.orWhere('c.code_hash', giftCard().codeHashOf(normalizedCode));
          }
        });
      }
      const ids = ((await builder.orderBy('c.id', 'desc')) as Array<{ id: number }>).map(
        (row) => row.id,
      );
      const page = Math.max(1, query.page ?? 1);
      const pageIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const rows = (await cards().findMany({
        where: { id: { $in: pageIds } },
        populate: {
          order: { select: ['id', 'code'] },
          batch: { select: ['id', 'code'] },
        },
      })) as GiftCardRow[];
      const byId = new Map(rows.map((row) => [row.id, row]));
      // G1 summary: outstanding circulation = Σ balance of live cards; this month's sales =
      // issue/activate entries tied to an order; this month's usage = Σ redeem.
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [outstanding] = (await knex()
        .from(CARD_TABLE)
        .where('status', 'active')
        .select(knex().raw('coalesce(sum(balance), 0) as total'))) as Array<{ total: string }>;
      const monthSums = (await knex()
        .from(`${LEDGER_TABLE} as l`)
        .leftJoin(`${LEDGER_ORDER_LNK} as lo`, 'lo.gift_card_ledger_id', 'l.id')
        .where('l.at', '>=', monthStart)
        .whereIn('l.kind', ['issue', 'activate', 'redeem'])
        .select('l.kind')
        .select(knex().raw('coalesce(sum(l.amount) filter (where lo.order_id is not null), 0) as sold'))
        .select(knex().raw("coalesce(-sum(l.amount) filter (where l.kind = 'redeem'), 0) as redeemed"))
        .groupBy('l.kind')) as Array<{ kind: string; sold: string; redeemed: string }>;
      const summary = {
        outstandingBalance: Number(outstanding?.total ?? 0),
        soldThisMonth: monthSums.reduce((sum, row) => sum + (row.kind === 'redeem' ? 0 : Number(row.sold)), 0),
        redeemedThisMonth: monthSums.reduce((sum, row) => sum + Number(row.redeemed), 0),
      };
      return {
        items: pageIds
          .map((id) => byId.get(id))
          .filter((row): row is GiftCardRow => Boolean(row))
          .map((row) => view(giftCard().mapCard(row))),
        total: ids.length,
        page,
        pageSize: PAGE_SIZE,
        summary,
      };
    },

    /** POST /gift-cards/search — full code rides the body, never the URL (screens G1). */
    async searchByCode(rawCode: unknown, ctx: ServiceContext) {
      const normalized = normalizeGiftCardCode(rawCode);
      const card = normalized ? await giftCard().findByCode(normalized) : null;
      if (!card) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      return service.detail(card.id, ctx);
    },

    /** GET /gift-cards/:id (G2): card + masked recipient + append-only ledger, newest first. */
    async detail(id: number, _ctx: ServiceContext) {
      const row = await load(id);
      const card = giftCard().mapCard(row);
      const ledger = (await giftCard().entries(id)).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amount: typeof entry.amount === 'number' ? entry.amount : Number(entry.amount),
        balanceAfter:
          typeof entry.balanceAfter === 'number' ? entry.balanceAfter : Number(entry.balanceAfter),
        orderId:
          typeof entry.order === 'object' && entry.order
            ? entry.order.id
            : ((entry.order as number | null) ?? null),
        orderCode:
          typeof entry.order === 'object' && entry.order ? (entry.order.code ?? null) : null,
        paymentId:
          typeof entry.payment === 'object' && entry.payment
            ? entry.payment.id
            : ((entry.payment as number | null) ?? null),
        refundId:
          typeof entry.refund === 'object' && entry.refund
            ? entry.refund.id
            : ((entry.refund as number | null) ?? null),
        actorRef: entry.actorRef,
        reason: entry.reason,
        at: entry.at,
      }));
      return {
        ...view(card),
        recipientMasked: await maskedRecipientOf(id),
        note: card.note,
        issuedBy: card.issuedBy,
        orderLineId: card.orderLineId,
        ledger: [...ledger].reverse(),
      };
    },

    /**
     * POST /gift-cards (G3): complimentary issue. The plaintext code is returned ONCE — after
     * this response only `last4` exists anywhere. With a recipient the code goes by mail
     * instead: staff see the masked address, never the code… except when no mailbox was given,
     * so the response still carries it for the print/hand-over flow.
     */
    async create(body: Record<string, unknown>, ctx: ServiceContext) {
      const amount = positiveAmount(body.amount, 'amount', 1_000_000_000);
      const reason = requireReason(body);
      const recipientEmail = optionalEmail(body.recipientEmail, 'recipientEmail');
      const message =
        typeof body.message === 'string' && body.message.trim() !== ''
          ? body.message.trim().slice(0, MAX_MESSAGE)
          : undefined;
      const recipientName =
        typeof body.recipientName === 'string' && body.recipientName.trim() !== ''
          ? body.recipientName.trim().slice(0, 100)
          : undefined;
      const locationRef = typeof body.locationRef === 'string' ? body.locationRef : undefined;
      const expiresAt =
        typeof body.expiresAt === 'string' && body.expiresAt.trim() !== ''
          ? new Date(body.expiresAt)
          : undefined;
      if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= nowOf(ctx).getTime())) {
        throw new OrderingError('VALIDATION_ERROR', 'expiresAt must be in the future', {
          details: { field: 'expiresAt' },
        });
      }
      const issued = await strapi.db.transaction(async ({ trx }) =>
        giftCard().issueInTransaction(
          trx,
          {
            amount,
            source: 'manual',
            sealCode: true,
            ...(expiresAt ? { expiresAt } : {}),
            recipientEmail: recipientEmail ?? null,
            issuedBy: actorRefOf(ctx),
            note: reason,
          },
          ctx,
        ),
      );
      const masked = `•••• ${issued.last4}`;
      let emailSent = false;
      if (recipientEmail && issued.code) {
        try {
          await notifications().sendGiftCardManual({
            dedupeKey: `gift-card.issue:${issued.id}`,
            email: recipientEmail,
            ...(recipientName ? { recipientName } : {}),
            ...(message ? { message } : {}),
            cards: [{ code: issued.code, amount }],
            locationRef: locationRef ?? null,
          });
          emailSent = true;
        } catch {
          emailSent = false; // the delivery log keeps the failure for a resend
        }
      }
      await record(
        'gift-card.issue',
        'gift-card',
        issued.id,
        masked,
        {
          after: {
            amount,
            source: 'manual',
            reason,
            ...(recipientEmail ? { mailbox: maskEmail(recipientEmail) } : {}),
          },
          ...(locationRef ? { locationRef } : {}),
        },
        ctx,
      );
      return {
        card: {
          id: issued.id,
          masked,
          last4: issued.last4,
          initialAmount: amount,
          balance: amount,
          status: 'active',
          source: 'manual',
          expiresAt: issued.expiresAt.toISOString(),
        },
        // The code leaves the server exactly once: in this response when nobody could receive
        // it by mail, or inside the mail itself — a mailed card shows staff the masked address
        // and nothing else (screens G3).
        code: emailSent ? null : issued.code,
        emailSent,
        recipientMasked: maskEmail(recipientEmail ?? null),
      };
    },

    async block(id: number, body: Record<string, unknown>, ctx: ServiceContext) {
      const reason = requireReason(body);
      const before = await giftCard().findById(id);
      if (!before) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      await giftCard().block(id, reason, ctx);
      await record(
        'gift-card.block',
        'gift-card',
        id,
        `•••• ${before.last4}`,
        { before: { status: before.status }, after: { status: 'blocked', reason } },
        ctx,
      );
      return { ok: true };
    },

    async unblock(id: number, body: Record<string, unknown>, ctx: ServiceContext) {
      const reason = requireReason(body);
      const before = await giftCard().findById(id);
      if (!before) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      await giftCard().unblock(id, reason, ctx);
      await record(
        'gift-card.unblock',
        'gift-card',
        id,
        `•••• ${before.last4}`,
        { before: { status: before.status }, after: { reason } },
        ctx,
      );
      return { ok: true };
    },

    async extend(id: number, body: Record<string, unknown>, ctx: ServiceContext) {
      const reason = requireReason(body);
      const expiresAt = new Date(String(body.expiresAt ?? ''));
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new OrderingError('VALIDATION_ERROR', 'expiresAt must be a date', {
          details: { field: 'expiresAt' },
        });
      }
      const before = await giftCard().findById(id);
      if (!before) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      await giftCard().extend(id, expiresAt, reason, ctx);
      await record(
        'gift-card.extend',
        'gift-card',
        id,
        `•••• ${before.last4}`,
        { before: { expiresAt: before.expiresAt }, after: { expiresAt: expiresAt.toISOString(), reason } },
        ctx,
      );
      return { ok: true };
    },

    /** `gift-card.adjust` — the route binds the tighter action; the signed ± writes `adjust`. */
    async adjust(id: number, body: Record<string, unknown>, ctx: ServiceContext) {
      const reason = requireReason(body);
      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'amount must be a non-zero integer', {
          details: { field: 'amount' },
        });
      }
      const before = await giftCard().findById(id);
      if (!before) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      if (before.balance + amount < 0) {
        throw new OrderingError('VALIDATION_ERROR', 'the adjustment would make the balance negative', {
          details: { field: 'amount', balance: before.balance },
        });
      }
      await giftCard().adjust(id, amount, reason, ctx);
      await record(
        'gift-card.adjust',
        'gift-card',
        id,
        `•••• ${before.last4}`,
        { before: { balance: before.balance }, after: { balance: before.balance + amount, reason } },
        ctx,
      );
      return { balance: before.balance + amount };
    },

    /**
     * POST /gift-cards/:id/resend — mails the sealed code to the ORIGINAL recipient only;
     * staff never see the code. Works while the seal survives (24h retention, step 6 job).
     */
    async resend(id: number, ctx: ServiceContext) {
      const card = await giftCard().findById(id);
      if (!card) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'gift card not found');
      const [email, code] = await Promise.all([
        giftCard().revealRecipient(id),
        giftCard().revealCode(id),
      ]);
      if (!email) {
        throw new OrderingError('VALIDATION_ERROR', 'this card has no recipient on file');
      }
      if (!code) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          'the code is no longer recoverable — issue a replacement card instead',
        );
      }
      // One delivery row per deliberate resend — the counter makes each dedupe key unique.
      const sent = (await strapi.db.query('plugin::ordering.notification-delivery').count({
        where: { eventId: { $startsWith: `gift-card.resend:${id}:` } },
      })) as number;
      await notifications().sendGiftCardManual({
        dedupeKey: `gift-card.resend:${id}:${sent + 1}`,
        email,
        cards: [{ code, amount: card.initialAmount }],
        expiresAt: card.expiresAt,
      });
      await record(
        'gift-card.resend',
        'gift-card',
        id,
        `•••• ${card.last4}`,
        { after: { mailbox: maskEmail(email), resend: sent + 1 } },
        ctx,
      );
      return { ok: true, recipientMasked: maskEmail(email) };
    },

    // ── Physical preprinted batches (decisions 2026-10-13) ────────────────────────────

    async listBatches(query: { page?: number }) {
      const page = Math.max(1, query.page ?? 1);
      const total = (await batches().count({})) as number;
      const rows = (await batches().findMany({
        orderBy: [{ id: 'desc' }],
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      })) as Array<{
        id: number;
        code: string;
        source: string;
        denominationAmount: string | number;
        currency: string;
        quantity: number;
        note: string | null;
        createdByRef: string | null;
        createdAt: string;
      }>;
      const counts = new Map<number, { total: number; live: number }>();
      if (rows.length > 0) {
        const stats = (await knex()
          .from(`${CARD_BATCH_LNK} as lnk`)
          .join(`${CARD_TABLE} as c`, 'c.id', 'lnk.gift_card_id')
          .whereIn(
            'lnk.gift_card_batch_id',
            rows.map((row) => row.id),
          )
          .groupBy('lnk.gift_card_batch_id')
          .select('lnk.gift_card_batch_id')
          .select(knex().raw('count(*)::int as total'))
          .select(
            knex().raw("count(*) filter (where c.status != 'inactive')::int as live"),
          )) as Array<{ gift_card_batch_id: number; total: number; live: number }>;
        for (const stat of stats) {
          counts.set(Number(stat.gift_card_batch_id), {
            total: Number(stat.total),
            live: Number(stat.live),
          });
        }
      }
      return {
        items: rows.map((row) => {
          const stat = counts.get(row.id) ?? { total: 0, live: 0 };
          return {
            id: row.id,
            code: row.code,
            source: row.source,
            denominationAmount: Number(row.denominationAmount),
            currency: row.currency,
            quantity: row.quantity,
            note: row.note,
            createdBy: row.createdByRef,
            createdAt: row.createdAt,
            cards: stat.total,
            sold: stat.live,
            remaining: stat.total - stat.live,
          };
        }),
        total,
        page,
        pageSize: PAGE_SIZE,
      };
    },

    async batchDetail(id: number, query: { page?: number }) {
      const batch = (await batches().findOne({ where: { id } })) as {
        id: number;
        code: string;
        source: string;
        denominationAmount: string | number;
        currency: string;
        quantity: number;
        note: string | null;
        createdByRef: string | null;
        createdAt: string;
      } | null;
      if (!batch) throw new OrderingError('GIFT_CARD_NOT_FOUND', 'batch not found');
      const page = Math.max(1, query.page ?? 1);
      const ids = ((await knex()
        .from(`${CARD_BATCH_LNK} as lnk`)
        .join(`${CARD_TABLE} as c`, 'c.id', 'lnk.gift_card_id')
        .where('lnk.gift_card_batch_id', id)
        .orderBy('c.id', 'asc')
        .select('c.id')) as Array<{ id: number }>).map((row) => row.id);
      const pageIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const rows = (await cards().findMany({
        where: { id: { $in: pageIds } },
        populate: { order: { select: ['id', 'code'] } },
      })) as GiftCardRow[];
      const byId = new Map(rows.map((row) => [row.id, row]));
      return {
        batch: {
          id: batch.id,
          code: batch.code,
          source: batch.source,
          denominationAmount: Number(batch.denominationAmount),
          currency: batch.currency,
          quantity: batch.quantity,
          note: batch.note,
          createdBy: batch.createdByRef,
          createdAt: batch.createdAt,
        },
        items: pageIds
          .map((cardId) => byId.get(cardId))
          .filter((row): row is GiftCardRow => Boolean(row))
          .map((row) => view(giftCard().mapCard(row))),
        total: ids.length,
        page,
        pageSize: PAGE_SIZE,
      };
    },

    /**
     * POST /gift-card-batches — generate `count` codes for printing. The plaintext list is
     * returned ONCE (and stays exportable while the seal survives, 24h); the change log
     * records count + batch code only.
     */
    async createBatch(body: Record<string, unknown>, ctx: ServiceContext) {
      const limits = config().giftCards.physicalBatches;
      if (!limits.enabled) {
        throw new OrderingError('VALIDATION_ERROR', 'physical batches are disabled');
      }
      const denomination = positiveAmount(body.denomination, 'denomination', limits.maxDenominationAmount);
      const count = positiveAmount(body.count, 'count', limits.maxBatchQuantity);
      const note =
        typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 500) : null;
      const locationRef = typeof body.locationRef === 'string' ? body.locationRef : undefined;
      const { batch, codes } = await strapi.db.transaction(async ({ trx }) => {
        const created = (await batches().create({
          data: {
            code: batchCode(),
            source: 'generated',
            denominationAmount: denomination,
            currency: 'VND',
            quantity: count,
            note,
            createdByRef: actorRefOf(ctx),
          },
        })) as { id: number; code: string };
        const issued = await issueBatchInTransaction(trx, {
          batchId: created.id,
          denomination,
          codes: Array<string | undefined>(count).fill(undefined),
          ctx,
        });
        return { batch: created, codes: issued };
      });
      await record(
        'gift-card-batch.create',
        'gift-card-batch',
        batch.id,
        batch.code,
        {
          after: { source: 'generated', quantity: count, denominationAmount: denomination, note },
          ...(locationRef ? { locationRef } : {}),
        },
        ctx,
      );
      return { batch: { id: batch.id, code: batch.code, quantity: count }, codes };
    },

    /**
     * POST /gift-card-batches/import — preprinted codes from the printer's CSV. All-or-
     * nothing inside one transaction: any malformed or duplicate line fails the import with
     * its row number; the error names last4 only, never the submitted code.
     */
    async importBatch(body: Record<string, unknown>, ctx: ServiceContext) {
      const limits = config().giftCards.physicalBatches;
      if (!limits.enabled) {
        throw new OrderingError('VALIDATION_ERROR', 'physical batches are disabled');
      }
      const denomination = positiveAmount(body.denomination, 'denomination', limits.maxDenominationAmount);
      const rawCodes = Array.isArray(body.codes) ? body.codes : [];
      if (rawCodes.length === 0 || rawCodes.length > limits.maxBatchQuantity) {
        throw new OrderingError('VALIDATION_ERROR', 'codes must hold 1–maxBatchQuantity lines', {
          details: { field: 'codes', max: limits.maxBatchQuantity },
        });
      }
      const codes: string[] = [];
      const seen = new Set<string>();
      rawCodes.forEach((value, index) => {
        const normalized = normalizeGiftCardCode(value);
        if (!normalized) {
          throw new OrderingError('VALIDATION_ERROR', `line ${index + 1}: code is malformed`, {
            details: { field: 'codes', line: index + 1 },
          });
        }
        if (seen.has(normalized)) {
          throw new OrderingError('VALIDATION_ERROR', `line ${index + 1}: code is duplicated in this import`, {
            details: { field: 'codes', line: index + 1, last4: normalized.slice(-4) },
          });
        }
        seen.add(normalized);
        codes.push(normalized);
      });
      const note =
        typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 500) : null;
      const locationRef = typeof body.locationRef === 'string' ? body.locationRef : undefined;
      const batch = await strapi.db.transaction(async ({ trx }) => {
        const created = (await batches().create({
          data: {
            code: batchCode(),
            source: 'imported',
            denominationAmount: denomination,
            currency: 'VND',
            quantity: codes.length,
            note,
            createdByRef: actorRefOf(ctx),
          },
        })) as { id: number; code: string };
        try {
          await issueBatchInTransaction(trx, {
            batchId: created.id,
            denomination,
            codes,
            ctx,
          });
        } catch (error) {
          if (error instanceof OrderingError && error.code === 'VALIDATION_ERROR') {
            throw new OrderingError('VALIDATION_ERROR', 'a code is already on file', {
              details: { field: 'codes' },
            });
          }
          throw error;
        }
        return created;
      });
      await record(
        'gift-card-batch.import',
        'gift-card-batch',
        batch.id,
        batch.code,
        {
          after: { source: 'imported', quantity: codes.length, denominationAmount: denomination, note },
          ...(locationRef ? { locationRef } : {}),
        },
        ctx,
      );
      return { batch: { id: batch.id, code: batch.code }, imported: codes.length };
    },

    /** GET /gift-card-batches/:id/export — plaintext codes while the seal survives (24h). */
    async exportBatch(id: number, ctx: ServiceContext) {
      const { batch } = await service.batchDetail(id, { page: 1 });
      const cardsOf = (await cards().findMany({
        where: { batch: id },
        orderBy: [{ id: 'asc' }],
        select: ['id', 'last4', 'status', 'balance'],
      })) as Array<{ id: number; last4: string; status: string; balance: string | number }>;
      const rows: string[][] = [];
      for (const card of cardsOf) {
        const code = await giftCard().revealCode(card.id);
        rows.push([
          code ?? '',
          card.last4,
          card.status,
          String(Number(card.balance)),
        ]);
      }
      await record(
        'gift-card-batch.export',
        'gift-card-batch',
        id,
        batch.code,
        { after: { rows: rows.length } },
        ctx,
      );
      return {
        csv: buildCsv(
          ['Mã thẻ', '4 số cuối', 'Trạng thái', 'Số dư'],
          rows,
        ),
        fileName: `lo-the-${batch.code}.csv`,
      };
    },
  };

  return service;
};

export type GiftCardAdminService = ReturnType<typeof giftCardAdmin>;

export default giftCardAdmin;
