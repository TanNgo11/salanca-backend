import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { timingSafeEqual } from 'node:crypto';

import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { OrderingError, isOrderingError } from '../domain/errors';
import { paymentWindowStart } from '../domain/payments/deadline';
import { sha256Hex } from '../domain/hashing';
import type { PickupSettings } from '../domain/branch-settings';
import { asapReadyAt, bookingWindow, isOpenAt } from '../domain/scheduling/slots';
import { addDays, toLocalParts } from '../domain/scheduling/zoned-time';
import {
  customerCancellableNow,
  lookupOrderView,
  tokenOrderView,
} from '../domain/storefront/serialize';
import { isOnlinePaymentProvider } from '../providers/cash';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type orderServiceFactory from './order';
import type paymentLinkFactory from './payment-link';
import type paymentFactory from './payment';
import type pickupSchedulingFactory from './pickup-scheduling';
import type { OrderingRegistry } from './registry';
import type timelineFactory from './timeline';
import type transitionFactory from './transition';

/** `randomBytes(32).toString('base64url')` → 43 chars. Anything else is rejected before hashing. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Inclusive window the storefront may show: today and the 13 days after it. */
const SPECIAL_HORIZON_DAYS = 14;

const upcomingSpecialHours = (settings: PickupSettings, timezone: string, now: Date) => {
  const today = toLocalParts(now, timezone).date;
  const last = addDays(today, SPECIAL_HORIZON_DAYS - 1);
  return settings.schedule.businessDayPolicy.specialHours
    .filter((row) => row.date >= today && row.date <= last)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      closed: row.closed,
      ranges: row.ranges,
      ...(row.note ? { note: row.note } : {}),
    }));
};

const receiveConfig = (settings: PickupSettings, timezone: string, now: Date) => {
  const window = bookingWindow(settings, timezone, now);
  return {
    orderTiming: settings.orderTiming,
    leadTimeMinutes: settings.schedule.leadTimeMinutes,
    slotLengthMinutes: settings.schedule.slotLengthMinutes,
    maxAdvanceDays: settings.schedule.maxAdvanceDays,
    bookableFrom: window.today,
    bookableTo: window.lastDate,
    minOrderAmount: settings.minOrderAmount,
    paymentTiming: settings.paymentTiming,
    paymentMethods: settings.paymentProviders,
    customerCancelBeforeMinutes: settings.customerCancelBeforeMinutes,
    openNow: isOpenAt(settings, timezone, now),
    asapReadyAt:
      asapReadyAt(settings, timezone, now, settings.schedule.leadTimeMinutes)?.toISOString() ?? null,
    specialHours: upcomingSpecialHours(settings, timezone, now),
  };
};

/**
 * Customer-facing order access (contracts §11, §21). The order token is a bearer secret sent
 * only in `X-Order-Token`; the database keeps its SHA-256. Every view goes through the
 * allowlist serializers in `domain/storefront/serialize`.
 */
/**
 * A wallet return URL is kept only when it is https and on a configured storefront origin;
 * anything else (another site, userinfo tricks, too long) falls back to the server's own
 * return page.
 */
export const allowedReturnUrl = (value: unknown, origins: readonly string[]): string | undefined => {
  if (typeof value !== 'string' || value.length > 500) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
  const allowed = origins.some((origin) => {
    try {
      return new URL(origin).origin === url.origin;
    } catch {
      return false;
    }
  });
  return allowed ? url.toString() : undefined;
};

