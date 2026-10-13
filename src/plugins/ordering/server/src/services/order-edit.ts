import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type {
  AddressSnapshot,
  FulfillmentGroup,
  JsonObject,
  Order,
  ReceiveMethod,
  SelectedOptionInput,
  Sellable,
} from '../contracts';
import type { PickupSettings } from '../domain/branch-settings';
import { bundleComponentsFromSellable } from '../domain/catalog/bundle-components';
import { snapshotDeliveryAddress, type DeliveryAddressInput } from '../domain/contact/address';
import { receiveBusinessDate, stockTargetsForLine, type StockTarget } from '../domain/daily-stock-lines';
import { quoteDelivery } from '../domain/delivery/zones';
import { OrderingError } from '../domain/errors';
import { amountFromDb } from '../domain/money';
import {
  assertEditable,
  assertHasEditRequest,
  assertReason,
  assertRevision,
  editWarnings,
  linesAfterReduce,
  planEditMoney,
  previewLines,
  priceEditedOrder,
  pricingKeyForAdded,
  pricingKeyForLine,
  type AddedPriceLine,
  type EditMoneyPlan,
  type EditPreviewLine,
  type EditTotals,
  type LineAfterReduce,
} from '../domain/order-edit';
import { appliesCashRounding } from '../domain/pricing/cash-rounding';
import type { PricedLine, PricingAdjustmentInput } from '../domain/pricing/pipeline';
import type { TaxContext } from '../domain/pricing/tax';
import { describeSelectedOptions } from '../domain/storefront/serialize';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import { isOnlinePaymentProvider } from '../providers/cash';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type adminUnitsFactory from './admin-units';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type dailyStockFactory from './daily-stock';
import type holdFactory from './hold';
import type orderServiceFactory from './order';
import { timingSnapshot } from './order';
import type outboxFactory from './outbox';
import type paymentLinkFactory from './payment-link';
import type paymentFactory from './payment';
import type pickupSchedulingFactory from './pickup-scheduling';
import type { PickupTiming, PickupTimingInput } from './pickup-scheduling';
import type refundFactory from './refund';
import type { OrderingRegistry } from './registry';
import type timelineFactory from './timeline';

/**
 * Staff edit of an open order. Old lines keep the price they were placed at.
 * Added lines are quoted now. A captured transfer is refunded before cash.
 * An online top-up gets a pending payment and a payment link; the kitchen
 * group stays where it is. Preview runs the same writes, then rolls them back.
 * The payment-link token lives in the plugin store, which is not transactional,
 * so only a real edit seals that token.
 */

export type EditLineInput = {
  sellableUid: string;
  variantUid?: string;
  options?: SelectedOptionInput[];
  quantity: number;
  note?: string;
};

export type EditInput = {
  revision: number;
  reason: string;
  add?: EditLineInput[];
  reduce?: Array<{ lineId: number; quantity: number }>;
  timing?: { kind: 'asap' } | { kind: 'scheduled'; startsAt: string };
  address?: DeliveryAddressInput;
  notifyCustomer?: boolean;
};

export type EditPreview = {
  revision: number;
  lines: EditPreviewLine[];
  totals: { before: EditTotals; after: EditTotals };
  fulfillmentAmount: { before: number; after: number };
  timing?: { before: string | null; after: string | null };
  money: EditMoneyPlan;
  warnings: string[];
};

type Services = {
  order: ReturnType<typeof orderServiceFactory>;
  refund: ReturnType<typeof refundFactory>;
  payment: ReturnType<typeof paymentFactory>;
  paymentLink: ReturnType<typeof paymentLinkFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  hold: ReturnType<typeof holdFactory>;
  dailyStock: ReturnType<typeof dailyStockFactory>;
  branch: ReturnType<typeof branchFactory>;
  scheduling: ReturnType<typeof pickupSchedulingFactory>;
  changeLog: ReturnType<typeof changeLogFactory>;
  registry: OrderingRegistry;
};

type QuotedAdd = {
  sellable: Sellable;
  selected: SelectedOptionInput[];
  quantity: number;
  note: string | null;
  variantUid: string | null;
  unitAmount: number;
  optionAmount: number;
  taxGroupRef?: string;
  leadTimeMinutes: number;
  workflow: { name: string; version: string };
  groupId: number;
};

type StoredReceive = {
  kind?: string;
  locationRef?: string;
  providerCode?: string;
  address?: AddressSnapshot;
  timing?: {
    mode?: string;
    slot?: { startsAt?: string; endsAt?: string };
    requestedReadyAt?: string;
  } | null;
};

const ADJUSTMENT_KINDS = new Set(['discount', 'fee', 'rounding']);

const receiveKind = (receive: StoredReceive): 'pickup' | 'delivery' | 'appointment' => {
  if (receive.kind === 'delivery') return 'delivery';
  if (receive.kind === 'appointment') return 'appointment';
  return 'pickup';
};

