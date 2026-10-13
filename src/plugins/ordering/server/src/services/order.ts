import { randomBytes, randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type {
  AdapterContext,
  AddressSnapshot,
  FulfillmentGroup,
  JsonObject,
  Order,
  ReceiveMethod,
  SelectedOptionInput,
  Sellable,
} from '../contracts';
import { businessDate } from '../domain/business-date';
import {
  dailyStockKey,
  receiveBusinessDate,
  soldOutDetails,
  stockTargetsForLine,
  sumStockTargets,
  type StockLineInput,
  type StockTarget,
} from '../domain/daily-stock-lines';
import { bundleComponentsFromSellable } from '../domain/catalog/bundle-components';
import { OrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import { amountFromDb, sumAmounts } from '../domain/money';
import { formatOrderCode } from '../domain/order-code';
import { projectPaymentStatus } from '../domain/payment-status';
import { appliesCashRounding, type CashRoundingPolicy } from '../domain/pricing/cash-rounding';
import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { DeliverySettings, PickupSettings } from '../domain/branch-settings';
import { snapshotDeliveryAddress, type DeliveryAddressInput } from '../domain/contact/address';
import { quoteDelivery } from '../domain/delivery/zones';
import { describeSelectedOptions } from '../domain/storefront/serialize';
import { priceCart, type PricingAdjustmentInput } from '../domain/pricing/pipeline';
import { scopeIncludes } from '../domain/scope';
import {
  projectFulfillmentStatus,
  projectOrderStatus,
  type GroupProjectionInput,
} from '../domain/workflow/projection';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type { ServiceContext } from './context';
import { priceChannelOf } from '../domain/catalog/price-selection';
import { sellableForLine } from '../providers/ordering-catalog/adapter';
import { actorRefOf, nowOf } from './context';
import type adminUnitsFactory from './admin-units';
import type branchFactory from './branch';
import type customerFactory from './customer';
import type dailyStockFactory from './daily-stock';
import type holdFactory from './hold';
import type pickupSchedulingFactory from './pickup-scheduling';
import type { PickupTiming, PickupTimingInput } from './pickup-scheduling';
import type idempotencyFactory from './idempotency';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import type timelineFactory from './timeline';
import type { OrderingRegistry } from './registry';

export type CreateOrderLineInput = {
  sellableUid: string;
  quantity: number;
  selected?: SelectedOptionInput[];
  note?: string;
  variantUid?: string;
};

export type CreateOrderInput = {
  idempotencyKey: string;
  locationRef: string;
  locale?: string;
  lines: CreateOrderLineInput[];
  receiveMethod: ReceiveMethod;
  contact: { name?: string; phone: string; email?: string };
  consent: {
    policyVersion: string;
    channel: 'web-checkout' | 'phone-staff';
    marketingOptIn?: boolean;
    acceptedAt?: string;
  };
  customerNote?: string;
  adjustments?: PricingAdjustmentInput[];
  fulfillmentAmount?: number;
  expectedCartHash?: string;
  payment?: { providerCode: string };
  origin: { kind: 'storefront' | 'staff-draft' | 'import'; actorRef?: string };
  holds?: Array<{ lineIndex: number; resourceRef: string; quantity: number; expiresAt: string }>;
  placedAt?: string;
  /**
   * O11: internal customer id resolved from `X-Customer-Token` (storefront create passes it;
   * staff drafts never do). The session customer wins; when absent the order links by
   * `contact.phone` (E.164) so guest orders attach to a matching profile.
   */
  customerId?: number;
  /**
   * Requested pickup time (`{ asap: true }` or `{ slot: { startsAt } }`). O3 storefront and staff
   * callers always pass it, which turns on the branch receive rules (enabled, payment method,
   * minimum order, lead time, slot capacity). Service callers without it (imports, O1 fixtures)
   * skip those rules.
   */
  pickup?: PickupTimingInput;
  /** Customer-entered code. The server decides whether it applies. */
  promotionCode?: string;
};

export type OrderDraftInput = Omit<CreateOrderInput, 'idempotencyKey'>;

type PricedLine = {
  sellable: Sellable;
  key: string;
  quantity: number;
  unitAmount: number;
  optionAmount: number;
  taxGroupRef?: string;
  workflow: { name: string; version: string };
  leadTimeMinutes: number;
};

export type DeliveryQuote = {
  fee: number;
  zoneCode: string;
  extraLeadTimeMinutes: number;
  freeFrom: number | null;
};

export type PreparedOrder = {
  branch: BranchRow;
  pickupSettings: PickupSettings | null;
  deliverySettings: DeliverySettings | null;
  delivery: DeliveryQuote | null;
  /** Catalog names at quote time. Create stores this object and does not read the client names again. */
  deliveryAddress: AddressSnapshot | null;
  priced: PricedLine[];
  pricing: ReturnType<typeof priceCart>;
  groupsByWorkflow: Map<string, { name: string; version: string }>;
  placedAt: Date;
  locale: string;
  providerCode?: string;
  timing: PickupTiming | null;
  promotions: import('./promotion').ResolvedPromotions;
  /**
   * O8: the cart priced without phone-history promotions — what the public quote shows and what
   * `expectedCartHash` is checked against. `pricing` adds the history-dependent ones for create.
   */
  quotePricing: ReturnType<typeof priceCart>;
};

/** Stored on order/group `receiveMethod.timing`; UTC instants. */
export const timingSnapshot = (timing: PickupTiming | null) =>
  timing === null
    ? null
    : timing.mode === 'asap'
      ? { mode: 'asap' as const, requestedReadyAt: timing.readyAt.toISOString() }
      : {
          mode: 'scheduled' as const,
          slot: { startsAt: timing.slot.startsAt, endsAt: timing.slot.endsAt },
          requestedReadyAt: timing.readyAt.toISOString(),
        };

export type CreateOrderResult = {
  order: OrderAggregate;
  publicToken: string | null;
  replayed: boolean;
};

export type ProjectionChange = {
  before: { status: string; paymentStatus: string; fulfillmentStatus: string };
  after: { status: string; paymentStatus: string; fulfillmentStatus: string };
};

type Services = {
  registry: OrderingRegistry;
  scope: ReturnType<typeof scopeFactory>;
  idempotency: ReturnType<typeof idempotencyFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  hold: ReturnType<typeof holdFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  branch: ReturnType<typeof branchFactory>;
  scheduling: ReturnType<typeof pickupSchedulingFactory>;
  customer: ReturnType<typeof customerFactory>;
  dailyStock: ReturnType<typeof dailyStockFactory>;
};

type BranchRow = {
  id: number;
  code: string;
  name: unknown;
  timezone: string;
  isActive: boolean;
  onlineOrdering: boolean;
  fulfillment: JsonObject | null;
  tax: Partial<OrderingConfig['tax']> | null;
  cashRounding: CashRoundingPolicy | null;
  orderingPause: unknown;
  busyMode: unknown;
  fees: unknown;
};

const MAX_CUSTOMER_NOTE = 500;

const orderService = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      scope: plugin.service('scope') as Services['scope'],
      idempotency: plugin.service('idempotency') as Services['idempotency'],
      timeline: plugin.service('timeline') as Services['timeline'],
      hold: plugin.service('hold') as Services['hold'],
      outbox: plugin.service('outbox') as Services['outbox'],
      branch: plugin.service('branch') as Services['branch'],
      scheduling: plugin.service('pickup-scheduling') as Services['scheduling'],
      customer: plugin.service('customer') as Services['customer'],
      dailyStock: plugin.service('daily-stock') as Services['dailyStock'],
    };
  };
  const cutoffFromFulfillment = (fulfillment: unknown, kind: string): string => {
    const root = fulfillment && typeof fulfillment === 'object' ? (fulfillment as JsonObject) : {};
    const method = root[kind] as JsonObject | undefined;
    const policy = (method?.schedule as JsonObject | undefined)?.businessDayPolicy as
      | JsonObject
      | undefined;
    const cutoff = policy?.cutoffLocalTime;
    return typeof cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)
      ? cutoff
      : config().businessDay.cutoffLocalTime;
  };
  const stockDateFor = (
    branch: BranchRow,
    kind: string,
    placedAt: Date,
    timing: PickupTiming | null,
  ): string =>
    receiveBusinessDate({
      placedAt,
      timezone: branch.timezone,
      cutoff: cutoffFromFulfillment(branch.fulfillment, kind),
      slotStartsAt: timing?.mode === 'scheduled' ? timing.slot.startsAt : null,
    });
  const lineTargets = (line: StockLineInput): StockTarget[] => stockTargetsForLine(line);
  const assertDailyStock = async (prepared: PreparedOrder, input: OrderDraftInput) => {
    const date = stockDateFor(
      prepared.branch,
      input.receiveMethod.kind,
      prepared.placedAt,
      prepared.timing,
    );
    const targets = sumStockTargets(
      prepared.priced.flatMap((line, index) =>
        lineTargets({
          sellableUid: line.sellable.ref.uid,
          sourceDocumentId: line.sellable.ref.sourceDocumentId,
          variantUid: input.lines[index]?.variantUid ?? line.sellable.variant?.uid ?? null,
          selected: input.lines[index]?.selected ?? [],
          quantity: line.quantity,
        }),
      ),
    );
    if (targets.length === 0) return;
    const left = await services().dailyStock.remaining(
      prepared.branch.code,
      date,
      targets.map((target) => ({
        entityType: target.entityType,
        entityDocumentId: target.entityDocumentId,
      })),
    );
    for (const target of [...targets].sort((a, b) =>
      dailyStockKey(a.entityType, a.entityDocumentId).localeCompare(
        dailyStockKey(b.entityType, b.entityDocumentId),
      ),
    )) {
      const row = left.get(dailyStockKey(target.entityType, target.entityDocumentId));
      if (!row || target.quantity <= row.remaining) continue;
      throw new OrderingError('ITEM_SOLD_OUT', 'sold out for the business day', {
        details: soldOutDetails(target, row.remaining, date, prepared.branch.code),
      });
    }
  };
  const reserveDailyStock = async (
    trx: TransactionClient,
    prepared: PreparedOrder,
    input: OrderDraftInput,
    orderId: number,
    lineIds: Map<string, number>,
  ) => {
    // A staff draft stays unlimited until confirmDraft. The reserve runs inside this
    // transaction, so a sold-out upsert rolls the new order back.
    if (input.origin.kind === 'staff-draft') return;
    const date = stockDateFor(
      prepared.branch,
      input.receiveMethod.kind,
      prepared.placedAt,
      prepared.timing,
    );
    const items = prepared.priced.flatMap((line, index) => {
      const lineId = lineIds.get(line.key);
      if (!lineId) return [];
      return lineTargets({
        sellableUid: line.sellable.ref.uid,
        sourceDocumentId: line.sellable.ref.sourceDocumentId,
        variantUid: input.lines[index]?.variantUid ?? line.sellable.variant?.uid ?? null,
        selected: input.lines[index]?.selected ?? [],
        quantity: line.quantity,
      }).map((target) => ({
        entityType: target.entityType,
        entityDocumentId: target.entityDocumentId,
        quantity: target.quantity,
        lineId,
        sellableUid: target.sellableUid,
        ...(target.variantUid ? { variantUid: target.variantUid } : {}),
        ...(target.modifierUid ? { modifierUid: target.modifierUid } : {}),
      }));
    });
    if (items.length === 0) return;
    await services().dailyStock.reserveInTransaction(trx, {
      orderId,
      locationRef: prepared.branch.code,
      businessDate: date,
      items,
    });
  };
  const reserveConfirmedDraft = async (
    trx: TransactionClient,
    orderId: number,
    order: { locationRef: string; businessDate: unknown; receiveMethod: Record<string, unknown> },
  ) => {
    const branch = await services().branch.findByCode(order.locationRef);
    const timezone = branch?.timezone ?? 'Asia/Ho_Chi_Minh';
    const receive = order.receiveMethod as {
      kind?: string;
      timing?: { mode?: string; slot?: { startsAt?: string } };
    };
    const kind = receive.kind === 'delivery' ? 'delivery' : 'pickup';
    const cutoff = cutoffFromFulfillment(branch?.fulfillment, kind);
    const slotStartsAt = receive.timing?.mode === 'scheduled' ? receive.timing.slot?.startsAt ?? null : null;
    const date = slotStartsAt
      ? receiveBusinessDate({ placedAt: new Date(), timezone, cutoff, slotStartsAt })
      : String(order.businessDate).slice(0, 10);
    const rows = (await strapi.db.query('plugin::ordering.order-line').findMany({
      where: { order: orderId },
    })) as Array<{
      id: number;
      sellableUid: string;
      sourceDocumentId: string | null;
      variantUid: string | null;
      selectedOptionsSnapshot: unknown;
      quantity: number;
      canceledQuantity: number;
    }>;
    const items = rows.flatMap((line) => {
      const live = line.quantity - (line.canceledQuantity ?? 0);
      if (live <= 0) return [];
      const selected = Array.isArray(line.selectedOptionsSnapshot)
        ? (line.selectedOptionsSnapshot as StockLineInput['selected'])
        : [];
      return lineTargets({
        sellableUid: line.sellableUid,
        sourceDocumentId: line.sourceDocumentId,
        variantUid: line.variantUid,
        selected,
        quantity: live,
      }).map((target) => ({
        entityType: target.entityType,
        entityDocumentId: target.entityDocumentId,
        quantity: target.quantity,
        lineId: line.id,
        sellableUid: target.sellableUid,
        ...(target.variantUid ? { variantUid: target.variantUid } : {}),
        ...(target.modifierUid ? { modifierUid: target.modifierUid } : {}),
      }));
    });
    if (items.length === 0) return;
    await services().dailyStock.reserveInTransaction(trx, {
      orderId,
      locationRef: order.locationRef,
      businessDate: date,
      items,
    });
  };
  const repo = orderRepository({ strapi });
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const requireDeliveryAddress = (address: DeliveryAddressInput): AddressSnapshot => {
    const units = strapi.plugin('ordering').service('admin-units') as ReturnType<typeof adminUnitsFactory>;
    const resolved = snapshotDeliveryAddress(address, units.catalog());
    if (!resolved.ok) {
      throw new OrderingError('VALIDATION_ERROR', resolved.message, {
        details: { field: resolved.field, reason: resolved.reason },
      });
    }
    return resolved.address;
  };

  const service = {
    /**
     * Recomputes the three order-level statuses from the group's workflow states and the
     * payment ledger, persists them when they changed, and returns the before/after so the
     * caller can emit `order.transitioned` on real transitions only.
     */
    async recomputeProjection(orderId: number): Promise<ProjectionChange> {
      const { registry } = services();
      const groups = (await strapi.db
        .query('plugin::ordering.fulfillment-group')
        .findMany({ where: { order: orderId } })) as Array<{
        status: string;
        workflowName: string;
        workflowVersion: string;
      }>;
      const groupInputs: GroupProjectionInput[] = groups.map((group) => {
        const definition = registry.workflow(group.workflowName, group.workflowVersion);
        return {
          status: group.status,
          initial: definition.initial,
          terminal: isTerminal(definition, group.status),
        };
      });
      const payments = (await strapi.db
        .query('plugin::ordering.payment')
        .findMany({ where: { order: orderId } })) as Array<{
        capturedAmount: string | number;
        refundedAmount: string | number;
      }>;
      const order = await repo.findOrderById(orderId);
      if (!order) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found', {
          details: { orderId },
        });
      }
      const capturedAmount = sumAmounts(
        payments.map((payment) => amountFromDb(payment.capturedAmount)),
      );
      const refundedAmount = sumAmounts(
        payments.map((payment) => amountFromDb(payment.refundedAmount)),
      );
      const totalAmount = order.totalAmount;
      const fulfillmentStatus = projectFulfillmentStatus(groupInputs);
      const paymentStatus = projectPaymentStatus({ totalAmount, capturedAmount, refundedAmount });
      const status = projectOrderStatus({
        originKind: order.origin.kind,
        draftConfirmed: order.draftConfirmedAt !== null,
        groups: groupInputs,
        totalAmount,
        capturedAmount,
      });
      const before = {
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
      };
      const after = { status, paymentStatus, fulfillmentStatus };
      if (
        before.status !== after.status ||
        before.paymentStatus !== after.paymentStatus ||
        before.fulfillmentStatus !== after.fulfillmentStatus
      ) {
        await repo.updateOrder(orderId, {
          status: after.status,
          paymentStatus: after.paymentStatus,
          fulfillmentStatus: after.fulfillmentStatus,
        });
      }
      if (before.status !== after.status && (after.status === 'completed' || after.status === 'canceled')) {
        const promotion = strapi.plugin('ordering').service('promotion') as ReturnType<
          typeof import('./promotion').default
        >;
        const now = new Date();
        await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          if (after.status === 'completed') await promotion.markApplied(trx, orderId, now);
          if (after.status === 'canceled') await promotion.releaseForOrder(trx, orderId, 'order-canceled', now);
        });
        if (after.status === 'completed') {
          // Order-level (not group-level), so a multi-group order invites once.
          await (
            strapi.plugin('ordering').service('rating') as ReturnType<typeof import('./rating').default>
          ).onOrderCompleted(orderId, { actor: { kind: 'system' }, requestId: `rating:${orderId}`, now });
        }
      }
      return { before, after };
    },

    /**
     * Shared read-only half of quote and create: branch rules, catalog lookups, line validation,
     * pricing, workflow selection and (when the caller passes `pickup`) pickup timing. Runs
     * inside the create transaction so slot counts and catalog reads see the same snapshot.
     */
    async prepareOrder(input: OrderDraftInput, ctx: ServiceContext): Promise<PreparedOrder> {
      const cfg = config();
      const { registry, scope, branch: branchService, scheduling } = services();

      const branch = (await strapi.db.query('plugin::ordering.branch').findOne({
        where: { code: input.locationRef },
      })) as BranchRow | null;
      if (!branch || !branch.isActive) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
          details: { locationRef: input.locationRef },
        });
      }
      if (ctx.actor.kind === 'staff') {
        const staffScope = await scope.loadScope(ctx);
        if (!scopeIncludes(staffScope, branch.code)) {
          throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
            details: { locationRef: input.locationRef },
          });
        }
      }
      if (input.origin.kind === 'storefront' && !branch.onlineOrdering) {
        throw new OrderingError('LOCATION_UNAVAILABLE', 'this branch does not take online orders', {
          details: { locationRef: branch.code },
        });
      }
      // O12: a paused branch rejects quotes AND creates for that receive kind — the same check
      // runs on both paths so a quote→create race cannot sneak an order through.
      branchService.assertOrderingOpen(branch, input.receiveMethod.kind, nowOf(ctx));

      const kind = input.receiveMethod.kind;
      const pickupSettings: PickupSettings | null =
        kind === 'pickup' ? branchService.pickupSettings(branch) : null;
      const deliverySettings: DeliverySettings | null =
        kind === 'delivery' ? branchService.deliverySettings(branch) : null;
      const receiveSettings = pickupSettings ?? deliverySettings;
      // Pickup callers pass `pickup`. A delivery cart always carries an address, so its rules apply.
      const enforce = (kind === 'pickup' && input.pickup !== undefined) || kind === 'delivery';
      if (enforce && !receiveSettings?.enabled) {
        throw new OrderingError(
          kind === 'delivery' ? 'DELIVERY_UNAVAILABLE' : 'FULFILLMENT_UNAVAILABLE',
          kind === 'delivery' ? 'this branch does not offer delivery' : 'this branch does not offer pickup',
          { details: kind === 'delivery' ? { reason: 'disabled' } : { kind } },
        );
      }

      const placedAt = input.placedAt ? new Date(input.placedAt) : nowOf(ctx);
      const locale = input.locale ?? cfg.catalog.defaultLocale;
      const customerGroups = await (
        strapi.plugin('ordering').service('customer-group') as {
          codesForPricing(input: {
            customerId?: number | null;
            originKind?: string | null;
            phone?: string | null;
          }): Promise<string[]>;
        }
      ).codesForPricing({
        customerId: input.customerId,
        originKind: input.origin.kind,
        phone: input.origin.kind === 'staff-draft' ? input.contact.phone : undefined,
      });
      const adapterCtx: AdapterContext = {
        now: placedAt.toISOString(),
        locationRef: input.locationRef,
        channel: priceChannelOf({ originKind: input.origin.kind, receiveKind: input.receiveMethod.kind }),
        customerGroups,
        timezone: branch.timezone,
      };
      const catalog = registry.catalogAdapter(cfg.catalog.adapter);
      const branchMethod = branch.fulfillment?.[kind] as JsonObject | undefined;
      const paymentTiming =
        (receiveSettings?.paymentTiming as string | undefined) ??
        (branchMethod?.paymentTiming as string | undefined);

      const priced: PricedLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const sellable = await catalog.getSellable(adapterCtx, { uid: line.sellableUid }, { locale });
        if (!sellable) {
          throw new OrderingError('SELLABLE_NOT_FOUND', 'sellable not found or inactive', {
            details: { lineIndex: index },
          });
        }
        const availability = await catalog.getAvailability(adapterCtx, sellable, line.quantity);
        if (!availability.available) {
          throw new OrderingError('SELLABLE_UNAVAILABLE', 'sellable is not available', {
            details: { lineIndex: index, reason: availability.reasonCode },
          });
        }
        const productType = registry.productType(sellable.productType);
        const configuration = {
          sellable: sellableForLine(sellable, line.variantUid),
          selected: line.selected ?? [],
          quantity: line.quantity,
          context: { locale, locationRef: input.locationRef, at: placedAt.toISOString() },
        };
        const validation = productType.validateLine(configuration);
        if (!validation.valid) {
          throw new OrderingError('LINE_INVALID', validation.message, {
            details: { lineIndex: index, code: validation.code },
          });
        }
        const quote = await productType.quoteLine(configuration);
        if (quote.currency !== cfg.currency) {
          throw new OrderingError('CURRENCY_MISMATCH', 'quoted currency differs from config', {
            details: { lineIndex: index },
          });
        }
        const workflow = productType.selectWorkflow({
          lines: [sellable],
          receiveMethod: input.receiveMethod,
          paymentTiming,
        });
        const lineLeadTime = Number(
          (sellable.metadata as JsonObject | undefined)?.leadTimeMinutes ?? 0,
        );
        priced.push({
          sellable,
          key: String(index),
          quantity: line.quantity,
          unitAmount: quote.unitAmount,
          optionAmount: quote.optionAmount,
          taxGroupRef: quote.taxGroupRef ?? sellable.taxGroupRef,
          workflow,
          leadTimeMinutes: Number.isFinite(lineLeadTime) ? lineLeadTime : 0,
        });
      }

      let providerCode = input.payment?.providerCode;
      if (enforce && receiveSettings) {
        providerCode ??= receiveSettings.paymentTiming === 'pay-on-pickup' ? 'cash' : undefined;
        if (!providerCode || !receiveSettings.paymentProviders.includes(providerCode)) {
          throw new OrderingError('VALIDATION_ERROR', 'payment method is not offered here', {
            details: { field: 'payment.providerCode', allowed: receiveSettings.paymentProviders },
          });
        }
      }

      let delivery: DeliveryQuote | null = null;
      let deliveryAddress: AddressSnapshot | null = null;
      let fulfillmentAmount = input.fulfillmentAmount ?? 0;
      if (kind === 'delivery' && deliverySettings && input.receiveMethod.kind === 'delivery') {
        deliveryAddress = requireDeliveryAddress(input.receiveMethod.address);
        const merchandise = priced.reduce(
          (sum, line) => sum + (line.unitAmount + line.optionAmount) * line.quantity,
          0,
        );
        const communeCode = deliveryAddress.wardCode ?? '';
        const provider = registry.fulfillmentProvider('self-delivery');
        const money = await provider.calculatePrice({
          order: { locationRef: branch.code, subtotalAmount: merchandise } as Order,
          group: {} as FulfillmentGroup,
          option: { communeCode, subtotal: merchandise },
        });
        if (money.currency !== cfg.currency) {
          throw new OrderingError('CURRENCY_MISMATCH', 'delivery fee currency differs from config');
        }
        const quoted = quoteDelivery(deliverySettings.zones, { communeCode, subtotal: merchandise });
        if (!quoted.available || quoted.fee !== money.amount) {
          throw new OrderingError('TOTALS_MISMATCH', 'delivery fee does not match the provider', {
            details: { communeCode: communeCode.trim().toUpperCase() },
          });
        }
        fulfillmentAmount = money.amount;
        delivery = {
          fee: money.amount,
          zoneCode: quoted.zoneCode,
          extraLeadTimeMinutes: quoted.extraLeadTimeMinutes,
          freeFrom: quoted.freeFrom,
        };
      }

      const cashRounding =
        branch.cashRounding && appliesCashRounding(branch.cashRounding, providerCode)
          ? { multiple: branch.cashRounding.multiple }
          : null;
      const merchandise = priced.reduce(
        (sum, line) => sum + (line.unitAmount + line.optionAmount) * line.quantity,
        0,
      );
      const promotions = await (
        strapi.plugin('ordering').service('promotion') as ReturnType<
          typeof import('./promotion').default
        >
      ).resolve({
        now: placedAt,
        timezone: branch.timezone,
        locationRef: branch.code,
        receiveKind: kind === 'delivery' ? 'delivery' : 'pickup',
        lines: priced.map((line, index) => ({
          index,
          sellableUid: line.sellable.ref.uid,
          ...(line.sellable.variant?.uid ? { variantUid: line.sellable.variant.uid } : {}),
          categoryRefs: line.sellable.categories.map((category) => category.ref),
          base: (line.unitAmount + line.optionAmount) * line.quantity,
        })),
        fulfillmentAmount,
        subtotal: merchandise,
        locale,
        ...(() => {
          const normalized = input.contact.phone ? normalizeVietnamesePhone(input.contact.phone) : null;
          return normalized?.valid ? { phoneE164: normalized.e164 } : {};
        })(),
        ...(input.promotionCode ? { code: input.promotionCode } : {}),
      });
      const priceWith = (promotionAdjustments: PricingAdjustmentInput[]) =>
        priceCart({
          currency: cfg.currency,
          lines: priced.map((line) => ({
            key: line.key,
            quantity: line.quantity,
            unitAmount: line.unitAmount,
            optionAmount: line.optionAmount,
            taxGroupRef: line.taxGroupRef,
          })),
          adjustments: [...(input.adjustments ?? []), ...promotionAdjustments],
          fulfillmentAmount,
          tax: { ...cfg.tax, ...(branch.tax ?? {}) },
          at: placedAt.toISOString(),
          cashRounding,
        });
      const pricing = priceWith(promotions.adjustments);
      const quotePricing = priceWith(promotions.quote.adjustments);

      const groupsByWorkflow = new Map<string, { name: string; version: string }>();
      for (const line of priced) {
        const key = `${line.workflow.name}@${line.workflow.version}`;
        if (!groupsByWorkflow.has(key)) groupsByWorkflow.set(key, line.workflow);
      }
      if (groupsByWorkflow.size > 1 && !cfg.allowMixedProductTypes) {
        throw new OrderingError('MIXED_WORKFLOW_UNSUPPORTED', 'cart mixes fulfillment workflows', {
          details: { workflows: [...groupsByWorkflow.keys()] },
        });
      }
      for (const workflow of groupsByWorkflow.values()) {
        registry.workflow(workflow.name, workflow.version);
      }

      if (enforce && receiveSettings && pricing.totals.subtotal < receiveSettings.minOrderAmount) {
        throw new OrderingError('MIN_ORDER_NOT_MET', 'the order is below the branch minimum', {
          details: { minOrderAmount: receiveSettings.minOrderAmount, subtotal: pricing.totals.subtotal },
        });
      }

      let timing: PickupTiming | null = null;
      if (enforce && receiveSettings && input.pickup) {
        timing = await scheduling.resolveTiming({
          branch,
          settings: receiveSettings,
          request: input.pickup,
          leadTimeMinutes:
            scheduling.leadTimeFor(
              receiveSettings,
              priced.map((line) => line.leadTimeMinutes),
            ) +
            (delivery?.extraLeadTimeMinutes ?? 0) +
            // O12 busy mode pushes every new ASAP/slot lead time out until the deadline.
            branchService.busyExtra(branch, nowOf(ctx)),
          now: nowOf(ctx),
        });
      }

      return {
        branch,
        pickupSettings,
        deliverySettings,
        delivery,
        deliveryAddress,
        priced,
        pricing,
        groupsByWorkflow,
        placedAt,
        locale,
        providerCode,
        timing,
        promotions,
        quotePricing,
      };
    },

    /** POST /quote: server-side prices for a cart; never trusts client amounts. */
    async quote(input: OrderDraftInput, ctx: ServiceContext) {
      const prepared = await service.prepareOrder(input, ctx);
      await assertDailyStock(prepared, input);
      return {
        currency: prepared.quotePricing.currency,
        cartHash: prepared.quotePricing.cartHash,
        lines: prepared.priced.map((line, index) => ({
          index,
          sellableUid: line.sellable.ref.uid,
          title: line.sellable.title,
          quantity: line.quantity,
          unitAmount: prepared.quotePricing.lines[index].unitAmount,
          optionAmount: prepared.quotePricing.lines[index].optionAmount,
          lineTotalAmount: prepared.quotePricing.lines[index].lineTotalAmount,
        })),
        adjustments: prepared.quotePricing.adjustments.map((adjustment) => ({
          kind: adjustment.kind,
          code: adjustment.code,
          label: adjustment.label,
          amount: adjustment.amount,
        })),
        totals: {
          ...prepared.quotePricing.totals,
          discountTotal: prepared.quotePricing.adjustments
            .filter((adjustment) => adjustment.kind === 'discount')
            .reduce((sum, adjustment) => sum + adjustment.amount, 0),
        },
        promotions: prepared.promotions.quote.applied.map((promo) => ({
          code: promo.code,
          label: promo.label,
          amount: promo.amount,
          target: promo.target.kind,
        })),
        rejectedPromotions: prepared.promotions.quote.rejected,
        // First-order / per-customer promotions: checked against the phone at order time only.
        pendingPromotions: prepared.promotions.quote.pending,
        payment: { providerCode: prepared.providerCode ?? null },
        timing: timingSnapshot(prepared.timing),
        delivery: prepared.delivery,
      };
    },

    async createOrder(input: CreateOrderInput, ctx: ServiceContext): Promise<CreateOrderResult> {
      const cfg = config();

      // Cheap validations before claiming the key; failures never consume it.
      if (input.consent.policyVersion !== cfg.consent.policyVersion) {
        throw new OrderingError('CONSENT_REQUIRED', 'consent policy version is not current', {
          details: { expected: cfg.consent.policyVersion },
        });
      }
      const phone = normalizeVietnamesePhone(input.contact.phone);
      if (!phone.valid) {
        throw new OrderingError('VALIDATION_ERROR', 'contact.phone must be a Vietnamese phone number', {
          details: { field: 'contact.phone', reason: phone.reason },
        });
      }
      if (input.receiveMethod.kind === 'delivery') {
        requireDeliveryAddress(input.receiveMethod.address);
      }
      if ((input.customerNote?.length ?? 0) > MAX_CUSTOMER_NOTE) {
        throw new OrderingError('VALIDATION_ERROR', 'customerNote is too long', {
          details: { field: 'customerNote', max: MAX_CUSTOMER_NOTE },
        });
      }
      if (input.lines.length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'order needs at least one line');
      }
      // The order token is sealed on the idempotency row; refuse before claiming without a key.
      services().idempotency.assertSealingConfigured();

      const { idempotencyKey, ...payload } = input;
      const outcome = await services().idempotency.run(
        { scope: 'order.create', key: idempotencyKey, payload },
        ctx,
        async (trx) => {
          const { timeline, hold, outbox, scheduling, customer } = services();
          const prepared = await service.prepareOrder(payload, ctx);
          if (payload.promotionCode) {
            (
              strapi.plugin('ordering').service('promotion') as ReturnType<
                typeof import('./promotion').default
              >
            ).throwIfCodeRejected(prepared.promotions, prepared.pricing.totals.subtotal);
          }
          let { pricing } = prepared;
          const { branch, priced, groupsByWorkflow, placedAt, locale, timing } = prepared;
          // Compared with the quote view: phone-history promotions applied below can only lower
          // the total, and the quote must not depend on the phone (no "has ordered" oracle).
          if (input.expectedCartHash && input.expectedCartHash !== prepared.quotePricing.cartHash) {
            throw new OrderingError('PRICE_CHANGED', 'the quoted cart no longer matches', {
              details: { cartHash: prepared.quotePricing.cartHash },
            });
          }

          const seq = await repo.nextOrderSequence(trx as TransactionClient);
          const code = formatOrderCode(cfg.orderCode.template, {
            prefix: cfg.orderCode.prefix,
            seq,
            at: placedAt,
            timezone: branch.timezone,
          });
          const publicToken = randomBytes(32).toString('base64url');
          const now = nowOf(ctx);
          const kind = input.receiveMethod.kind;
          const branchMethod = branch.fulfillment?.[kind] as JsonObject | undefined;
          const businessDayPolicy = (branchMethod?.schedule as JsonObject | undefined)
            ?.businessDayPolicy as JsonObject | undefined;
          const cutoffLocalTime =
            (businessDayPolicy?.cutoffLocalTime as string | undefined) ??
            cfg.businessDay.cutoffLocalTime;
          const deliveryAddress = prepared.deliveryAddress;
          const receiveMethod = {
            ...input.receiveMethod,
            ...(kind === 'pickup' ? { locationRef: branch.code } : {}),
            ...(deliveryAddress ? { address: deliveryAddress } : {}),
            ...(timing ? { timing: timingSnapshot(timing) } : {}),
          };

          const customerId = await customer.linkForOrder({
            sessionCustomerId: input.customerId ?? null,
            phoneE164: phone.e164,
          });
          const order = await strapi.db.query('plugin::ordering.order').create({
            data: {
              code,
              publicTokenHash: sha256Hex(publicToken),
              status: input.origin.kind === 'staff-draft' ? 'draft' : 'open',
              paymentStatus: 'unpaid',
              ...(customerId ? { customer: customerId } : {}),
              fulfillmentStatus: 'not-started',
              subtotalAmount: pricing.totals.subtotal,
              adjustmentAmount: pricing.totals.adjustmentTotal,
              fulfillmentAmount: pricing.totals.fulfillmentTotal,
              taxAmount: pricing.totals.taxTotal,
              totalAmount: pricing.totals.grandTotal,
              currency: pricing.currency,
              contactSnapshot: {
                name: input.contact.name,
                phone: phone.e164,
                email: input.contact.email || undefined,
              },
              consentSnapshot: {
                policyVersion: input.consent.policyVersion,
                acceptedAt: input.consent.acceptedAt ?? now.toISOString(),
                channel: input.consent.channel,
                actorRef:
                  input.consent.channel === 'phone-staff' ? actorRefOf(ctx) : undefined,
                marketingOptIn: !!input.consent.marketingOptIn,
              },
              customerNote: input.customerNote ?? null,
              placedLocale: locale,
              branch: branch.id,
              locationRef: branch.code,
              branchSnapshot: { code: branch.code, name: branch.name },
              businessDate: businessDate(placedAt, branch.timezone, cutoffLocalTime),
              placedAt,
              receiveMethod,
              origin: input.origin,
              cartHash: pricing.cartHash,
            },
          });
          const orderId = order.id as number;
          if (prepared.promotions.applied.length > 0 && !prepared.promotions.customerKey) {
            // Create validates the phone first, so this is unreachable; never apply unreserved.
            throw new OrderingError('INTERNAL', 'promotion applied without a customer key');
          }
          if (prepared.promotions.applied.length > 0 && prepared.promotions.customerKey) {
            const promotion = strapi.plugin('ordering').service('promotion') as ReturnType<
              typeof import('./promotion').default
            >;
            const reserved = await promotion.reserveInTransaction(
              trx as TransactionClient,
              orderId,
              prepared.promotions.applied,
              prepared.promotions.customerKey,
              now,
            );
            if (reserved.dropped.length > 0) {
              const dropped = new Set(reserved.dropped.map((id) => `promotion:${id}`));
              pricing = priceCart({
                currency: cfg.currency,
                lines: priced.map((line) => ({
                  key: line.key,
                  quantity: line.quantity,
                  unitAmount: line.unitAmount,
                  optionAmount: line.optionAmount,
                  taxGroupRef: line.taxGroupRef,
                })),
                adjustments: pricing.adjustments
                  .filter((adjustment) => adjustment.code !== 'cash-rounding' && !dropped.has(adjustment.sourceRef ?? ''))
                  .map((adjustment) => ({
                    kind: adjustment.kind,
                    code: adjustment.code,
                    label: adjustment.label,
                    amount: adjustment.amount,
                    taxable: adjustment.taxable,
                    priority: adjustment.priority,
                    ...(adjustment.sourceRef ? { sourceRef: adjustment.sourceRef } : {}),
                    ...(adjustment.ruleSnapshot ? { ruleSnapshot: adjustment.ruleSnapshot } : {}),
                    target: adjustment.target,
                  })),
                fulfillmentAmount: prepared.delivery?.fee ?? input.fulfillmentAmount ?? 0,
                tax: { ...cfg.tax, ...(branch.tax ?? {}) },
                at: placedAt.toISOString(),
                cashRounding:
                  branch.cashRounding && appliesCashRounding(branch.cashRounding, prepared.providerCode)
                    ? { multiple: branch.cashRounding.multiple }
                    : null,
              });
              await repo.updateOrder(orderId, {
                subtotalAmount: pricing.totals.subtotal,
                adjustmentAmount: pricing.totals.adjustmentTotal,
                fulfillmentAmount: pricing.totals.fulfillmentTotal,
                taxAmount: pricing.totals.taxTotal,
                totalAmount: pricing.totals.grandTotal,
                cartHash: pricing.cartHash,
              });
            }
          }

          const groupIds = new Map<string, number>();
          let first = true;
          for (const [key, workflow] of groupsByWorkflow) {
            const definition = services().registry.workflow(workflow.name, workflow.version);
            const group = await strapi.db.query('plugin::ordering.fulfillment-group').create({
              data: {
                order: orderId,
                workflowName: workflow.name,
                workflowVersion: workflow.version,
                receiveMethod,
                status: definition.initial,
                fulfillmentAmount: first ? pricing.totals.fulfillmentTotal : 0,
              },
            });
            groupIds.set(key, group.id as number);
            first = false;
          }

          if (receiveMethod.kind === 'delivery') {
            const groupId = groupIds.values().next().value as number;
            const provider = services().registry.fulfillmentProvider('self-delivery');
            await provider.create({
              order: { locationRef: branch.code, subtotalAmount: pricing.totals.subtotal } as Order,
              group: { id: String(groupId) } as FulfillmentGroup,
              option: { communeCode: receiveMethod.address.wardCode ?? '', subtotal: pricing.totals.subtotal },
            });
            await strapi.db.query('plugin::ordering.fulfillment').create({
              data: {
                order: orderId,
                group: groupId,
                providerCode: 'self-delivery',
                status: 'pending',
                addressSnapshot: receiveMethod.address,
                metadata: {
                  zoneCode: prepared.delivery?.zoneCode ?? null,
                  fee: pricing.totals.fulfillmentTotal,
                },
              },
            });
          }

          const lineIds = new Map<string, number>();
          for (const [index, line] of priced.entries()) {
            const pricedLine = pricing.lines[index];
            const created = await strapi.db.query('plugin::ordering.order-line').create({
              data: {
                order: orderId,
                fulfillmentGroup: groupIds.get(`${line.workflow.name}@${line.workflow.version}`),
                position: index,
                sellableUid: line.sellable.ref.uid,
                sourceUid: line.sellable.ref.sourceUid ?? null,
                sourceDocumentId: line.sellable.ref.sourceDocumentId ?? null,
                productType: line.sellable.productType,
                variantUid: input.lines[index].variantUid ?? line.sellable.variant?.uid ?? null,
                sku: line.sellable.variant?.sku ?? null,
                titleSnapshot: line.sellable.title,
                descriptionSnapshot: line.sellable.description ?? null,
                imageUrlSnapshot: line.sellable.imageUrl ?? null,
                selectedOptionsSnapshot: describeSelectedOptions(
                  line.sellable,
                  input.lines[index].selected ?? [],
                ),
                componentsSnapshot: bundleComponentsFromSellable(
                  line.sellable,
                  input.lines[index].selected ?? [],
                ),
                categoriesSnapshot: line.sellable.categories,
                taxSnapshot: pricedLine.taxSnapshot,
                note: input.lines[index].note ?? null,
                quantity: line.quantity,
                fulfilledQuantity: 0,
                returnedQuantity: 0,
                canceledQuantity: 0,
                unitAmount: pricedLine.unitAmount,
                optionAmount: pricedLine.optionAmount,
                baseAmount: pricedLine.baseAmount,
                discountAmount: pricedLine.discountAmount,
                feeAmount: pricedLine.feeAmount,
                roundingDelta: pricedLine.roundingDelta,
                taxAmount: pricedLine.taxAmount,
                lineTotalAmount: pricedLine.lineTotalAmount,
                currency: pricing.currency,
              },
            });
            lineIds.set(line.key, created.id as number);
          }

          await reserveDailyStock(trx as TransactionClient, prepared, payload, orderId, lineIds);

          for (const adjustment of pricing.adjustments) {
            const created = await strapi.db.query('plugin::ordering.order-adjustment').create({
              data: {
                order: orderId,
                kind: adjustment.kind,
                code: adjustment.code,
                label: adjustment.label,
                sourceRef: adjustment.sourceRef ?? null,
                ruleSnapshot: adjustment.ruleSnapshot ?? null,
                amount: adjustment.amount,
                taxable: adjustment.taxable,
                priority: adjustment.priority,
              },
            });
            for (const allocation of adjustment.allocations) {
              await strapi.db.query('plugin::ordering.adjustment-allocation').create({
                data: {
                  adjustment: created.id,
                  line: lineIds.get(allocation.lineKey) ?? null,
                  weight: allocation.weight,
                  amount: allocation.amount,
                },
              });
            }
          }

          const slotSettings = prepared.pickupSettings ?? prepared.deliverySettings;
          if (timing?.mode === 'scheduled' && slotSettings) {
            await scheduling.reserveInTransaction(
              trx as TransactionClient,
              {
                orderId,
                groupId: groupIds.values().next().value,
                locationRef: branch.code,
                slot: timing.slot,
                capacity: slotSettings.schedule.capacity,
              },
              ctx,
            );
          }

          for (const holdInput of input.holds ?? []) {
            const expiresAt = new Date(holdInput.expiresAt);
            if (!Number.isFinite(expiresAt.getTime())) {
              throw new OrderingError('VALIDATION_ERROR', 'hold expiresAt must be a valid date');
            }
            const holdLine = priced[holdInput.lineIndex];
            const holdGroupId = holdLine
              ? groupIds.get(`${holdLine.workflow.name}@${holdLine.workflow.version}`)
              : undefined;
            await hold.create(
              {
                orderId,
                lineId: lineIds.get(String(holdInput.lineIndex)),
                groupId: holdGroupId,
                resourceRef: holdInput.resourceRef,
                quantity: holdInput.quantity,
                expiresAt,
              },
              ctx,
            );
          }

          await timeline.record(
            {
              orderId,
              type: 'order.placed',
              isPublic: true,
              payload: {
                code,
                totalAmount: pricing.totals.grandTotal,
                currency: pricing.currency,
                locationRef: branch.code,
              },
            },
            ctx,
          );
          await outbox.enqueue(
            {
              type: 'order.created',
              aggregateType: 'order',
              aggregateId: String(orderId),
              payload: {
                orderId,
                code,
                status: input.origin.kind === 'staff-draft' ? 'draft' : 'open',
                totalAmount: pricing.totals.grandTotal,
                currency: pricing.currency,
                locationRef: branch.code,
              },
              uniqueKey: `order.created:${orderId}`,
            },
            ctx,
          );

          return {
            result: { orderId, publicToken },
            responseRef: `order:${orderId}`,
            responseSnapshot: {
              orderId,
              code,
              status: input.origin.kind === 'staff-draft' ? 'draft' : 'open',
              totalAmount: pricing.totals.grandTotal,
              currency: pricing.currency,
            },
            secret: publicToken,
          };
        },
      );

      if (outcome.replayed) {
        const snapshot = outcome.result;
        const orderId = Number(snapshot.orderId);
        const aggregate = await repo.loadOrderAggregate(orderId);
        if (!aggregate) {
          throw new OrderingError('INTERNAL', 'idempotent replay lost the stored order');
        }
        return { order: aggregate, publicToken: outcome.secret ?? null, replayed: true };
      }
      const aggregate = await repo.loadOrderAggregate(outcome.result.orderId);
      if (!aggregate) {
        throw new OrderingError('INTERNAL', 'created order could not be reloaded');
      }
      return { order: aggregate, publicToken: outcome.result.publicToken, replayed: false };
    },

    /** Confirms a staff draft into the live flow. */
    async confirmDraft(orderId: number, ctx: ServiceContext): Promise<ProjectionChange> {
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const { scope, timeline, outbox } = services();
        const order = await repo.findOrderById(orderId);
        if (!order) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
        }
        if (ctx.actor.kind === 'staff') {
          scope.assertLocationInScope(await scope.loadScope(ctx), order.locationRef);
        }
        if (order.status !== 'draft') {
          throw new OrderingError('VALIDATION_ERROR', 'order is not a draft', {
            details: { status: order.status },
          });
        }
        await reserveConfirmedDraft(trx, orderId, order);
        await repo.updateOrder(orderId, { draftConfirmedAt: nowOf(ctx) });
        const projection = await service.recomputeProjection(orderId);
        await timeline.record(
          { orderId, type: 'order.confirmed', isPublic: true, payload: { code: order.code } },
          ctx,
        );
        await outbox.enqueue(
          {
            type: 'order.transitioned',
            aggregateType: 'order',
            aggregateId: String(orderId),
            payload: {
              orderId,
              from: projection.before.status,
              to: projection.after.status,
              actorRef: actorRefOf(ctx),
              locationRef: order.locationRef,
            },
            uniqueKey: `order.transitioned:${orderId}:draft:${randomUUID()}`,
          },
          ctx,
        );
        return projection;
      });
    },

    async getOrder(id: number, ctx: ServiceContext): Promise<OrderAggregate> {
      const { scope } = services();
      const aggregate = await repo.loadOrderAggregate(id);
      if (!aggregate) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId: id } });
      }
      if (ctx.actor.kind === 'staff') {
        scope.assertLocationInScope(await scope.loadScope(ctx), aggregate.order.locationRef);
      }
      return aggregate;
    },

    async listOrders(
      filters: { locationRef?: string; status?: string; limit?: number },
      ctx: ServiceContext,
    ) {
      const { scope } = services();
      const conditions: Record<string, unknown>[] = [];
      if (ctx.actor.kind === 'staff') {
        conditions.push(scope.orderWhere(await scope.loadScope(ctx)));
      }
      if (filters.locationRef) conditions.push({ locationRef: filters.locationRef });
      if (filters.status) conditions.push({ status: filters.status });
      return strapi.db.query('plugin::ordering.order').findMany({
        where: conditions.length === 0 ? {} : { $and: conditions },
        orderBy: { placedAt: 'desc' },
        limit: filters.limit ?? 50,
      });
    },
  };

  return service;
};

export default orderService;