const storefront = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const orders = () => plugin().service('order') as ReturnType<typeof orderServiceFactory>;
  const scheduling = () =>
    plugin().service('pickup-scheduling') as ReturnType<typeof pickupSchedulingFactory>;
  const timeline = () => plugin().service('timeline') as ReturnType<typeof timelineFactory>;
  const transitions = () => plugin().service('transition') as ReturnType<typeof transitionFactory>;
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const links = () => plugin().service('payment-link') as ReturnType<typeof paymentLinkFactory>;
  const paymentService = () => plugin().service('payment') as ReturnType<typeof paymentFactory>;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const repo = orderRepository({ strapi });

  const resolveWorkflow = (name: string, version: string) => registry().workflow(name, version);

  const invalidToken = () =>
    new OrderingError('ORDER_TOKEN_INVALID', 'the order link is invalid or has expired');

  /** Customer cancel window for scheduled pickups: `customerCancelBeforeMinutes` before the slot. */
  const withinCancelWindow = async (aggregate: OrderAggregate, now: Date): Promise<boolean> => {
    const timing = (aggregate.order.receiveMethod as { timing?: { slot?: { startsAt?: string } } })
      .timing;
    const startsAt = timing?.slot?.startsAt;
    if (!startsAt) return true;
    const branch = await branches().findByCode(aggregate.order.locationRef);
    const receive = aggregate.order.receiveMethod as { kind?: string };
    const settings =
      receive.kind === 'delivery'
        ? branches().deliverySettings(branch ?? { fulfillment: null })
        : branches().pickupSettings(branch ?? { fulfillment: null });
    return now.getTime() <= new Date(startsAt).getTime() - settings.customerCancelBeforeMinutes * 60_000;
  };

  const service = {
    async aggregateByToken(token: unknown): Promise<OrderAggregate> {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalidToken();
      const row = (await strapi.db
        .query('plugin::ordering.order')
        .findOne({ where: { publicTokenHash: sha256Hex(token) }, select: ['id'] })) as {
        id: number;
      } | null;
      if (!row) throw invalidToken();
      const aggregate = await repo.loadOrderAggregate(row.id);
      if (!aggregate || aggregate.order.status === 'draft') throw invalidToken();
      return aggregate;
    },

    async viewByToken(token: unknown, ctx: ServiceContext) {
      const aggregate = await service.aggregateByToken(token);
      const events = (await timeline().listPublic(aggregate.order.id)) as Parameters<
        typeof tokenOrderView
      >[1];
      const branch = await branches().findByCode(aggregate.order.locationRef);
      return tokenOrderView(aggregate, events, resolveWorkflow, {
        cancellable: await withinCancelWindow(aggregate, nowOf(ctx)),
        branchContact: { phone: branch?.phone ?? null, address: branch?.address ?? null },
      });
    },

    /** GET /orders/payment — order token, or a staff payment link that opens only this page. */
    async paymentByToken(token: unknown) {
      let aggregate: OrderAggregate;
      try {
        aggregate = await service.aggregateByToken(token);
      } catch (error) {
        if (!isOrderingError(error) || error.code !== 'ORDER_TOKEN_INVALID') throw error;
        const orderId = await links().resolve(token, new Date());
        if (orderId === null) throw error;
        const loaded = await repo.loadOrderAggregate(orderId);
        if (!loaded || loaded.order.status === 'draft') throw invalidToken();
        aggregate = loaded;
      }
      const captured = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
      const due = Math.max(0, aggregate.order.totalAmount - captured);
      const receive = aggregate.order.receiveMethod as { kind?: string };
      const branch = await branches().findByCode(aggregate.order.locationRef);
      const settings =
        receive.kind === 'delivery'
          ? branches().deliverySettings(branch ?? { fulfillment: null })
          : branches().pickupSettings(branch ?? { fulfillment: null });
      const awaitingPayment = aggregate.groups.some((group) => group.status === 'awaiting-payment');
      let presentation: Record<string, unknown> | null = null;
      if (awaitingPayment && due > 0 && settings) {
        const online = settings.paymentProviders.find((code) => {
          if (!registry().hasPaymentProvider(code)) return false;
          return isOnlinePaymentProvider(registry().paymentProvider(code));
        });
        if (online) {
          const waiting = aggregate.groups.find((group) => group.status === 'awaiting-payment');
          const history = waiting
            ? ((await strapi.db.query('plugin::ordering.order-event').findMany({
                where: { order: aggregate.order.id, type: 'fulfillment-group.transitioned' },
              })) as Array<{ occurredAt: string; payload: { groupId?: unknown; to?: unknown } | null }>)
            : [];
          const start = waiting
            ? paymentWindowStart({
                placedAt: new Date(aggregate.order.placedAt),
                groupId: waiting.id,
                events: history.map((row) => ({ ...row, type: 'fulfillment-group.transitioned' })),
              })
            : new Date(aggregate.order.placedAt);
          const deadline = await links().effectiveDeadline(
            aggregate.order.id,
            start,
            settings.paymentTimeoutMinutes,
          );
          if (deadline.getTime() <= Date.now()) {
            presentation = null;
          } else {
            const expiresAt = deadline.toISOString();
            // O13: a pending wallet session for this provider is replayed so the payment page
            // shows the same payUrl/deeplink it issued earlier (no second session created).
            const pendingWallet = aggregate.payments.find(
              (payment) =>
                payment.providerCode === online &&
                payment.status === 'pending' &&
                payment.providerReference,
            );
            const built = await registry().paymentProvider(online).getPresentation({
              order: {
                code: aggregate.order.code,
                locationRef: aggregate.order.locationRef,
              } as never,
              amount: { amount: due, currency: aggregate.order.currency },
              metadata: {
                expiresAt,
                ...(pendingWallet?.session ? { session: pendingWallet.session } : {}),
              },
            });
            const redirect = (built as { redirectUrl?: string }).redirectUrl;
            presentation = built.memo || built.qr || redirect ? { ...built } : null;
          }
        }
      }
      return {
        code: aggregate.order.code,
        paymentStatus: aggregate.order.paymentStatus,
        currency: aggregate.order.currency,
        total: aggregate.order.totalAmount,
        due,
        paymentTiming: settings?.paymentTiming ?? null,
        methods: settings?.paymentProviders ?? [],
        presentation,
      };
    },

    /**
     * POST /payments/session (O13) — X-Order-Token (or a staff payment link). Starts a wallet
     * checkout for the unpaid remainder; an existing live session for the same amount is
     * returned unchanged. Never exposed: internal payment ids, provider secrets.
     */
    async paymentSessionByToken(
      token: unknown,
      input: { provider?: unknown; returnUrl?: unknown; ipAddr?: string },
      ctx: ServiceContext,
    ) {
      let aggregate: OrderAggregate;
      try {
        aggregate = await service.aggregateByToken(token);
      } catch (error) {
        if (!isOrderingError(error) || error.code !== 'ORDER_TOKEN_INVALID') throw error;
        const orderId = await links().resolve(token, new Date());
        if (orderId === null) throw error;
        const loaded = await repo.loadOrderAggregate(orderId);
        if (!loaded || loaded.order.status === 'draft') throw invalidToken();
        aggregate = loaded;
      }
      const providerCode = typeof input.provider === 'string' ? input.provider.trim() : '';
      if (
        !registry().hasPaymentProvider(providerCode) ||
        !registry().paymentProvider(providerCode).capabilities.includes('wallet')
      ) {
        throw new OrderingError('VALIDATION_ERROR', 'unknown wallet provider', {
          details: { field: 'provider' },
        });
      }
      const receive = aggregate.order.receiveMethod as { kind?: string };
      const branch = await branches().findByCode(aggregate.order.locationRef);
      const settings =
        receive.kind === 'delivery'
          ? branches().deliverySettings(branch ?? { fulfillment: null })
          : branches().pickupSettings(branch ?? { fulfillment: null });
      if (!settings.paymentProviders.includes(providerCode)) {
        throw new OrderingError('VALIDATION_ERROR', 'this branch does not offer that provider', {
          details: { field: 'provider' },
        });
      }
      const returnUrl = allowedReturnUrl(input.returnUrl, config().walletReturnOrigins);
      const { payment, session } = await paymentService().createWalletSession(
        { orderId: aggregate.order.id, providerCode, returnUrl, ipAddr: input.ipAddr },
        ctx,
      );
      return {
        provider: providerCode,
        reference: payment.providerReference,
        redirectUrl: typeof session.redirectUrl === 'string' ? session.redirectUrl : null,
        deeplink: typeof session.deeplink === 'string' ? session.deeplink : null,
        qrCodeUrl: typeof session.qrCodeUrl === 'string' ? session.qrCodeUrl : null,
      };
    },

    /**
     * GET /payments/return/:provider (O13) — the customer lands here after the wallet redirect.
     * Display only: resolves the session reference the provider echoed back and reports the
     * payment state. Money never moves off the return URL (IPN/query do that).
     */
    async paymentReturn(providerCode: string, query: Record<string, unknown>) {
      if (
        !registry().hasPaymentProvider(providerCode) ||
        !registry().paymentProvider(providerCode).capabilities.includes('wallet')
      ) {
        throw new OrderingError('PAYMENT_NOT_FOUND', 'unknown payment provider');
      }
      const text = (value: unknown): string =>
        typeof value === 'string' ? value.trim().slice(0, 120) : '';
      const reference =
        text(query.orderId) || text(query.vnp_TxnRef) || text(query.reference);
      if (reference === '') {
        throw new OrderingError('PAYMENT_NOT_FOUND', 'no payment reference in the return URL');
      }
      const payment = (await strapi.db.query('plugin::ordering.payment').findOne({
        where: { providerCode, providerReference: reference },
        populate: { order: { columns: ['id', 'code'] } },
      })) as { order?: { code: string }; status: string } | null;
      if (!payment?.order) {
        throw new OrderingError('PAYMENT_NOT_FOUND', 'no payment matches the return reference');
      }
      return {
        provider: providerCode,
        orderCode: payment.order.code,
        status: payment.status,
      };
    },

    async cancelByToken(token: unknown, reason: string | undefined, ctx: ServiceContext) {
      const aggregate = await service.aggregateByToken(token);
      if (!customerCancellableNow(aggregate, resolveWorkflow)) {
        throw new OrderingError('CANCEL_NOT_ALLOWED', 'this order can no longer be canceled online');
      }
      if (!(await withinCancelWindow(aggregate, nowOf(ctx)))) {
        throw new OrderingError('CANCEL_NOT_ALLOWED', 'it is too late to cancel online; call the branch');
      }
      try {
        await transitions().customerCancel(
          { orderId: aggregate.order.id, reason: reason?.trim() || 'customer-cancel' },
          { ...ctx, actor: { kind: 'customer', actorRef: `customer:${aggregate.order.code}` } },
        );
      } catch (error) {
        if (isOrderingError(error) && error.code === 'INVALID_TRANSITION') {
          throw new OrderingError('CANCEL_NOT_ALLOWED', 'this order can no longer be canceled online');
        }
        throw error;
      }
      return service.viewByToken(token, ctx);
    },

    /**
     * POST /orders/lookup (contracts §21.2): code + phone open a status-only view. A missing order,
     * a draft and a wrong phone all fail with the same ORDER_LOOKUP_FAILED after the same work
     * (a hash comparison against a dummy when there is no order), so codes cannot be probed.
     */
    async lookup(input: { code: string; phone: string }) {
      const failed = () => new OrderingError('ORDER_LOOKUP_FAILED', 'no order matches this code and phone');
      const phone = normalizeVietnamesePhone(input.phone);
      const code = input.code.trim().toUpperCase();
      const row = /^[A-Z0-9-]{1,40}$/.test(code)
        ? ((await strapi.db
            .query('plugin::ordering.order')
            .findOne({ where: { code }, select: ['id', 'status', 'contactSnapshot'] })) as {
            id: number;
            status: string;
            contactSnapshot: { phone?: string };
          } | null)
        : null;
      const expected = Buffer.from(sha256Hex(row?.contactSnapshot?.phone ?? 'no-order'), 'hex');
      const given = Buffer.from(sha256Hex(phone.valid ? phone.e164 : 'invalid-phone'), 'hex');
      const matches = timingSafeEqual(expected, given);
      if (!row || row.status === 'draft' || !phone.valid || !matches) throw failed();
      const aggregate = await repo.loadOrderAggregate(row.id);
      if (!aggregate) throw failed();
      const events = (await timeline().listPublic(row.id)) as Parameters<typeof lookupOrderView>[1];
      return lookupOrderView(aggregate, events);
    },

    /** GET /config — what the storefront needs to render checkout for one branch. */
    async config(branchCode: string | undefined, ctx: ServiceContext) {
      const cfg = config();
      const base = {
        currency: cfg.currency,
        consentPolicyVersion: cfg.consent.policyVersion,
        captcha: cfg.storefront.captchaProvider ? { provider: cfg.storefront.captchaProvider } : null,
      };
      if (!branchCode) return { ...base, branch: null };
      const branch = await branches().findByCode(branchCode);
      if (!branch || !branch.isActive || !branch.onlineOrdering) {
        throw new OrderingError('LOCATION_UNAVAILABLE', 'this branch does not take online orders', {
          details: { locationRef: branchCode },
        });
      }
      const pickup = branches().pickupSettings(branch);
      const delivery = branches().deliverySettings(branch);
      const now = nowOf(ctx);
      return {
        ...base,
        branch: {
          code: branch.code,
          timezone: branch.timezone,
          pickup: pickup.enabled ? receiveConfig(pickup, branch.timezone, now) : null,
          ...(delivery.enabled ? { delivery: receiveConfig(delivery, branch.timezone, now) } : {}),
        },
      };
    },

    /** GET /slots — branch lead time only; quote/create re-check with line lead times. */
    async slots(branchCode: string, date: string, ctx: ServiceContext) {
      const branch = await branches().findByCode(branchCode);
      if (!branch || !branch.isActive || !branch.onlineOrdering) {
        throw new OrderingError('LOCATION_UNAVAILABLE', 'this branch does not take online orders', {
          details: { locationRef: branchCode },
        });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new OrderingError('VALIDATION_ERROR', 'date must be YYYY-MM-DD', {
          details: { field: 'date' },
        });
      }
      const pickup = branches().pickupSettings(branch);
      if (!pickup.enabled || pickup.orderTiming === 'asap') return { items: [] };
      const slots = await scheduling().listSlots({
        branch,
        settings: pickup,
        date,
        leadTimeMinutes: pickup.schedule.leadTimeMinutes,
        now: nowOf(ctx),
      });
      return {
        items: slots.map((slot) => ({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          localStart: slot.localStart,
          available: slot.available,
          ...(slot.reason ? { reason: slot.reason } : {}),
        })),
      };
    },

    orders,
  };
  return service;
};

export default storefront;
