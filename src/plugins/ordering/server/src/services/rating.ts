import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import type { LocationScope } from '../domain/scope';
import orderRepository from '../repositories/order';
import type alertFactory from './alert';
import type alertRulesFactory from './alert-rules';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type orderingSettingsFactory from './ordering-settings';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import type storefrontFactory from './storefront';

/**
 * Order ratings (O8 steps 7–8). One rating per completed order, reached with the order token:
 * open for `ratingWindowDays` after completion, editable for `ratingEditHours` after the first
 * submit. `stars ≤ low-rating threshold` opens a per-order alert for the branch. Comments are
 * customer text — they never reach logs, alerts or webhooks, and retention clears them after
 * `ratingCommentDays`.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PAGE_SIZE = 50;
const MAX_COMMENT = 1000;
const MAX_TAGS = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Report and list day boundaries are Vietnam days, like the branch business day. */
const DAY_OFFSET = '+07:00';

type RatingRow = {
  id: number;
  orderId: number;
  locationRef: string;
  stars: number;
  tags: unknown;
  comment: string | null;
  messageLocale: string;
  status: 'visible' | 'hidden';
  staffNote: string | null;
  staffNoteBy: string | null;
  ratedAt: string | Date;
  editableUntil: string | Date;
  updatedAt?: string | Date;
};

type OrderBrief = {
  id: number;
  code: string;
  status: string;
  locationRef: string;
  placedLocale: string | null;
  completedAt: string | Date | null;
};

const iso = (value: string | Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const tagsOf = (value: unknown): string[] => {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.filter((tag): tag is string => typeof tag === 'string') : [];
};

const dayStart = (day: string, field: string): Date => {
  if (!DATE_PATTERN.test(day)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, { details: { field } });
  }
  return new Date(`${day}T00:00:00${DAY_OFFSET}`);
};

export type RatingSummary = { average: number | null; count: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> };

const summarize = (stars: number[]): RatingSummary => {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RatingSummary['distribution'];
  for (const value of stars) {
    if (value >= 1 && value <= 5) distribution[value as 1 | 2 | 3 | 4 | 5] += 1;
  }
  const count = stars.length;
  const average = count > 0 ? Math.round((stars.reduce((sum, value) => sum + value, 0) / count) * 10) / 10 : null;
  return { average, count, distribution };
};