const timingRequest = (timing: EditInput['timing']): PickupTimingInput | null => {
  if (timing === undefined) return null;
  if (timing.kind === 'asap') return { asap: true };
  if (timing.kind === 'scheduled' && typeof timing.startsAt === 'string' && timing.startsAt.length > 0) {
    return { slot: { startsAt: timing.startsAt } };
  }
  throw new OrderingError('VALIDATION_ERROR', 'timing is invalid', { details: { field: 'timing' } });
};

const stableTiming = (value: StoredReceive['timing'] | ReturnType<typeof timingSnapshot>): string => {
  if (!value) return '';
  const row = value as {
    mode?: string;
    slot?: { startsAt?: string; endsAt?: string };
    requestedReadyAt?: string;
  };
  return JSON.stringify({
    mode: row.mode ?? null,
    startsAt: row.slot?.startsAt ?? null,
    endsAt: row.slot?.endsAt ?? null,
    requestedReadyAt: row.requestedReadyAt ?? null,
  });
};

const stableAddress = (address: AddressSnapshot | null | undefined): string =>
  JSON.stringify(
    address
      ? {
          recipientName: address.recipientName,
          phone: address.phone,
          line1: address.line1,
          wardCode: address.wardCode ?? null,
          provinceCode: address.provinceCode ?? null,
          note: address.note ?? null,
        }
      : null,
  );

const timingLabel = (value: StoredReceive['timing'] | ReturnType<typeof timingSnapshot>): string | null => {
  if (!value) return null;
  const row = value as {
    mode?: string;
    slot?: { startsAt?: string };
    requestedReadyAt?: string;
  };
  if (row.mode === 'scheduled') return row.slot?.startsAt ?? null;
  return row.requestedReadyAt ?? null;
};

const selectedOf = (snapshot: unknown): Array<{ optionUid: string; quantity?: number }> => {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const optionUid = (row as { optionUid?: unknown }).optionUid;
    const quantity = (row as { quantity?: unknown }).quantity;
    if (typeof optionUid !== 'string') return [];
    return [{ optionUid, quantity: typeof quantity === 'number' ? quantity : 1 }];
  });
};

const reservationOf = (lineId: number, target: StockTarget) => ({
  entityType: target.entityType,
  entityDocumentId: target.entityDocumentId,
  quantity: target.quantity,
  lineId,
  sellableUid: target.sellableUid,
  ...(target.variantUid ? { variantUid: target.variantUid } : {}),
  ...(target.modifierUid ? { modifierUid: target.modifierUid } : {}),
});

const moneyColumns = (priced: PricedLine) => ({
  unitAmount: priced.unitAmount,
  optionAmount: priced.optionAmount,
  baseAmount: priced.baseAmount,
  discountAmount: priced.discountAmount,
  feeAmount: priced.feeAmount,
  roundingDelta: priced.roundingDelta,
  taxAmount: priced.taxAmount,
  lineTotalAmount: priced.lineTotalAmount,
  taxSnapshot: priced.taxSnapshot,
});

