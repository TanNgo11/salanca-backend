import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { Fulfillment } from '../contracts/entities';
import type { CarrierEndpoint, CarrierStatusEvent } from '../contracts/fulfillment';
import { OrderingError } from '../domain/errors';
import { payableTotal } from '../domain/payable';
import { paidAmounts } from '../domain/storefront/serialize';
import { isTerminal } from '../domain/workflow/transition';
import { endpointOf } from '../providers/ahamove/provider';
import orderRepository from '../repositories/order';
import type alertFactory from './alert';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type orderServiceFactory from './order';
import type { OrderingRegistry } from './registry';
import type transitionFactory from './transition';

type Services = {
  registry: OrderingRegistry;
  order: ReturnType<typeof orderServiceFactory>;
  branch: ReturnType<typeof branchFactory>;
  changeLog: ReturnType<typeof changeLogFactory>;
  transition: ReturnType<typeof transitionFactory>;
};

type FulfillmentRow = {
  id: number;
  order: number | { id: number };
  group: number | { id: number };
  providerCode: string;
  providerReference: string | null;
  status: string;
  addressSnapshot: Record<string, unknown> | null;
  trackingUrl: string | null;
  carrierStatus: string | null;
  carrierFee: number | null;
  metadata: Record<string, unknown> | null;
  assigneeRef: string | null;
};

type ProviderOperationRow = {
  id: number;
  operationKey: string;
  kind: 'carrier-book' | 'carrier-cancel';
  state: 'prepared' | 'dispatching' | 'succeeded' | 'rejected' | 'unknown' | 'resolved';
  providerCode: string;
  orderId: number;
  fulfillmentId: number;
  codAmount: string | number | null;
  serviceId: string | null;
  providerReference: string | null;
};

const ACTIVE_OPERATION_STATES = ['prepared', 'dispatching', 'unknown'] as const;

/**
 * How staff settle an operation after checking the provider by hand. A booking is either there
 * (`booked` — attach the trip) or it never existed (`not-created` — release the guard); a
 * cancellation either went through (`cancelled` — drop the reference) or the trip is still alive
 * (`still-booked` — the leg may be cancelled again).
 */
export const RECONCILE_OUTCOMES = ['booked', 'not-created', 'cancelled', 'still-booked'] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

const OUTCOMES_FOR_KIND: Record<
  ProviderOperationRow['kind'],
  readonly ReconcileOutcome[]
> = {
  'carrier-book': ['booked', 'not-created'],
  'carrier-cancel': ['cancelled', 'still-booked'],
};

/** Outcomes that prove an external side effect happened — the operation is `succeeded`. */
const RECONCILE_TERMINAL: readonly ReconcileOutcome[] = ['booked', 'cancelled'];

/**
 * O13 carrier legs ("Gọi xe", screens P2). Booking is a staff decision — order placement never
 * calls the carrier. A durable provider operation is committed before the outbound booking call;
 * a retry either returns the stored trip or stops for reconciliation when the result is uncertain.
 * Carrier pushes land via the signed webhook and move the leg through `transitionGroup` only —
 * a COMPLETED push on a COD order with money still due records the carrier status but leaves
 * the leg `out-for-delivery` until staff collect (same PAYMENT_REQUIRED rule as manual marks).
 */
