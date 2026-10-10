import { randomBytes, randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type {
  AdapterContext,
  JsonObject,
  ReceiveMethod,
  SelectedOptionInput,
  Sellable,
} from '../contracts';
import { businessDate } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import { formatOrderCode } from '../domain/order-code';
import { projectPaymentStatus } from '../domain/payment-status';
import { appliesCashRounding, type CashRoundingPolicy } from '../domain/pricing/cash-rounding';
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
import { actorRefOf, nowOf } from './context';
import type holdFactory from './hold';
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
    };
  };
  const repo = orderRepository({ strapi });
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

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
      const capturedAmount = payments.reduce(
        (sum, payment) => sum + Number(payment.capturedAmount),
        0,
      );
      const refundedAmount = payments.reduce(
        (sum, payment) => sum + Number(payment.refundedAmount),
        0,
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
      return { before, after };
    },

    async createOrder(input: CreateOrderInput, ctx: ServiceContext): Promise<CreateOrderResult> {
      const cfg = config();
      const { scope } = services();

      // Cheap validations before claiming the key; failures never consume it.
      if (input.consent.policyVersion !== cfg.consent.policyVersion) {
        throw new OrderingError('CONSENT_REQUIRED', 'consent policy version is not current', {
          details: { expected: cfg.consent.policyVersion },
        });
      }
      if (!input.contact.phone?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'contact.phone is required');
      }
      if ((input.customerNote?.length ?? 0) > MAX_CUSTOMER_NOTE) {
        throw new OrderingError('VALIDATION_ERROR', 'customerNote is too long', {
          details: { max: MAX_CUSTOMER_NOTE },
        });
      }
      if (input.lines.length === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'order needs at least one line');
      }

      const { idempotencyKey, ...payload } = input;
      const outcome = await services().idempotency.run(
        { scope: 'order.create', key: idempotencyKey, payload },
        ctx,
        async (trx) => {
          const { registry, timeline, hold, outbox } = services();

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

          const placedAt = input.placedAt ? new Date(input.placedAt) : nowOf(ctx);
          const locale = input.locale ?? cfg.catalog.defaultLocale;
          const adapterCtx: AdapterContext = {
            now: nowOf(ctx).toISOString(),
            locationRef: input.locationRef,
          };
          const catalog = registry.catalogAdapter(cfg.catalog.adapter);

          const priced: Array<{
            sellable: Sellable;
            key: string;
            quantity: number;
            unitAmount: number;
            optionAmount: number;
            taxGroupRef?: string;
            workflow: { name: string; version: string };
          }> = [];
          for (const [index, line] of input.lines.entries()) {
            const sellable = await catalog.getSellable(
              adapterCtx,
              { uid: line.sellableUid },
              { locale },
            );
            if (!sellable) {
              throw new OrderingError('SELLABLE_NOT_FOUND', 'sellable not found or inactive', {
                details: { lineIndex: index },
              });
            }
            const availability = await catalog.getAvailability(adapterCtx, sellable, line.quantity);
            if (!availability.available) {
              throw new OrderingError('SELLABLE_UNAVAILABLE', 'sellable is not available', {
                details: { lineIndex: index },
              });
            }
            const productType = registry.productType(sellable.productType);
            const configuration = {
              sellable,
              selected: line.selected ?? [],
              quantity: line.quantity,
              context: {
                locale,
                locationRef: input.locationRef,
                at: placedAt.toISOString(),
              },
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
            const branchMethod = branch.fulfillment?.[input.receiveMethod.kind] as
              | JsonObject
              | undefined;
            const paymentTiming = branchMethod?.paymentTiming as string | undefined;
            const workflow = productType.selectWorkflow({
              lines: [sellable],
              receiveMethod: input.receiveMethod,
              paymentTiming,
            });
            priced.push({
              sellable,
              key: String(index),
              quantity: line.quantity,
              unitAmount: quote.unitAmount,
              optionAmount: quote.optionAmount,
              taxGroupRef: quote.taxGroupRef ?? sellable.taxGroupRef,
              workflow,
            });
          }

          const cashRounding =
            branch.cashRounding &&
            appliesCashRounding(branch.cashRounding, input.payment?.providerCode)
              ? { multiple: branch.cashRounding.multiple }
              : null;
          const pricing = priceCart({
            currency: cfg.currency,
            lines: priced.map((line) => ({
              key: line.key,
              quantity: line.quantity,
              unitAmount: line.unitAmount,
              optionAmount: line.optionAmount,
              taxGroupRef: line.taxGroupRef,
            })),
            adjustments: input.adjustments ?? [],
            fulfillmentAmount: input.fulfillmentAmount ?? 0,
            tax: { ...cfg.tax, ...(branch.tax ?? {}) },
            at: placedAt.toISOString(),
            cashRounding,
          });
          if (input.expectedCartHash && input.expectedCartHash !== pricing.cartHash) {
            throw new OrderingError('PRICE_CHANGED', 'the quoted cart no longer matches', {
              details: { cartHash: pricing.cartHash },
            });
          }

          const groupsByWorkflow = new Map<string, { name: string; version: string }>();
          for (const line of priced) {
            const key = `${line.workflow.name}@${line.workflow.version}`;
            if (!groupsByWorkflow.has(key)) groupsByWorkflow.set(key, line.workflow);
          }
          if (groupsByWorkflow.size > 1 && !cfg.allowMixedProductTypes) {
            throw new OrderingError(
              'MIXED_WORKFLOW_UNSUPPORTED',
              'cart mixes fulfillment workflows',
              { details: { workflows: [...groupsByWorkflow.keys()] } },
            );
          }
          for (const workflow of groupsByWorkflow.values()) {
            registry.workflow(workflow.name, workflow.version);
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

          const order = await strapi.db.query('plugin::ordering.order').create({
            data: {
              code,
              publicTokenHash: sha256Hex(publicToken),
              status: input.origin.kind === 'staff-draft' ? 'draft' : 'open',
              paymentStatus: 'unpaid',
              fulfillmentStatus: 'not-started',
              subtotalAmount: pricing.totals.subtotal,
              adjustmentAmount: pricing.totals.adjustmentTotal,
              fulfillmentAmount: pricing.totals.fulfillmentTotal,
              taxAmount: pricing.totals.taxTotal,
              totalAmount: pricing.totals.grandTotal,
              currency: pricing.currency,
              contactSnapshot: {
                name: input.contact.name,
                phone: input.contact.phone,
                email: input.contact.email,
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
              branch: branch.id,
              locationRef: branch.code,
              branchSnapshot: { code: branch.code, name: branch.name },
              businessDate: businessDate(placedAt, branch.timezone, cutoffLocalTime),
              placedAt,
              receiveMethod: input.receiveMethod,
              origin: input.origin,
              cartHash: pricing.cartHash,
            },
          });
          const orderId = order.id as number;

          const groupIds = new Map<string, number>();
          let first = true;
          for (const [key, workflow] of groupsByWorkflow) {
            const definition = registry.workflow(workflow.name, workflow.version);
            const group = await strapi.db.query('plugin::ordering.fulfillment-group').create({
              data: {
                order: orderId,
                workflowName: workflow.name,
                workflowVersion: workflow.version,
                receiveMethod: input.receiveMethod,
                status: definition.initial,
                fulfillmentAmount: first ? pricing.totals.fulfillmentTotal : 0,
              },
            });
            groupIds.set(key, group.id as number);
            first = false;
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
                selectedOptionsSnapshot: input.lines[index].selected ?? [],
                componentsSnapshot: null,
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
        return { order: aggregate, publicToken: null, replayed: true };
      }
      const aggregate = await repo.loadOrderAggregate(outcome.result.orderId);
      if (!aggregate) {
        throw new OrderingError('INTERNAL', 'created order could not be reloaded');
      }
      return { order: aggregate, publicToken: outcome.result.publicToken, replayed: false };
    },

    /** Confirms a staff draft into the live flow. */
    async confirmDraft(orderId: number, ctx: ServiceContext): Promise<ProjectionChange> {
      return strapi.db.transaction(async () => {
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