const orderEdit = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      order: plugin.service('order') as Services['order'],
      refund: plugin.service('refund') as Services['refund'],
      payment: plugin.service('payment') as Services['payment'],
      paymentLink: plugin.service('payment-link') as Services['paymentLink'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
      hold: plugin.service('hold') as Services['hold'],
      dailyStock: plugin.service('daily-stock') as Services['dailyStock'],
      branch: plugin.service('branch') as Services['branch'],
      scheduling: plugin.service('pickup-scheduling') as Services['scheduling'],
      changeLog: plugin.service('change-log') as Services['changeLog'],
      registry: plugin.service('registry') as Services['registry'],
    };
  };
  const repo = orderRepository({ strapi });
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const lines = () => strapi.db.query('plugin::ordering.order-line');
  const groups = () => strapi.db.query('plugin::ordering.fulfillment-group');
  const adjustments = () => strapi.db.query('plugin::ordering.order-adjustment');
  const allocations = () => strapi.db.query('plugin::ordering.adjustment-allocation');

  const cutoffOf = (fulfillment: unknown, kind: string): string => {
    const root = fulfillment && typeof fulfillment === 'object' ? (fulfillment as JsonObject) : {};
    const method = root[kind] as JsonObject | undefined;
    const policy = (method?.schedule as JsonObject | undefined)?.businessDayPolicy as JsonObject | undefined;
    const cutoff = policy?.cutoffLocalTime;
    return typeof cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)
      ? cutoff
      : config().businessDay.cutoffLocalTime;
  };

  const apply = async (
    trx: TransactionClient,
    orderId: number,
    input: EditInput,
    ctx: ServiceContext,
    persistLink: boolean,
  ): Promise<EditPreview> => {
    const {
      order,
      refund,
      payment,
      paymentLink,
      timeline,
      outbox,
      hold,
      dailyStock,
      branch: branchService,
      scheduling,
      changeLog,
      registry,
    } = services();

    const groupRows = (await groups().findMany({
      where: { order: orderId },
      select: ['id'],
    })) as Array<{ id: number }>;
    for (const groupId of groupRows.map((row) => row.id).sort((left, right) => left - right)) {
      await repo.lockGroup(trx, groupId);
    }
    const aggregate = await order.getOrder(orderId, ctx);
    for (const lineId of aggregate.lines.map((line) => line.id).sort((left, right) => left - right)) {
      await repo.lockLine(trx, lineId);
    }

    const orderRow = aggregate.order;
    if (orderRow.status === 'draft' || orderRow.status === 'completed' || orderRow.status === 'canceled') {
      throw new OrderingError('ORDER_NOT_EDITABLE', 'this order cannot be edited', {
        details: { status: orderRow.status },
      });
    }
    const receive = orderRow.receiveMethod as StoredReceive;
    const kind = receiveKind(receive);
    const openGroups = aggregate.groups.filter((group) => {
      const definition = registry.workflow(group.workflowName, group.workflowVersion);
      return !isTerminal(definition, group.status);
    });
    if (openGroups.length === 0) {
      throw new OrderingError('ORDER_NOT_EDITABLE', 'this order cannot be edited', {
        details: { status: orderRow.status },
      });
    }
    for (const group of openGroups) assertEditable(kind, group.status);

    const currentRevision = orderRow.editRevision ?? 0;
    assertRevision(input.revision, currentRevision);
    const reason = assertReason(input.reason);
    assertHasEditRequest(input);
    if (input.notifyCustomer !== undefined && typeof input.notifyCustomer !== 'boolean') {
      throw new OrderingError('VALIDATION_ERROR', 'notifyCustomer must be a boolean', {
        details: { field: 'notifyCustomer' },
      });
    }
    const notifyCustomer = input.notifyCustomer !== false;

    const reduced = linesAfterReduce(
      aggregate.lines.map((line) => ({
        lineId: line.id,
        title: line.titleSnapshot,
        quantity: line.quantity,
        canceledQuantity: line.canceledQuantity,
        returnedQuantity: line.returnedQuantity,
        unitAmount: line.unitAmount,
        optionAmount: line.optionAmount,
        ...(line.taxSnapshot ? { taxGroupRef: line.taxSnapshot.category } : {}),
      })),
      input.reduce,
    );
    const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));

    if (kind !== 'delivery' && input.address !== undefined) {
      throw new OrderingError('VALIDATION_ERROR', 'only a delivery order can change the address', {
        details: { field: 'address' },
      });
    }

    const branch = await branchService.findByCode(orderRow.locationRef);
    if (!branch) {
      throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
        details: { locationRef: orderRow.locationRef },
      });
    }
    const settings =
      kind === 'delivery' ? branchService.deliverySettings(branch) : branchService.pickupSettings(branch);
    const slotSettings = settings as PickupSettings;

    let nextAddress: AddressSnapshot | null = kind === 'delivery' ? (receive.address ?? null) : null;
    if (kind === 'delivery' && input.address !== undefined) {
      const units = strapi.plugin('ordering').service('admin-units') as ReturnType<typeof adminUnitsFactory>;
      const resolved = snapshotDeliveryAddress(input.address, units.catalog());
      if (!resolved.ok) {
        throw new OrderingError('VALIDATION_ERROR', resolved.message, {
          details: { field: resolved.field, reason: resolved.reason },
        });
      }
      nextAddress = resolved.address;
    }

    const now = nowOf(ctx);
    const locale = orderRow.placedLocale ?? config().catalog.defaultLocale;
    const quoted = await quoteAdded(input.add ?? [], {
      registry,
      kind,
      receive,
      nextAddress,
      locationRef: orderRow.locationRef,
      paymentTiming: settings.paymentTiming,
      locale,
      now,
      openGroups,
    });

    const merchandise = merchandiseOf(reduced, quoted);
    const zones = kind === 'delivery' ? branchService.deliverySettings(branch).zones : [];
    const delivery = await deliveryFee(registry, branch.code, kind, zones, nextAddress, merchandise);
    const fulfillmentAmount = kind === 'delivery' ? (delivery?.fee ?? 0) : 0;

    const requestedTiming = timingRequest(input.timing);
    let resolvedTiming: PickupTiming | null = null;
    if (requestedTiming) {
      const leadTimes = quoted.map((line) => line.leadTimeMinutes);
      resolvedTiming = await scheduling.resolveTiming({
        branch,
        settings: slotSettings,
        request: requestedTiming,
        leadTimeMinutes:
          scheduling.leadTimeFor(slotSettings, leadTimes) + (delivery?.extraLeadTimeMinutes ?? 0),
        now,
      });
    }

    const nextTiming = resolvedTiming ? timingSnapshot(resolvedTiming) : (receive.timing ?? null);
    const qtySame =
      quoted.length === 0 && reduced.every((line) => line.quantityBefore === line.quantityAfter);
    if (
      qtySame &&
      stableTiming(receive.timing) === stableTiming(nextTiming) &&
      stableAddress(kind === 'delivery' ? receive.address : null) ===
        stableAddress(kind === 'delivery' ? nextAddress : null)
    ) {
      throw new OrderingError('EDIT_EMPTY', 'the edit does not change the order');
    }

    const addedForPrice: AddedPriceLine[] = quoted.map((line) => ({
      title: line.sellable.title,
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      optionAmount: line.optionAmount,
      ...(line.taxGroupRef ? { taxGroupRef: line.taxGroupRef } : {}),
    }));
    const keptAdjustments = aggregate.adjustments.filter((row) => row.code !== 'cash-rounding');
    const adjustmentInputs: PricingAdjustmentInput[] = keptAdjustments.map((row) => {
      if (!ADJUSTMENT_KINDS.has(row.kind)) {
        throw new OrderingError('VALIDATION_ERROR', 'stored adjustment kind is not supported', {
          details: { code: row.code },
        });
      }
      return {
        kind: row.kind as PricingAdjustmentInput['kind'],
        code: row.code,
        label: row.label,
        amount: row.amount,
        taxable: row.taxable,
        priority: row.priority,
        ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}),
        ...(row.ruleSnapshot ? { ruleSnapshot: row.ruleSnapshot } : {}),
      };
    });
    const capturedOnline = aggregate.payments.find(
      (paymentRow) =>
        paymentRow.providerCode !== 'cash' && paymentRow.capturedAmount - paymentRow.refundedAmount > 0,
    );
    const roundingCode = capturedOnline?.providerCode ?? 'cash';
    const pricing = priceEditedOrder({
      currency: orderRow.currency,
      lines: [
        ...reduced.flatMap((line) => {
          if (line.quantityAfter <= 0) return [];
          return [
            {
              key: pricingKeyForLine(line.lineId),
              quantity: line.quantityAfter,
              unitAmount: line.unitAmount,
              optionAmount: line.optionAmount,
              ...(line.taxGroupRef ? { taxGroupRef: line.taxGroupRef } : {}),
            },
          ];
        }),
        ...addedForPrice.map((line, index) => ({
          key: pricingKeyForAdded(index),
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          optionAmount: line.optionAmount,
          ...(line.taxGroupRef ? { taxGroupRef: line.taxGroupRef } : {}),
        })),
      ],
      adjustments: adjustmentInputs,
      fulfillmentAmount,
      tax: { ...config().tax, ...(branch.tax ?? {}) } as TaxContext,
      at: now.toISOString(),
      cashRounding:
        branch.cashRounding && appliesCashRounding(branch.cashRounding, roundingCode)
          ? { multiple: branch.cashRounding.multiple }
          : null,
    });

    const pendingByPayment = await pendingRefunds(trx, aggregate.payments.map((row) => row.id));
    const money = planEditMoney({
      newTotal: pricing.totals.grandTotal,
      payments: aggregate.payments.map((row) => ({
        id: row.id,
        providerCode: row.providerCode,
        captured: row.capturedAmount,
        refunded: row.refundedAmount,
        pendingRefund: pendingByPayment.get(row.id) ?? 0,
      })),
    });
    const warnings = editWarnings({
      subtotal: pricing.totals.subtotal,
      minOrderAmount: settings.minOrderAmount,
      keptDiscount: keptAdjustments.some((row) => row.kind === 'discount'),
    });
    const nextRevision = currentRevision + 1;
    const beforeTotals: EditTotals = {
      subtotal: orderRow.subtotalAmount,
      adjustment: orderRow.adjustmentAmount,
      fulfillment: orderRow.fulfillmentAmount,
      tax: orderRow.taxAmount,
      total: orderRow.totalAmount,
    };
    const afterTotals: EditTotals = {
      subtotal: pricing.totals.subtotal,
      adjustment: pricing.totals.adjustmentTotal,
      fulfillment: pricing.totals.fulfillmentTotal,
      tax: pricing.totals.taxTotal,
      total: pricing.totals.grandTotal,
    };
    const preview: EditPreview = {
      revision: nextRevision,
      lines: previewLines({ existing: reduced, added: addedForPrice, priced: pricing.lines }),
      totals: { before: beforeTotals, after: afterTotals },
      fulfillmentAmount: { before: orderRow.fulfillmentAmount, after: pricing.totals.fulfillmentTotal },
      ...(resolvedTiming
        ? { timing: { before: timingLabel(receive.timing), after: timingLabel(nextTiming) } }
        : {}),
      money,
      warnings,
    };

    const pricedByKey = new Map(pricing.lines.map((line) => [line.key, line]));
    for (const line of reduced) {
      const stored = lineById.get(line.lineId);
      if (!stored) continue;
      const cut = line.quantityBefore - line.quantityAfter;
      const priced = pricedByKey.get(pricingKeyForLine(line.lineId));
      const data: Record<string, unknown> = {};
      if (cut > 0) data.canceledQuantity = stored.canceledQuantity + cut;
      if (priced) Object.assign(data, moneyColumns(priced));
      if (Object.keys(data).length > 0) {
        await lines().update({ where: { id: line.lineId }, data });
      }
    }

    const cutoff = cutoffOf(branch.fulfillment, kind === 'appointment' ? 'pickup' : kind);
    const oldSlot = receive.timing?.mode === 'scheduled' ? (receive.timing.slot?.startsAt ?? null) : null;
    const oldDate = oldSlot
      ? receiveBusinessDate({
          placedAt: new Date(orderRow.placedAt),
          timezone: branch.timezone,
          cutoff,
          slotStartsAt: oldSlot,
        })
      : String(orderRow.businessDate).slice(0, 10);
    const newDate = resolvedTiming
      ? receiveBusinessDate({
          placedAt: now,
          timezone: branch.timezone,
          cutoff,
          slotStartsAt: resolvedTiming.mode === 'scheduled' ? resolvedTiming.slot.startsAt : null,
        })
      : oldDate;
    const dateChanged = newDate !== oldDate;

    for (const line of reduced) {
      const releaseQuantity = dateChanged ? line.quantityBefore : line.quantityBefore - line.quantityAfter;
      if (releaseQuantity > 0) await dailyStock.releaseForLine(trx, line.lineId, releaseQuantity);
    }

    const addedIds = new Map<number, number>();
    const positionBase = aggregate.lines.reduce((max, line) => Math.max(max, line.position), -1);
    for (const [index, line] of quoted.entries()) {
      const priced = pricedByKey.get(pricingKeyForAdded(index));
      if (!priced) {
        throw new OrderingError('INTERNAL', 'priced line is missing for an added item');
      }
      const created = await lines().create({
        data: {
          order: orderId,
          fulfillmentGroup: line.groupId,
          position: positionBase + 1 + index,
          sellableUid: line.sellable.ref.uid,
          sourceUid: line.sellable.ref.sourceUid ?? null,
          sourceDocumentId: line.sellable.ref.sourceDocumentId ?? null,
          productType: line.sellable.productType,
          variantUid: line.variantUid,
          sku: line.sellable.variant?.sku ?? null,
          titleSnapshot: line.sellable.title,
          descriptionSnapshot: line.sellable.description ?? null,
          imageUrlSnapshot: line.sellable.imageUrl ?? null,
          selectedOptionsSnapshot: describeSelectedOptions(line.sellable, line.selected),
          componentsSnapshot: bundleComponentsFromSellable(line.sellable, line.selected),
          categoriesSnapshot: line.sellable.categories,
          note: line.note,
          quantity: line.quantity,
          fulfilledQuantity: 0,
          returnedQuantity: 0,
          canceledQuantity: 0,
          addedInRevision: nextRevision,
          ...moneyColumns(priced),
          currency: pricing.currency,
        },
      });
      addedIds.set(index, created.id as number);
    }

    const reserveItems = [
      ...(dateChanged
        ? reduced.flatMap((line) => {
            if (line.quantityAfter <= 0) return [];
            const stored = lineById.get(line.lineId);
            if (!stored) return [];
            return stockTargetsForLine({
              sellableUid: stored.sellableUid,
              sourceDocumentId: stored.sourceDocumentId,
              variantUid: stored.variantUid,
              selected: selectedOf(stored.selectedOptionsSnapshot),
              quantity: line.quantityAfter,
            }).map((target) => reservationOf(line.lineId, target));
          })
        : []),
      ...quoted.flatMap((line, index) => {
        const lineId = addedIds.get(index);
        if (!lineId) return [];
        return stockTargetsForLine({
          sellableUid: line.sellable.ref.uid,
          sourceDocumentId: line.sellable.ref.sourceDocumentId,
          variantUid: line.variantUid,
          selected: line.selected,
          quantity: line.quantity,
        }).map((target) => reservationOf(lineId, target));
      }),
    ];
    if (reserveItems.length > 0) {
      await dailyStock.reserveInTransaction(trx, {
        orderId,
        locationRef: branch.code,
        businessDate: newDate,
        items: reserveItems,
      });
    }

    await rewriteAdjustments(orderId, aggregate, pricing.adjustments, addedIds);

    const nextReceive: Record<string, unknown> = { ...receive };
    if (resolvedTiming) nextReceive.timing = nextTiming;
    if (kind === 'delivery' && nextAddress) nextReceive.address = nextAddress;
    await repo.updateOrder(orderId, {
      subtotalAmount: pricing.totals.subtotal,
      adjustmentAmount: pricing.totals.adjustmentTotal,
      fulfillmentAmount: pricing.totals.fulfillmentTotal,
      taxAmount: pricing.totals.taxTotal,
      totalAmount: pricing.totals.grandTotal,
      cartHash: pricing.cartHash,
      receiveMethod: nextReceive,
      editRevision: nextRevision,
    });

    const primaryId = [...aggregate.groups].sort((left, right) => left.id - right.id)[0]?.id;
    for (const group of aggregate.groups) {
      await groups().update({
        where: { id: group.id },
        data: {
          receiveMethod: nextReceive,
          fulfillmentAmount: group.id === primaryId ? pricing.totals.fulfillmentTotal : 0,
          ...(resolvedTiming ? { estimatedReadyAt: resolvedTiming.readyAt.toISOString() } : {}),
        },
      });
    }
    if (kind === 'delivery' && delivery && nextAddress) {
      const fulfillment = (await strapi.db.query('plugin::ordering.fulfillment').findOne({
        where: { order: orderId },
      })) as { id: number; metadata: unknown } | null;
      if (fulfillment) {
        const metadata =
          fulfillment.metadata && typeof fulfillment.metadata === 'object' ? fulfillment.metadata : {};
        await strapi.db.query('plugin::ordering.fulfillment').update({
          where: { id: fulfillment.id },
          data: {
            addressSnapshot: nextAddress,
            metadata: { ...metadata, zoneCode: delivery.zoneCode, fee: pricing.totals.fulfillmentTotal },
          },
        });
      }
    }

    const beforeStarts = oldSlot;
    const afterStarts = !resolvedTiming
      ? beforeStarts
      : resolvedTiming.mode === 'scheduled'
        ? resolvedTiming.slot.startsAt
        : null;
    if (resolvedTiming && beforeStarts !== afterStarts) {
      if (beforeStarts) {
        for (const group of aggregate.groups) {
          await hold.releaseForGroup(group.id, 'order-edited', ctx);
        }
      }
      if (resolvedTiming.mode === 'scheduled' && primaryId !== undefined) {
        await scheduling.reserveInTransaction(
          trx,
          {
            orderId,
            groupId: primaryId,
            locationRef: branch.code,
            slot: resolvedTiming.slot,
            capacity: slotSettings.schedule.capacity,
          },
          ctx,
        );
      }
    }

    for (const leg of money.refunds) {
      await refund.createRefundInTransaction(
        trx,
        {
          paymentId: leg.paymentId,
          amount: leg.amount,
          reason,
          idempotencyKey: `order-edit:${orderId}:${nextRevision}:${leg.paymentId}`,
        },
        ctx,
      );
    }

    const onlinePayment = [...aggregate.payments]
      .filter(
        (row) => row.providerCode !== 'cash' && row.capturedAmount - row.refundedAmount > 0,
      )
      .sort((left, right) => left.id - right.id)[0];
    if (money.paymentLink) {
      if (!onlinePayment) {
        throw new OrderingError('INTERNAL', 'payment link was planned without an online capture');
      }
      const provider = registry.paymentProvider(onlinePayment.providerCode);
      if (!isOnlinePaymentProvider(provider) || !settings.paymentProviders.includes(onlinePayment.providerCode)) {
        throw new OrderingError('VALIDATION_ERROR', 'the captured provider cannot take an online top-up', {
          details: { providerCode: onlinePayment.providerCode },
        });
      }
      await payment.createPayment(
        { orderId, providerCode: onlinePayment.providerCode, amount: money.extraDue },
        ctx,
      );
    }
    await order.recomputeProjection(orderId);

    await timeline.record(
      {
        orderId,
        type: 'order.edited',
        isPublic: true,
        payload: {
          summary: 'Đơn đã được cập nhật',
          reason,
          revision: nextRevision,
          totalBefore: beforeTotals.total,
          totalAfter: afterTotals.total,
          fulfillmentBefore: beforeTotals.fulfillment,
          fulfillmentAfter: afterTotals.fulfillment,
          extraDue: money.extraDue,
          refundCash: money.refundCash,
          refundTransferPending: money.refundTransferPending,
          paymentLink: money.paymentLink,
          lines: preview.lines.map((line) => ({
            lineId: line.lineId ?? null,
            quantityBefore: line.quantityBefore,
            quantityAfter: line.quantityAfter,
            added: line.added,
          })),
        },
      },
      ctx,
    );
    await changeLog.record(
      {
        action: 'order.edit',
        entityType: 'order',
        entityId: orderId,
        locationRef: orderRow.locationRef,
        before: {
          revision: currentRevision,
          totalAmount: beforeTotals.total,
          fulfillmentAmount: beforeTotals.fulfillment,
        },
        after: {
          revision: nextRevision,
          totalAmount: afterTotals.total,
          fulfillmentAmount: afterTotals.fulfillment,
          reason,
        },
      },
      ctx,
    );
    await outbox.enqueue(
      {
        type: 'order.edited',
        aggregateType: 'order',
        aggregateId: String(orderId),
        payload: {
          orderId,
          code: orderRow.code,
          totalAmount: afterTotals.total,
          currency: orderRow.currency,
          locationRef: orderRow.locationRef,
          extraDue: money.extraDue,
          paymentLink: money.paymentLink,
          notifyCustomer,
        },
        uniqueKey: `order.edited:${orderId}:${nextRevision}`,
      },
      ctx,
    );
    if (persistLink && money.paymentLink && onlinePayment) {
      await paymentLink.issueForBalance(orderId, onlinePayment.providerCode, ctx);
    }
    return preview;
  };

  const quoteAdded = async (
    add: EditLineInput[],
    input: {
      registry: OrderingRegistry;
      kind: 'pickup' | 'delivery' | 'appointment';
      receive: StoredReceive;
      nextAddress: AddressSnapshot | null;
      locationRef: string;
      paymentTiming: string;
      locale: string;
      now: Date;
      openGroups: OrderAggregate['groups'];
    },
  ): Promise<QuotedAdd[]> => {
    const cfg = config();
    const catalog = input.registry.catalogAdapter(cfg.catalog.adapter);
    const adapterCtx = { now: input.now.toISOString(), locationRef: input.locationRef };
    const receiveMethod = receiveMethodFor(input.kind, input.locationRef, input.receive, input.nextAddress);
    const quoted: QuotedAdd[] = [];
    for (const [index, line] of add.entries()) {
      if (typeof line.sellableUid !== 'string' || line.sellableUid.length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'sellableUid is required', {
          details: { field: 'add', index },
        });
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new OrderingError('VALIDATION_ERROR', 'quantity must be a positive integer', {
          details: { field: 'add', index },
        });
      }
      if (line.note !== undefined && typeof line.note !== 'string') {
        throw new OrderingError('VALIDATION_ERROR', 'note must be a string', {
          details: { field: 'add', index },
        });
      }
      const selected = line.options ?? [];
      const sellable = await catalog.getSellable(adapterCtx, { uid: line.sellableUid }, { locale: input.locale });
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
      const productType = input.registry.productType(sellable.productType);
      const configuration = {
        sellable,
        selected,
        quantity: line.quantity,
        context: { locale: input.locale, locationRef: input.locationRef, at: input.now.toISOString() },
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
        receiveMethod,
        paymentTiming: input.paymentTiming,
      });
      const group = input.openGroups.find(
        (row) => row.workflowName === workflow.name && row.workflowVersion === workflow.version,
      );
      if (!group) {
        throw new OrderingError('MIXED_WORKFLOW_UNSUPPORTED', 'the added item uses another fulfillment workflow', {
          details: { workflow: `${workflow.name}@${workflow.version}` },
        });
      }
      const lineLeadTime = Number((sellable.metadata as JsonObject | undefined)?.leadTimeMinutes ?? 0);
      quoted.push({
        sellable,
        selected,
        quantity: line.quantity,
        note: line.note?.trim() ? line.note.trim() : null,
        variantUid: line.variantUid ?? sellable.variant?.uid ?? null,
        unitAmount: quote.unitAmount,
        optionAmount: quote.optionAmount,
        ...(quote.taxGroupRef || sellable.taxGroupRef
          ? { taxGroupRef: quote.taxGroupRef ?? sellable.taxGroupRef }
          : {}),
        leadTimeMinutes: Number.isFinite(lineLeadTime) ? lineLeadTime : 0,
        workflow,
        groupId: group.id,
      });
    }
    return quoted;
  };

  const deliveryFee = async (
    registry: OrderingRegistry,
    locationRef: string,
    kind: 'pickup' | 'delivery' | 'appointment',
    zones: Parameters<typeof quoteDelivery>[0],
    address: AddressSnapshot | null,
    merchandise: number,
  ): Promise<{ fee: number; zoneCode: string; extraLeadTimeMinutes: number; freeFrom: number | null } | null> => {
    if (kind !== 'delivery') return null;
    const communeCode = address?.wardCode ?? '';
    const provider = registry.fulfillmentProvider('self-delivery');
    const option = { communeCode, subtotal: merchandise };
    const orderRef = { locationRef, subtotalAmount: merchandise } as Order;
    const verdict = await provider.validate({
      order: orderRef,
      group: {} as FulfillmentGroup,
      option,
    });
    if (!verdict.valid) {
      const details = verdict.details ?? {};
      throw new OrderingError('DELIVERY_UNAVAILABLE', verdict.message, {
        details: {
          communeCode: typeof details.communeCode === 'string' ? details.communeCode : communeCode.trim().toUpperCase(),
          ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
          ...(details.minOrderAmount !== undefined ? { minOrderAmount: details.minOrderAmount } : {}),
        },
      });
    }
    const money = await provider.calculatePrice({ order: orderRef, group: {} as FulfillmentGroup, option });
    if (money.currency !== config().currency) {
      throw new OrderingError('CURRENCY_MISMATCH', 'delivery fee currency differs from config');
    }
    const quoted = quoteDelivery(zones, { communeCode, subtotal: merchandise });
    if (!quoted.available) {
      throw new OrderingError('DELIVERY_UNAVAILABLE', 'delivery is not available for this commune', {
        details: {
          communeCode: communeCode.trim().toUpperCase(),
          reason: quoted.reason,
          ...(quoted.minOrderAmount !== undefined ? { minOrderAmount: quoted.minOrderAmount } : {}),
        },
      });
    }
    if (quoted.fee !== money.amount) {
      throw new OrderingError('TOTALS_MISMATCH', 'delivery fee does not match the provider', {
        details: { communeCode: communeCode.trim().toUpperCase() },
      });
    }
    return {
      fee: money.amount,
      zoneCode: quoted.zoneCode,
      extraLeadTimeMinutes: quoted.extraLeadTimeMinutes,
      freeFrom: quoted.freeFrom,
    };
  };

  const pendingRefunds = async (trx: TransactionClient, paymentIds: number[]): Promise<Map<number, number>> => {
    const pending = new Map<number, number>();
    if (paymentIds.length === 0) return pending;
    const rows = (await trx('plugins_ordering_refund as refund')
      .join('plugins_ordering_refund_payment_lnk as link', 'link.refund_id', 'refund.id')
      .whereIn('link.payment_id', paymentIds)
      .where('refund.status', 'pending')
      .select('link.payment_id', 'refund.amount')) as Array<{ payment_id: number; amount: string | number }>;
    for (const row of rows) {
      const id = Number(row.payment_id);
      pending.set(id, (pending.get(id) ?? 0) + amountFromDb(row.amount));
    }
    return pending;
  };

  const rewriteAdjustments = async (
    orderId: number,
    aggregate: OrderAggregate,
    pricedAdjustments: Array<{
      kind: string;
      code: string;
      label: string;
      amount: number;
      taxable: boolean;
      priority: number;
      sourceRef?: string;
      ruleSnapshot?: Record<string, unknown>;
      allocations: Array<{ lineKey: string; weight: number; amount: number }>;
    }>,
    addedIds: Map<number, number>,
  ) => {
    const allocationIds = aggregate.adjustments.flatMap((row) => row.allocations.map((allocation) => allocation.id));
    if (allocationIds.length > 0) {
      await allocations().deleteMany({ where: { id: { $in: allocationIds } } });
    }
    const used = new Set<number>();
    const lineIdFor = (key: string): number => {
      if (key.startsWith('line:')) return Number(key.slice('line:'.length));
      const index = Number(key.slice('add:'.length));
      const lineId = addedIds.get(index);
      if (!lineId) throw new OrderingError('INTERNAL', 'added line id is missing for an allocation');
      return lineId;
    };
    for (const adjustment of pricedAdjustments) {
      const existing = aggregate.adjustments.find((row) => row.code === adjustment.code && !used.has(row.id));
      const data = {
        kind: adjustment.kind,
        code: adjustment.code,
        label: adjustment.label,
        sourceRef: adjustment.sourceRef ?? null,
        ruleSnapshot: adjustment.ruleSnapshot ?? null,
        amount: adjustment.amount,
        taxable: adjustment.taxable,
        priority: adjustment.priority,
      };
      const adjustmentId = existing
        ? existing.id
        : ((await adjustments().create({ data: { order: orderId, ...data } })).id as number);
      if (existing) {
        used.add(existing.id);
        await adjustments().update({ where: { id: existing.id }, data });
      }
      for (const allocation of adjustment.allocations) {
        await allocations().create({
          data: {
            adjustment: adjustmentId,
            line: lineIdFor(allocation.lineKey),
            weight: allocation.weight,
            amount: allocation.amount,
          },
        });
      }
    }
    for (const row of aggregate.adjustments) {
      if (!used.has(row.id)) await adjustments().delete({ where: { id: row.id } });
    }
  };

  return {
    /** Runs the edit and rolls every database write back. Does not seal a payment link. */
    async preview(orderId: number, input: EditInput, ctx: ServiceContext): Promise<EditPreview> {
      const rollback = new Error('ordering-edit-preview-rollback');
      let preview: EditPreview | null = null;
      try {
        await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          preview = await apply(trx, orderId, input, ctx, false);
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return preview as unknown as EditPreview;
    },

    /** Applies the edit. A balance payment link is sealed only after the money plan asks for one. */
    async edit(
      orderId: number,
      input: EditInput,
      ctx: ServiceContext,
    ): Promise<{ preview: EditPreview; order: OrderAggregate }> {
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const preview = await apply(trx, orderId, input, ctx, true);
        const order = await repo.loadOrderAggregate(orderId);
        if (!order) throw new OrderingError('INTERNAL', 'edited order could not be reloaded');
        return { preview, order };
      });
    },
  };
};

const receiveMethodFor = (
  kind: 'pickup' | 'delivery' | 'appointment',
  locationRef: string,
  receive: StoredReceive,
  address: AddressSnapshot | null,
): ReceiveMethod => {
  if (kind === 'delivery') {
    if (!address) {
      throw new OrderingError('VALIDATION_ERROR', 'delivery address is required', {
        details: { field: 'address' },
      });
    }
    return {
      kind: 'delivery',
      address,
      ...(receive.providerCode ? { providerCode: receive.providerCode } : {}),
    };
  }
  if (kind === 'appointment') return receive as ReceiveMethod;
  return { kind: 'pickup', locationRef };
};

const merchandiseOf = (existing: LineAfterReduce[], added: QuotedAdd[]): number => {
  const kept = existing.reduce(
    (sum, line) => sum + (line.unitAmount + line.optionAmount) * line.quantityAfter,
    0,
  );
  const extra = added.reduce((sum, line) => sum + (line.unitAmount + line.optionAmount) * line.quantity, 0);
  return kept + extra;
};

export default orderEdit;