const carrierAssignment = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      order: plugin.service('order') as Services['order'],
      branch: plugin.service('branch') as Services['branch'],
      changeLog: plugin.service('change-log') as Services['changeLog'],
      transition: plugin.service('transition') as Services['transition'],
    };
  };
  const fulfillments = () => strapi.db.query('plugin::ordering.fulfillment');
  const groups = () => strapi.db.query('plugin::ordering.fulfillment-group');
  const providerOperations = () => strapi.db.query('plugin::ordering.provider-operation');
  const alerts = () => strapi.plugin('ordering').service('alert') as ReturnType<typeof alertFactory>;
  const repo = orderRepository({ strapi });

  const activeCarrierOperation = (fulfillmentId: number, kind: 'carrier-book' | 'carrier-cancel') =>
    providerOperations().findOne({
      where: { fulfillmentId, kind, state: { $in: [...ACTIVE_OPERATION_STATES] } },
      orderBy: { id: 'desc' },
    }) as Promise<ProviderOperationRow | null>;

  const bookingUnknown = (operation: ProviderOperationRow): OrderingError =>
    new OrderingError('CARRIER_BOOKING_FAILED', 'the previous carrier booking needs reconciliation', {
      details: {
        reason: 'booking-unknown',
        operationKey: operation.operationKey,
        operationState: operation.state,
      },
    });

  const cancelUnknown = (operation: ProviderOperationRow): OrderingError =>
    new OrderingError('CARRIER_BOOKING_FAILED', 'the previous carrier cancellation needs reconciliation', {
      details: {
        reason: 'cancel-unknown',
        operationKey: operation.operationKey,
        operationState: operation.state,
      },
    });

  /**
   * The outbound call may have reached the provider while its result could not be stored. That
   * blocks a blind retry and pages Ops — the alert is raised even when the state update itself
   * fails, because a DB that is only intermittently reachable is exactly the dangerous case.
   */
  const markOperationUnknown = async (
    operation: Pick<ProviderOperationRow, 'id' | 'operationKey' | 'orderId'>,
    lastErrorCode: string,
    ctx: ServiceContext,
  ): Promise<void> => {
    try {
      await providerOperations().update({
        where: { id: operation.id, state: { $in: ['prepared', 'dispatching'] } },
        data: { state: 'unknown', lastErrorCode: lastErrorCode.slice(0, 100) },
      });
    } catch (error) {
      // The durable `dispatching` row was committed before HTTP. If the DB is still down, that
      // state remains sufficient to block a second booking when the DB becomes reachable.
      strapi.log.error(
        `[ordering] could not mark carrier operation ${operation.id} unknown: ${String((error as { code?: string }).code ?? 'db-error')}`,
      );
    }
    try {
      await alerts().noteCarrierOperationUnknown(
        { operationKey: operation.operationKey, orderId: operation.orderId },
        ctx,
      );
    } catch (error) {
      strapi.log.error(
        `[ordering] could not alert on carrier operation ${operation.id}: ${String((error as { code?: string }).code ?? 'db-error')}`,
      );
    }
  };

  const fulfillmentOf = (groupId: number) =>
    fulfillments().findOne({ where: { group: groupId } }) as Promise<FulfillmentRow | null>;

  /** The order's live delivery leg + its fulfillment row; out-of-scope loses inside getOrder. */
  const liveLeg = async (orderId: number, ctx: ServiceContext) => {
    const { order, registry } = services();
    const aggregate = await order.getOrder(orderId, ctx);
    const group =
      aggregate.groups.find(
        (candidate) =>
          (candidate.receiveMethod as { kind?: unknown } | null)?.kind === 'delivery' &&
          isTerminal(
            registry.workflow(candidate.workflowName, candidate.workflowVersion),
            candidate.status,
          ) === null,
      ) ?? null;
    const fulfillment = group ? await fulfillmentOf(Number(group.id)) : null;
    if (!group || !fulfillment) {
      throw new OrderingError('INVALID_TRANSITION', 'order has no active delivery group', {
        details: { orderId },
      });
    }
    return { aggregate, group, fulfillment };
  };

  /** The carrier that owns this leg: the booked provider, else the branch's configured carrier. */
  const carrierFor = async (orderId: number, fulfillment: FulfillmentRow, locationRef: string) => {
    const { registry, branch } = services();
    const code = fulfillment.providerCode ?? 'self-delivery';
    if (code !== 'self-delivery' && registry.hasFulfillmentProvider(code)) {
      return registry.fulfillmentProvider(code);
    }
    if (code === 'self-delivery') {
      const branchRow = await branch.findByCode(locationRef);
      const configured = branchRow ? branch.deliverySettings(branchRow).carrier : 'self-delivery';
      if (configured !== 'self-delivery' && registry.hasFulfillmentProvider(configured)) {
        return registry.fulfillmentProvider(configured);
      }
    }
    throw new OrderingError('CARRIER_NOT_CONFIGURED', 'no carrier is configured for this branch', {
      details: { orderId, locationRef },
    });
  };

  const pickupFor = async (locationRef: string): Promise<CarrierEndpoint> => {
    const { branch } = services();
    const row = await branch.findByCode(locationRef);
    if (!row?.address) {
      throw new OrderingError('CARRIER_NOT_CONFIGURED', 'branch has no pickup address', {
        details: { locationRef },
      });
    }
    return {
      ...endpointOf(row.address),
      name: (row.name?.vi as string | undefined) ?? row.code,
      ...(row.phone ? { phone: row.phone } : {}),
    };
  };

  const dropoffFor = (fulfillment: FulfillmentRow): CarrierEndpoint => {
    const endpoint = endpointOf(fulfillment.addressSnapshot ?? undefined);
    if (endpoint.address === '') {
      throw new OrderingError('CARRIER_BOOKING_FAILED', 'the delivery address is incomplete', {
        details: { reason: 'missing-address' },
      });
    }
    return endpoint;
  };

  const groupIdOf = (fulfillment: FulfillmentRow): number =>
    typeof fulfillment.group === 'object' ? fulfillment.group.id : fulfillment.group;

  /** Idempotent carrier-side result echo — what the row already knows about the trip. */
  const bookedView = (fulfillment: FulfillmentRow) => ({
    carrierRef: fulfillment.providerReference,
    carrierStatus: fulfillment.carrierStatus,
    trackingUrl: fulfillment.trackingUrl,
    carrierFee: fulfillment.carrierFee,
  });

  return {
    /** `POST /orders/:id/carrier/quote` — live carrier fee vs the customer fee (screens P2). */
    async carrierQuote(orderId: number, input: { serviceId?: string }, ctx: ServiceContext) {
      const { aggregate, fulfillment } = await liveLeg(orderId, ctx);
      if (fulfillment.providerReference) {
        throw new OrderingError('CARRIER_BOOKING_FAILED', 'a carrier trip is already booked', {
          details: { reason: 'already-booked' },
        });
      }
      const provider = await carrierFor(orderId, fulfillment, aggregate.order.locationRef ?? '');
      if (!provider.quoteCarrier) {
        throw new OrderingError('CARRIER_NOT_CONFIGURED', 'this provider cannot book trips', {
          details: { providerCode: provider.code },
        });
      }
      const due = paidAmounts(aggregate).due;
      const quotes = await provider.quoteCarrier({
        pickup: await pickupFor(aggregate.order.locationRef ?? ''),
        dropoff: dropoffFor(fulfillment),
        codAmount: due,
        ...(input.serviceId ? { option: { serviceId: input.serviceId } } : {}),
      });
      return {
        providerCode: provider.code,
        quotes,
        due,
        customerFee: aggregate.order.fulfillmentAmount,
      };
    },

    /**
     * Staff recovery after checking the provider by operation key/order remark. A booking is
     * settled with `booked` (attaches the confirmed trip) or `not-created` (releases the guard);
     * a cancellation with `cancelled` (the trip is gone) or `still-booked` (the trip is alive, so
     * the leg may be cancelled again). A reason is mandatory and audited.
     */
    async carrierReconcile(
      orderId: number,
      input: {
        operationKey: string;
        outcome: ReconcileOutcome;
        carrierRef?: string;
        carrierStatus?: string;
        reason: string;
      },
      ctx: ServiceContext,
    ) {
      await services().order.getOrder(orderId, ctx); // scope check before exposing operation state
      const operationKey = input.operationKey.trim();
      const reason = input.reason.trim();
      const carrierRef = input.carrierRef?.trim() ?? '';
      if (
        operationKey === '' ||
        reason === '' ||
        !RECONCILE_OUTCOMES.includes(input.outcome) ||
        (input.outcome === 'booked' && carrierRef === '')
      ) {
        throw new OrderingError('VALIDATION_ERROR', 'carrier reconciliation is incomplete', {
          details: { reason: 'reconcile-input' },
        });
      }
      return strapi.db.transaction(async ({ trx }) => {
        await repo.lockOrder(trx, orderId);
        const scannedOperation = (await providerOperations().findOne({
          where: {
            orderId,
            operationKey,
            state: { $in: [...ACTIVE_OPERATION_STATES] },
          },
        })) as ProviderOperationRow | null;
        if (!scannedOperation) {
          throw new OrderingError('CARRIER_BOOKING_FAILED', 'carrier operation is not reconcilable', {
            details: { reason: 'operation-not-active', operationKey },
          });
        }
        const scanned = (await fulfillments().findOne({
          where: { id: scannedOperation.fulfillmentId },
          populate: { group: { columns: ['id'] } },
        })) as FulfillmentRow | null;
        if (!scanned) {
          throw new OrderingError('ORDER_NOT_FOUND', 'carrier fulfillment disappeared', {
            details: { orderId, operationKey },
          });
        }
        const groupId = groupIdOf(scanned);
        await trx('plugins_ordering_fulfillment_group').where({ id: groupId }).forUpdate().first('id');
        await trx('plugins_ordering_fulfillment').where({ id: scanned.id }).forUpdate().first('id');
        await trx('plugins_ordering_provider_operation')
          .where({ id: scannedOperation.id })
          .forUpdate()
          .first('id');
        const locked = (await fulfillments().findOne({ where: { id: scanned.id } })) as FulfillmentRow | null;
        const operation = (await providerOperations().findOne({
          where: { id: scannedOperation.id, state: { $in: [...ACTIVE_OPERATION_STATES] } },
        })) as ProviderOperationRow | null;
        if (!locked || !operation) {
          throw new OrderingError('ORDER_NOT_FOUND', 'carrier fulfillment disappeared', {
            details: { orderId, operationKey },
          });
        }
        if (!OUTCOMES_FOR_KIND[operation.kind].includes(input.outcome)) {
          throw new OrderingError('VALIDATION_ERROR', 'reconcile outcome does not match the operation', {
            details: { reason: 'reconcile-kind-mismatch', kind: operation.kind, outcome: input.outcome },
          });
        }

        if (input.outcome === 'booked') {
          if (locked.providerReference && locked.providerReference !== carrierRef) {
            throw new OrderingError('CARRIER_BOOKING_FAILED', 'another carrier trip is already stored', {
              details: { reason: 'booking-conflict', operationKey },
            });
          }
          await fulfillments().update({
            where: { id: locked.id },
            data: {
              providerCode: operation.providerCode,
              providerReference: carrierRef,
              carrierStatus: input.carrierStatus?.slice(0, 100) || 'RECONCILED',
              metadata: {
                ...(locked.metadata ?? {}),
                carrier: {
                  bookedAt: nowOf(ctx).toISOString(),
                  codAmount: Number(operation.codAmount ?? 0),
                  ...(operation.serviceId ? { serviceId: operation.serviceId } : {}),
                  operationKey,
                  reconciled: true,
                },
              },
            },
          });
        } else if (input.outcome === 'cancelled') {
          // The provider confirms it dropped the trip: the leg keeps its own status but no longer
          // carries a live reference, exactly like a staff cancellation that succeeded outright.
          const trips = Array.isArray(locked.metadata?.carrierTrips)
            ? (locked.metadata.carrierTrips as unknown[])
            : [];
          await fulfillments().update({
            where: { id: locked.id },
            data: {
              providerReference: null,
              carrierStatus: null,
              carrierFee: null,
              trackingUrl: null,
              metadata: {
                ...(locked.metadata ?? {}),
                carrier: null,
                carrierTrips: [
                  ...trips,
                  {
                    carrierRef: operation.providerReference ?? locked.providerReference,
                    carrierStatus: 'CANCELLED',
                    reason: 'reconciled',
                    at: nowOf(ctx).toISOString(),
                  },
                ],
              },
            },
          });
        }
        await providerOperations().update({
          where: { id: operation.id },
          data: {
            state: RECONCILE_TERMINAL.includes(input.outcome) ? 'succeeded' : 'resolved',
            providerReference: input.outcome === 'booked' ? carrierRef : operation.providerReference,
            lastErrorCode: null,
            finishedAt: nowOf(ctx),
          },
        });
        await alerts().resolveCarrierOperation(operationKey, ctx);
        await services().changeLog.record(
          {
            action: 'carrier.reconcile',
            entityType: 'order',
            entityId: orderId,
            after: {
              operationKey,
              outcome: input.outcome,
              kind: operation.kind,
              ...(input.outcome === 'booked' ? { carrierRef } : {}),
              reason: reason.slice(0, 500),
            },
          },
          ctx,
        );
        return {
          operationKey,
          outcome: input.outcome,
          carrierRef: input.outcome === 'booked' ? carrierRef : null,
        };
      });
    },

    /**
     * `POST /orders/:id/carrier/book`. A committed operation guard prevents a second provider call
     * after an uncertain response or a failure while persisting the provider result.
     */
    async carrierBook(
      orderId: number,
      input: { serviceId?: string; note?: string; notifyCustomer?: boolean },
      ctx: ServiceContext,
    ) {
      const prepared = await strapi.db.transaction(async ({ trx }) => {
        const { group: scannedGroup, fulfillment } = await liveLeg(orderId, ctx);
        // Lock the GROUP row then the leg row — the same order the carrier webhook takes, so a
        // status push and a booking serialize. Everything that decides is re-read under the
        // locks, so a leg canceled between the scan and here is caught before the provider call
        // (O-05). Raw columns are snake_case; db.query maps them back to camelCase.
        const aggregate = await repo.lockOrderAndLoad(trx, orderId);
        if (!aggregate) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
        }
        const groupId = Number(scannedGroup.id);
        await trx('plugins_ordering_fulfillment_group').where({ id: groupId }).forUpdate().first('id');
        await trx('plugins_ordering_fulfillment').where({ id: fulfillment.id }).forUpdate().first('id');
        const locked = (await fulfillments().findOne({
          where: { id: fulfillment.id },
        })) as FulfillmentRow | null;
        if (!locked) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
        }
        if (locked.providerReference) {
          return { outcome: 'already-booked' as const, result: { alreadyBooked: true, ...bookedView(locked) } };
        }
        const active = await activeCarrierOperation(locked.id, 'carrier-book');
        if (active) {
          throw bookingUnknown(active);
        }
        const group = (await groups().findOne({ where: { id: groupId } })) as {
          id: number;
          status: string;
        } | null;
        if (!group || group.status !== 'ready') {
          throw new OrderingError('CARRIER_BOOKING_FAILED', 'the leg is no longer ready to book', {
            details: { reason: 'leg-not-ready', status: group?.status ?? null },
          });
        }
        const provider = await carrierFor(orderId, locked, aggregate.order.locationRef ?? '');
        if (!provider.book) {
          throw new OrderingError('CARRIER_NOT_CONFIGURED', 'this provider cannot book trips', {
            details: { providerCode: provider.code },
          });
        }
        // Serialize with wallet checkout (same lock as createWalletSession): once a trip that
        // collects cash is booked, the customer can no longer open a wallet session — Ahamove
        // cannot lower the COD of a booked SGN-BIKE trip. A session already pending is
        // cancelled; its late IPN lands in payment review.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`wallet-session:${aggregate.order.id}`]);
        const codAmount = paidAmounts(aggregate).due;
        if (codAmount > 0) {
          await trx('plugins_ordering_payment')
            .whereIn(
              'id',
              trx('plugins_ordering_payment_order_lnk').select('payment_id').where({ order_id: aggregate.order.id }),
            )
            .where('status', 'pending')
            .whereNotNull('session')
            .update({ status: 'cancelled', updated_at: nowOf(ctx) });
        }
        const operationKey = `carrier-book:${locked.id}:${randomUUID()}`;
        const operation = (await providerOperations().create({
          data: {
            operationKey,
            kind: 'carrier-book',
            state: 'dispatching',
            providerCode: provider.code,
            orderId: aggregate.order.id,
            fulfillmentId: locked.id,
            codAmount,
            serviceId: input.serviceId ?? null,
            attempts: 1,
            startedAt: nowOf(ctx),
          },
        })) as ProviderOperationRow;
        return {
          outcome: 'dispatch' as const,
          operation,
          provider,
          groupId,
          fulfillmentId: locked.id,
          orderCode: aggregate.order.code,
          request: {
            idempotencyKey: operationKey,
            pickup: await pickupFor(aggregate.order.locationRef ?? ''),
            dropoff: dropoffFor(locked),
            codAmount,
            ...(input.note ? { note: input.note.slice(0, 200) } : {}),
            remarks: aggregate.order.code,
            ...(input.serviceId ? { option: { serviceId: input.serviceId } } : {}),
          },
        };
      });

      if (prepared.outcome === 'already-booked') return prepared.result;

      let booking;
      try {
        booking = await prepared.provider.book!(prepared.request);
      } catch (error) {
        await markOperationUnknown(
          prepared.operation,
          String((error as { code?: string }).code ?? 'provider-call-uncertain'),
          ctx,
        );
        throw new OrderingError('CARRIER_BOOKING_FAILED', 'carrier booking result is unknown', {
          details: { reason: 'booking-unknown', operationKey: prepared.operation.operationKey },
          cause: error,
        });
      }

      try {
        return await strapi.db.transaction(async ({ trx }) => {
          await repo.lockOrder(trx, orderId);
          await trx('plugins_ordering_fulfillment_group')
            .where({ id: prepared.groupId })
            .forUpdate()
            .first('id');
          await trx('plugins_ordering_fulfillment')
            .where({ id: prepared.fulfillmentId })
            .forUpdate()
            .first('id');
          await trx('plugins_ordering_provider_operation')
            .where({ id: prepared.operation.id })
            .forUpdate()
            .first('id');
          const locked = (await fulfillments().findOne({
            where: { id: prepared.fulfillmentId },
          })) as FulfillmentRow | null;
          const operation = (await providerOperations().findOne({
            where: { id: prepared.operation.id },
          })) as ProviderOperationRow | null;
          if (!locked || !operation) {
            throw new OrderingError('ORDER_NOT_FOUND', 'carrier booking target disappeared', {
              details: { orderId, operationKey: prepared.operation.operationKey },
            });
          }
          if (operation.state !== 'dispatching') throw bookingUnknown(operation);
          if (locked.providerReference && locked.providerReference !== booking.carrierRef) {
            throw new OrderingError('CARRIER_BOOKING_FAILED', 'another carrier trip is already stored', {
              details: { reason: 'booking-conflict', operationKey: operation.operationKey },
            });
          }
          await fulfillments().update({
            where: { id: prepared.fulfillmentId },
            data: {
              providerCode: prepared.provider.code,
              providerReference: booking.carrierRef,
              carrierStatus: booking.carrierStatus ?? null,
              carrierFee: booking.carrierFee ?? null,
              trackingUrl: booking.trackingUrl ?? null,
              metadata: {
                ...(locked.metadata ?? {}),
                carrier: {
                  bookedAt: nowOf(ctx).toISOString(),
                  codAmount: prepared.request.codAmount,
                  ...(input.serviceId ? { serviceId: input.serviceId } : {}),
                  operationKey: prepared.operation.operationKey,
                },
              },
            },
          });
          await providerOperations().update({
            where: { id: prepared.operation.id },
            data: {
              state: 'succeeded',
              providerReference: booking.carrierRef,
              finishedAt: nowOf(ctx),
              lastErrorCode: null,
            },
          });
          await alerts().resolveCarrierOperation(prepared.operation.operationKey, ctx);
          await services().changeLog.record(
            {
              action: 'carrier.book',
              entityType: 'order',
              entityId: orderId,
              after: {
                providerCode: prepared.provider.code,
                carrierRef: booking.carrierRef,
                operationKey: prepared.operation.operationKey,
                ...(booking.carrierFee !== undefined ? { carrierFee: booking.carrierFee } : {}),
              },
            },
            ctx,
          );
          return { alreadyBooked: false, ...booking };
        });
      } catch (error) {
        await markOperationUnknown(prepared.operation, 'provider-result-not-persisted', ctx);
        throw error;
      }
    },

    /**
     * `POST /orders/:id/carrier/cancel` — only while the leg is still `ready` (pre-pickup).
     * Cancel mid-trip is a support flow on the carrier side; the leg moves `failed` via webhook.
     *
     * Same boundary as booking: the operation guard is committed before the outbound call, the
     * HTTP call runs outside the PostgreSQL transaction, and a result that cannot be stored keeps
     * the guard `unknown` so a retry never cancels (or re-cancels) on a guess.
     */
    async carrierCancel(orderId: number, input: { reason?: string }, ctx: ServiceContext) {
      const prepared = await strapi.db.transaction(async ({ trx }) => {
        const { group: scannedGroup, fulfillment } = await liveLeg(orderId, ctx);
        // Lock the group row then the leg row (same order as the webhook) and re-read both under
        // the locks: a trip that moved `out-for-delivery` after the scan is never canceled on a
        // stale `ready` (O-09).
        const aggregate = await repo.lockOrderAndLoad(trx, orderId);
        if (!aggregate) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
        }
        const groupId = Number(scannedGroup.id);
        await trx('plugins_ordering_fulfillment_group').where({ id: groupId }).forUpdate().first('id');
        await trx('plugins_ordering_fulfillment').where({ id: fulfillment.id }).forUpdate().first('id');
        const locked = (await fulfillments().findOne({
          where: { id: fulfillment.id },
        })) as FulfillmentRow | null;
        if (!locked) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
        }
        if (!locked.providerReference) return { outcome: 'nothing' as const };
        const active = await activeCarrierOperation(locked.id, 'carrier-cancel');
        if (active) throw cancelUnknown(active);
        const group = (await groups().findOne({ where: { id: groupId } })) as {
          id: number;
          status: string;
        } | null;
        if (!group || group.status !== 'ready') {
          throw new OrderingError('CARRIER_BOOKING_FAILED', 'the trip is already underway', {
            details: { reason: 'in-process', status: group?.status ?? null },
          });
        }
        const provider = services().registry.fulfillmentProvider(locked.providerCode);
        if (!provider.cancel) {
          throw new OrderingError('CARRIER_NOT_CONFIGURED', 'this provider cannot cancel trips', {
            details: { providerCode: provider.code },
          });
        }
        const operationKey = `carrier-cancel:${locked.id}:${randomUUID()}`;
        const operation = (await providerOperations().create({
          data: {
            operationKey,
            kind: 'carrier-cancel',
            state: 'dispatching',
            providerCode: provider.code,
            orderId: aggregate.order.id,
            fulfillmentId: locked.id,
            providerReference: locked.providerReference,
            attempts: 1,
            startedAt: nowOf(ctx),
          },
        })) as ProviderOperationRow;
        return {
          outcome: 'dispatch' as const,
          operation,
          provider,
          groupId,
          fulfillment: locked,
          carrierRef: locked.providerReference,
          request: {
            fulfillment: locked as unknown as Fulfillment,
            reason: (input.reason ?? 'staff-cancelled').slice(0, 200),
            idempotencyKey: operationKey,
          },
        };
      });

      if (prepared.outcome === 'nothing') return { cancelled: false };

      try {
        await prepared.provider.cancel!(prepared.request);
      } catch (error) {
        await markOperationUnknown(
          prepared.operation,
          String((error as { code?: string }).code ?? 'provider-call-uncertain'),
          ctx,
        );
        throw new OrderingError('CARRIER_BOOKING_FAILED', 'carrier cancellation result is unknown', {
          details: { reason: 'cancel-unknown', operationKey: prepared.operation.operationKey },
          cause: error,
        });
      }

      try {
        return await strapi.db.transaction(async ({ trx }) => {
          await repo.lockOrder(trx, orderId);
          await trx('plugins_ordering_fulfillment_group')
            .where({ id: prepared.groupId })
            .forUpdate()
            .first('id');
          await trx('plugins_ordering_fulfillment')
            .where({ id: prepared.fulfillment.id })
            .forUpdate()
            .first('id');
          await trx('plugins_ordering_provider_operation')
            .where({ id: prepared.operation.id })
            .forUpdate()
            .first('id');
          const locked = (await fulfillments().findOne({
            where: { id: prepared.fulfillment.id },
          })) as FulfillmentRow | null;
          const operation = (await providerOperations().findOne({
            where: { id: prepared.operation.id },
          })) as ProviderOperationRow | null;
          if (!locked || !operation) {
            throw new OrderingError('ORDER_NOT_FOUND', 'carrier cancellation target disappeared', {
              details: { orderId, operationKey: prepared.operation.operationKey },
            });
          }
          if (operation.state !== 'dispatching') throw cancelUnknown(operation);
          const trips = Array.isArray(locked.metadata?.carrierTrips)
            ? (locked.metadata.carrierTrips as unknown[])
            : [];
          await fulfillments().update({
            where: { id: locked.id },
            data: {
              providerReference: null,
              carrierStatus: null,
              carrierFee: null,
              trackingUrl: null,
              metadata: {
                ...(locked.metadata ?? {}),
                carrier: null,
                carrierTrips: [
                  ...trips,
                  {
                    carrierRef: prepared.carrierRef,
                    carrierStatus: 'CANCELLED',
                    reason: prepared.request.reason,
                    at: nowOf(ctx).toISOString(),
                  },
                ],
              },
            },
          });
          await providerOperations().update({
            where: { id: prepared.operation.id },
            data: { state: 'succeeded', finishedAt: nowOf(ctx), lastErrorCode: null },
          });
          await alerts().resolveCarrierOperation(prepared.operation.operationKey, ctx);
          await services().changeLog.record(
            {
              action: 'carrier.cancel',
              entityType: 'order',
              entityId: orderId,
              after: {
                providerCode: prepared.provider.code,
                carrierRef: prepared.carrierRef,
                reason: prepared.request.reason,
              },
            },
            ctx,
          );
          return { cancelled: true, carrierRef: prepared.carrierRef };
        });
      } catch (error) {
        await markOperationUnknown(prepared.operation, 'provider-result-not-persisted', ctx);
        throw error;
      }
    },

    /**
     * Carrier webhook (signed, dedupe on carrierStatus). Unknown refs and unknown statuses are
     * ACKed without touching anything — the carrier must not retry them.
     */
    async applyCarrierStatus(
      providerCode: string,
      event: CarrierStatusEvent,
      ctx: ServiceContext,
    ) {
      const found = (await fulfillments().findOne({
        where: { providerCode, providerReference: event.carrierRef },
        populate: { group: { columns: ['id'] } },
      })) as FulfillmentRow | null;
      if (!found) return { matched: false };
      // Parallel or retried pushes for one trip serialize here. Same lock order as the
      // transitions (group row, then leg row); everything is re-read under the locks.
      return strapi.db.transaction(async ({ trx }) => {
      await trx('plugins_ordering_fulfillment_group').where({ id: groupIdOf(found) }).forUpdate().first('id');
      await trx('plugins_ordering_fulfillment').where({ id: found.id }).forUpdate().first('id');
      const fulfillment = (await fulfillments().findOne({
        where: { id: found.id, providerCode, providerReference: event.carrierRef },
        populate: { group: { columns: ['id'] }, order: { columns: ['id'] } },
      })) as FulfillmentRow | null;
      if (!fulfillment) return { matched: false };
      if (fulfillment.carrierStatus === event.carrierStatus && event.status !== 'delivered') {
        return { matched: true, duplicate: true };
      }
      const groupId = groupIdOf(fulfillment);
      const group = (await strapi.db
        .query('plugin::ordering.fulfillment-group')
        .findOne({ where: { id: groupId } })) as {
        id: number;
        status: string;
      } | null;
      if (!group) return { matched: false };
      const orderId =
        typeof fulfillment.order === 'object'
          ? (fulfillment.order as { id: number }).id
          : Number(fulfillment.order);

      const patch: Record<string, unknown> = {
        carrierStatus: event.carrierStatus ?? event.status,
        ...(event.trackingUrl ? { trackingUrl: event.trackingUrl } : {}),
        ...(event.carrierFee !== undefined ? { carrierFee: event.carrierFee } : {}),
      };
      const metadata: Record<string, unknown> = { ...(fulfillment.metadata ?? {}) };
      if (event.driver) metadata.carrierDriver = event.driver;

      const transition = services().transition;
      const notify = false; // customer notifications come from the public leg states
      switch (event.status) {
        case 'searching':
        case 'booked':
          break; // searching/booked keeps the leg `ready` — only carrier fields move
        case 'in-process':
          if (group.status === 'ready') {
            await transition.transitionGroup(
              {
                orderId,
                groupId,
                to: 'out-for-delivery',
                notifyCustomer: notify || undefined,
                payload: { carrier: providerCode, carrierRef: event.carrierRef },
              },
              ctx,
            );
            patch.status = 'out-for-delivery';
            patch.shippedAt = nowOf(ctx);
          }
          break;
        case 'delivered': {
          if (group.status !== 'out-for-delivery') break;
          const aggregate = await services().order.getOrder(orderId, ctx);
          if (paidAmounts(aggregate).due > 0) {
            // COD leg: the courier delivered but money is still due — staff collect, then press
            // delivered themselves (same PAYMENT_REQUIRED rule as a manual mark).
            metadata.awaitingCollection = nowOf(ctx).toISOString();
            break;
          }
          const carrier = metadata.carrier as { codAmount?: unknown } | null | undefined;
          const bookedCod = Number(carrier?.codAmount ?? 0);
          const paidNonCash = aggregate.payments
            .filter((payment) => payment.providerCode !== 'cash')
            .reduce((sum, payment) => sum + payment.capturedAmount - payment.refundedAmount, 0);
          if (bookedCod > 0 && paidNonCash + bookedCod > payableTotal(aggregate.order) && !metadata.codConflict) {
            // Booked to collect cash, but part of it was paid another way meanwhile (e.g. a bank
            // transfer): the courier may have collected twice — flag it for staff to refund.
            metadata.codConflict = { codAmount: bookedCod, at: nowOf(ctx).toISOString() };
            await services().changeLog.record(
              {
                action: 'carrier.cod-conflict',
                entityType: 'order',
                entityId: orderId,
                after: { providerCode, carrierRef: event.carrierRef, codAmount: bookedCod },
              },
              ctx,
            );
          }
          await transition.transitionGroup(
            {
              orderId,
              groupId,
              to: 'delivered',
              payload: { carrier: providerCode, carrierRef: event.carrierRef },
            },
            ctx,
          );
          patch.status = 'delivered';
          patch.deliveredAt = nowOf(ctx);
          break;
        }
        case 'cancelled':
        case 'failed': {
          const trips = Array.isArray(metadata.carrierTrips) ? (metadata.carrierTrips as unknown[]) : [];
          metadata.carrierTrips = [
            ...trips,
            {
              carrierRef: event.carrierRef,
              carrierStatus: event.carrierStatus ?? event.status,
              ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
              at: nowOf(ctx).toISOString(),
            },
          ];
          if (group.status === 'ready') {
            // Pre-pickup cancel: clear the trip so staff can book again or self-deliver.
            patch.providerReference = null;
            patch.carrierStatus = null;
            patch.carrierFee = null;
            patch.trackingUrl = null;
            metadata.carrier = null;
            delete metadata.carrierDriver;
          } else if (group.status === 'out-for-delivery') {
            await transition.transitionGroup(
              {
                orderId,
                groupId,
                to: 'failed',
                reason: event.status === 'cancelled' ? 'carrier-cancelled' : 'carrier-failed',
                payload: {
                  carrier: providerCode,
                  carrierRef: event.carrierRef,
                  ...(event.reasonCode ? { carrierReason: event.reasonCode } : {}),
                },
              },
              ctx,
            );
            patch.status = 'failed';
            metadata.lastFailure = {
              reasonCode: event.status === 'cancelled' ? 'carrier-cancelled' : 'carrier-failed',
              at: nowOf(ctx).toISOString(),
            };
          }
          break;
        }
      }
      await fulfillments().update({
        where: { id: fulfillment.id },
        data: { ...patch, metadata },
      });
      return { matched: true, duplicate: false, orderId };
      });
    },
  };
};

export default carrierAssignment;