const rating = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const rows = () => strapi.db.query('plugin::ordering.order-rating');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const settings = () => plugin().service('ordering-settings') as ReturnType<typeof orderingSettingsFactory>;
  const storefront = () => plugin().service('storefront') as ReturnType<typeof storefrontFactory>;
  const scope = () => plugin().service('scope') as ReturnType<typeof scopeFactory>;
  const alert = () => plugin().service('alert') as ReturnType<typeof alertFactory>;
  const alertRules = () => plugin().service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const changeLog = () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>;
  const outbox = () => plugin().service('outbox') as ReturnType<typeof outboxFactory>;
  const repo = orderRepository({ strapi });

  const orderBrief = async (orderId: number): Promise<OrderBrief | null> =>
    (await orders().findOne({
      where: { id: orderId },
      select: ['id', 'code', 'status', 'locationRef', 'placedLocale', 'completedAt'],
    })) as OrderBrief | null;

  const ratingOf = async (orderId: number): Promise<RatingRow | null> =>
    (await rows().findOne({ where: { orderId } })) as RatingRow | null;

  const publicRating = (row: RatingRow, now: Date) => ({
    stars: row.stars,
    tags: tagsOf(row.tags),
    comment: row.comment,
    ratedAt: iso(row.ratedAt),
    editableUntil: iso(row.editableUntil),
    editable: now.getTime() <= new Date(row.editableUntil).getTime(),
  });

  /** Why a new rating cannot be left, or null. An existing rating is governed by `editableUntil`. */
  const unavailableReason = (
    order: OrderBrief,
    windowDays: number,
    now: Date,
  ): 'not-completed' | 'window-closed' | null => {
    if (order.status !== 'completed' || !order.completedAt) return 'not-completed';
    const closesAt = new Date(order.completedAt).getTime() + windowDays * DAY_MS;
    return now.getTime() > closesAt ? 'window-closed' : null;
  };

  const tagsFor = (
    configured: Awaited<ReturnType<ReturnType<typeof orderingSettingsFactory>['get']>>['ratingTags'],
    locale: string,
  ) =>
    configured.map((tag) => ({
      code: tag.code,
      label: tag.label[locale] ?? tag.label.vi ?? tag.code,
      sentiment: tag.sentiment,
    }));

  const staffLocations = async (ctx: ServiceContext): Promise<{ scope: LocationScope; locations: string[] | null }> => {
    const staffScope = await scope().loadScope(ctx);
    if (staffScope === null) {
      throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    }
    return { scope: staffScope, locations: staffScope.allLocations ? null : [...staffScope.locationRefs] };
  };

  /** Out of scope and missing answer the same 404. */
  const scopedRow = async (id: number, ctx: ServiceContext): Promise<RatingRow> => {
    const row = (await rows().findOne({ where: { id } })) as RatingRow | null;
    const { scope: staffScope } = await staffLocations(ctx);
    if (!row || !scopeIncludes(staffScope, row.locationRef)) {
      throw new OrderingError('RATING_NOT_FOUND', 'rating not found');
    }
    return row;
  };

  const staffView = (row: RatingRow, code: string | undefined) => ({
    id: row.id,
    orderId: row.orderId,
    orderCode: code ?? null,
    locationRef: row.locationRef,
    stars: row.stars,
    tags: tagsOf(row.tags),
    comment: row.comment,
    locale: row.messageLocale,
    status: row.status,
    staffNote: row.staffNote,
    staffNoteBy: row.staffNoteBy,
    ratedAt: iso(row.ratedAt),
    updatedAt: iso(row.updatedAt ?? null),
  });

  const service = {
    /**
     * Called once when an order turns `completed`: stamps `completedAt` (the rating window
     * starts here) and schedules the invite email after `ratingInviteDelayMinutes`.
     */
    async onOrderCompleted(orderId: number, ctx: ServiceContext): Promise<void> {
      const now = nowOf(ctx);
      await orders().update({ where: { id: orderId }, data: { completedAt: now } });
      const current = await settings().get();
      if (!current.ratingInviteEnabled) return;
      const order = (await orders().findOne({
        where: { id: orderId },
        select: ['id', 'contactSnapshot'],
      })) as { id: number; contactSnapshot: unknown } | null;
      const email = (order?.contactSnapshot as { email?: unknown } | null)?.email;
      if (typeof email !== 'string' || !email.includes('@')) return;
      await outbox().enqueue(
        {
          type: 'rating.invite',
          aggregateType: 'order',
          aggregateId: String(orderId),
          payload: { orderId },
          uniqueKey: `rating.invite:${orderId}`,
          availableAt: new Date(now.getTime() + current.ratingInviteDelayMinutes * 60_000),
        },
        ctx,
      );
    },

    /** GET /orders/rating — X-Order-Token. */
    async viewByToken(token: unknown, ctx: ServiceContext) {
      const aggregate = await storefront().aggregateByToken(token);
      const now = nowOf(ctx);
      const current = await settings().get();
      const order = await orderBrief(aggregate.order.id);
      if (!order) throw new OrderingError('ORDER_TOKEN_INVALID', 'order token is not valid');
      const locale = order.placedLocale === 'en' ? 'en' : 'vi';
      const existing = await ratingOf(order.id);
      const reason = existing ? null : unavailableReason(order, current.ratingWindowDays, now);
      return {
        rateable: existing ? publicRating(existing, now).editable : reason === null,
        ...(reason ? { reason } : {}),
        tags: tagsFor(current.ratingTags, locale),
        rating: existing ? publicRating(existing, now) : null,
      };
    },

    /** POST /orders/rating — `{ stars, tags?, comment? }` + X-Order-Token. */
    async submitByToken(token: unknown, body: unknown, ctx: ServiceContext) {
      const aggregate = await storefront().aggregateByToken(token);
      const input = (body ?? {}) as { stars?: unknown; tags?: unknown; comment?: unknown };
      const stars = input.stars;
      if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
        throw new OrderingError('VALIDATION_ERROR', 'stars must be an integer 1-5', {
          details: { field: 'stars' },
        });
      }
      const current = await settings().get();
      const known = new Set(current.ratingTags.map((tag) => tag.code));
      const tags = input.tags === undefined ? [] : input.tags;
      if (
        !Array.isArray(tags) ||
        tags.length > MAX_TAGS ||
        tags.some((tag) => typeof tag !== 'string' || !known.has(tag))
      ) {
        throw new OrderingError('VALIDATION_ERROR', 'tags must be configured tag codes', {
          details: { field: 'tags' },
        });
      }
      const comment =
        input.comment === undefined || input.comment === null ? '' : input.comment;
      if (typeof comment !== 'string' || comment.length > MAX_COMMENT) {
        throw new OrderingError('VALIDATION_ERROR', `comment must be at most ${MAX_COMMENT} characters`, {
          details: { field: 'comment', max: MAX_COMMENT },
        });
      }
      const now = nowOf(ctx);
      const order = await orderBrief(aggregate.order.id);
      if (!order) throw new OrderingError('ORDER_TOKEN_INVALID', 'order token is not valid');
      const data = {
        stars,
        tags: [...new Set(tags as string[])],
        comment: comment.trim() === '' ? null : comment.trim(),
      };

      const save = async (): Promise<{ row: RatingRow; previousStars: number | null }> => {
        const existing = await ratingOf(order.id);
        if (existing) {
          if (now.getTime() > new Date(existing.editableUntil).getTime()) {
            throw new OrderingError('RATING_LOCKED', 'the rating can no longer be changed');
          }
          const row = (await rows().update({ where: { id: existing.id }, data })) as RatingRow;
          return { row, previousStars: existing.stars };
        }
        const reason = unavailableReason(order, current.ratingWindowDays, now);
        if (reason) {
          throw new OrderingError('RATING_NOT_AVAILABLE', 'the order cannot be rated', {
            details: { reason },
          });
        }
        const row = (await rows().create({
          data: {
            ...data,
            orderId: order.id,
            locationRef: order.locationRef,
            messageLocale: order.placedLocale === 'en' ? 'en' : 'vi',
            status: 'visible',
            ratedAt: now,
            editableUntil: new Date(now.getTime() + current.ratingEditHours * HOUR_MS),
          },
        })) as RatingRow;
        return { row, previousStars: null };
      };

      let saved: { row: RatingRow; previousStars: number | null };
      try {
        saved = await save();
      } catch (error) {
        // Two first submits raced: the unique order index let one in; the other becomes an edit.
        const code = (error as { code?: string; cause?: { code?: string } }).code ??
          (error as { cause?: { code?: string } }).cause?.code;
        if (code !== '23505') throw error;
        saved = await save();
      }

      const rule = await alertRules().ruleOf('low-rating');
      // A new low rating, or an edit that changes the stars into the low band (3 → 1), opens it;
      // resubmitting the same stars does not bump the alert again.
      if (stars <= rule.threshold && saved.previousStars !== stars) {
        await alert().open(
          {
            alertCode: 'low-rating',
            dedupeKey: `low-rating:${order.id}`,
            severity: 'warning',
            aggregateRef: `order:${order.id}`,
            locationRef: order.locationRef,
          },
          ctx,
        );
      }
      strapi.log.info(`[ordering] rating saved order=${order.id} stars=${stars}`);
      return { rating: publicRating(saved.row, now) };
    },

    /** GET /ratings — `order.read`, scoped to the staff member's branches. */
    async listForStaff(
      query: {
        branch?: string;
        stars?: string;
        from?: string;
        to?: string;
        hasComment?: string;
        status?: string;
        page?: number;
      },
      ctx: ServiceContext,
    ) {
      const { scope: staffScope, locations } = await staffLocations(ctx);
      const where: Record<string, unknown>[] = [];
      if (query.branch) {
        if (!scopeIncludes(staffScope, query.branch)) {
          throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found');
        }
        where.push({ locationRef: query.branch });
      } else if (locations !== null) {
        where.push({ locationRef: { $in: locations } });
      }
      if (query.stars) {
        const stars = query.stars
          .split(',')
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
        if (stars.length > 0) where.push({ stars: { $in: stars } });
      }
      if (query.from) where.push({ ratedAt: { $gte: dayStart(query.from, 'from') } });
      if (query.to) {
        where.push({ ratedAt: { $lt: new Date(dayStart(query.to, 'to').getTime() + DAY_MS) } });
      }
      if (query.hasComment === 'true') where.push({ comment: { $notNull: true } });
      if (query.status === 'visible' || query.status === 'hidden') where.push({ status: query.status });
      const filter = where.length > 0 ? { $and: where } : {};
      const page = query.page ?? 1;
      const [items, all] = await Promise.all([
        rows().findMany({
          where: filter,
          orderBy: [{ ratedAt: 'desc' }, { id: 'desc' }],
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        }) as Promise<RatingRow[]>,
        rows().findMany({ where: filter, select: ['stars', 'status'] }) as Promise<Array<{ stars: number; status: string }>>,
      ]);
      const codes = new Map(
        (
          (await orders().findMany({
            where: { id: { $in: items.map((row) => row.orderId) } },
            select: ['id', 'code'],
          })) as Array<{ id: number; code: string }>
        ).map((row) => [row.id, row.code]),
      );
      return {
        // Hidden ratings stay listed for staff but leave the average (spam, abuse, test orders).
        summary: summarize(all.filter((row) => row.status !== 'hidden').map((row) => row.stars)),
        items: items.map((row) => staffView(row, codes.get(row.orderId))),
        pagination: { page, pageSize: PAGE_SIZE, total: all.length },
      };
    },

    /** GET /ratings/:id — R2 detail with the order summary. */
    async detail(id: number, ctx: ServiceContext) {
      const row = await scopedRow(id, ctx);
      const aggregate = await repo.loadOrderAggregate(row.orderId);
      const legs = (await strapi.db.query('plugin::ordering.fulfillment').findMany({
        where: { order: row.orderId },
        select: ['assigneeRef'],
      })) as Array<{ assigneeRef: string | null }>;
      const delivery = legs.find((leg) => leg.assigneeRef);
      return {
        rating: staffView(row, aggregate?.order.code),
        order: aggregate
          ? {
              id: aggregate.order.id,
              code: aggregate.order.code,
              total: aggregate.order.totalAmount,
              items: aggregate.lines
                .map((line) => ({ title: line.titleSnapshot, quantity: line.quantity - line.canceledQuantity }))
                .filter((line) => line.quantity > 0),
              courierRef: delivery?.assigneeRef ?? null,
            }
          : null,
      };
    },

    /** The S4 block: the rating of one order, when the staff member can read the order. */
    async forOrder(orderId: number) {
      const row = await ratingOf(orderId);
      return row ? staffView(row, undefined) : null;
    },

    /** POST /ratings/:id/hide — `{ hidden }`; `rating.manage`. */
    async setHidden(id: number, hidden: boolean, ctx: ServiceContext) {
      const row = await scopedRow(id, ctx);
      const status = hidden ? 'hidden' : 'visible';
      if (row.status === status) return { rating: staffView(row, undefined) };
      const updated = (await rows().update({ where: { id }, data: { status } })) as RatingRow;
      const order = await orderBrief(row.orderId);
      await changeLog().record(
        {
          action: 'rating.hide',
          entityType: 'order-rating',
          entityId: id,
          locationRef: row.locationRef,
          entityLabel: order?.code ?? null,
          orderId: row.orderId,
          before: { status: row.status },
          after: { status },
        },
        ctx,
      );
      return { rating: staffView(updated, order?.code) };
    },

    /** POST /ratings/:id/note — `{ note }`; internal only, never sent to the customer. */
    async setNote(id: number, note: unknown, ctx: ServiceContext) {
      if (note !== null && (typeof note !== 'string' || note.length > MAX_COMMENT)) {
        throw new OrderingError('VALIDATION_ERROR', `note must be at most ${MAX_COMMENT} characters`, {
          details: { field: 'note', max: MAX_COMMENT },
        });
      }
      const row = await scopedRow(id, ctx);
      const staffNote = typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
      const updated = (await rows().update({
        where: { id },
        data: { staffNote, staffNoteBy: staffNote ? (ctx.actor.kind === 'staff' ? ctx.actor.actorRef : null) : null },
      })) as RatingRow;
      const order = await orderBrief(row.orderId);
      // The note text is staff-written but may quote the customer: log only that it changed.
      await changeLog().record(
        {
          action: 'rating.note',
          entityType: 'order-rating',
          entityId: id,
          locationRef: row.locationRef,
          entityLabel: order?.code ?? null,
          orderId: row.orderId,
          before: { hasNote: row.staffNote !== null },
          after: { hasNote: staffNote !== null },
        },
        ctx,
      );
      return { rating: staffView(updated, order?.code) };
    },

    /** Report card: visible ratings of orders whose business date falls in the range. */
    async summaryFor(from: string, to: string, locations: string[] | null): Promise<RatingSummary> {
      const knex = strapi.db.connection;
      const query = knex('plugins_ordering_order_rating as r')
        .join('plugins_ordering_order as o', 'o.id', 'r.order_id')
        .whereBetween('o.business_date', [from, to])
        .whereNot('r.status', 'hidden');
      if (locations !== null) query.whereIn('o.location_ref', locations);
      const found = (await query.select('r.stars')) as Array<{ stars: number }>;
      return summarize(found.map((row) => Number(row.stars)));
    },
  };
  return service;
};

export default rating;
