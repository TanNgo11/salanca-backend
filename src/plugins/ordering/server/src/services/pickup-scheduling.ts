import type { Core } from '@strapi/strapi';

import type { PickupSettings } from '../domain/branch-settings';
import { OrderingError } from '../domain/errors';
import {
  asapReadyAt,
  checkSlot,
  listSlots,
  slotResourceRef,
  type Slot,
} from '../domain/scheduling/slots';
import { addDays, localToUtc } from '../domain/scheduling/zoned-time';
import type { TransactionClient } from '../migrations/runner';
import type { ServiceContext } from './context';
import { nowOf } from './context';

export type PickupTimingInput = { asap?: boolean; slot?: { startsAt?: string } | null };

export type PickupTiming =
  | { mode: 'asap'; readyAt: Date }
  | { mode: 'scheduled'; slot: Slot; readyAt: Date };

type BranchLike = { code: string; timezone: string };

/**
 * Pickup scheduling (contracts §9, §19.5; plan step 2). Slot occupancy is the set of open holds
 * on `slot:<branch>:pickup:<startsAt>`; reserving takes a transaction-scoped advisory lock on
 * that key before counting, so two orders racing for the last seat serialize and one gets
 * `SLOT_FULL`. Holds of pay-on-pickup orders live until the slot ends (then the expiry job
 * releases them) and are released early when the order is canceled.
 */
const pickupScheduling = ({ strapi }: { strapi: Core.Strapi }) => {
  const holds = () => strapi.db.query('plugin::ordering.hold');

  const bookedBetween = async (
    locationRef: string,
    from: Date,
    to: Date,
    now: Date,
  ): Promise<Record<string, number>> => {
    const rows = (await holds().findMany({
      where: {
        resourceRef: { $startsWith: `slot:${locationRef}:pickup:` },
        releasedAt: null,
        expiresAt: { $gt: now },
      },
      select: ['resourceRef', 'quantity'],
    })) as Array<{ resourceRef: string; quantity: number }>;
    const booked: Record<string, number> = {};
    for (const row of rows) {
      const startsAt = row.resourceRef.split(':pickup:')[1];
      const instant = new Date(startsAt).getTime();
      if (instant < from.getTime() || instant > to.getTime()) continue;
      booked[startsAt] = (booked[startsAt] ?? 0) + row.quantity;
    }
    return booked;
  };

  const service = {
    /** Effective lead time: the larger of the branch policy and any line's own lead time. */
    leadTimeFor(settings: PickupSettings, lineLeadTimes: number[] = []): number {
      return Math.max(settings.schedule.leadTimeMinutes, ...lineLeadTimes.filter(Number.isFinite));
    },

    async listSlots(input: {
      branch: BranchLike;
      settings: PickupSettings;
      date: string;
      leadTimeMinutes: number;
      now: Date;
    }): Promise<Slot[]> {
      const from = localToUtc(addDays(input.date, -1), '00:00', input.branch.timezone);
      const to = localToUtc(addDays(input.date, 2), '00:00', input.branch.timezone);
      const booked = await bookedBetween(input.branch.code, from, to, input.now);
      return listSlots({
        settings: input.settings,
        timezone: input.branch.timezone,
        now: input.now,
        date: input.date,
        leadTimeMinutes: input.leadTimeMinutes,
        booked,
      });
    },

    /**
     * Resolves the requested pickup time against the branch rules (quote and create both call
     * it; the server never trusts the client's lead-time math).
     */
    async resolveTiming(input: {
      branch: BranchLike;
      settings: PickupSettings;
      request: PickupTimingInput;
      leadTimeMinutes: number;
      now: Date;
    }): Promise<PickupTiming> {
      const { branch, settings, request, leadTimeMinutes, now } = input;
      const startsAt = request.slot?.startsAt;
      if (!startsAt) {
        if (settings.orderTiming === 'scheduled') {
          throw new OrderingError('SLOT_UNAVAILABLE', 'this branch only takes scheduled pickups', {
            details: { reason: 'slot-required' },
          });
        }
        const readyAt = asapReadyAt(settings, branch.timezone, now, leadTimeMinutes);
        if (!readyAt) {
          throw new OrderingError('ASAP_UNAVAILABLE', 'the branch cannot take ASAP orders now');
        }
        return { mode: 'asap', readyAt };
      }
      if (settings.orderTiming === 'asap') {
        throw new OrderingError('SLOT_UNAVAILABLE', 'this branch only takes ASAP pickups', {
          details: { reason: 'asap-only' },
        });
      }
      const requested = new Date(startsAt);
      const booked = Number.isFinite(requested.getTime())
        ? await bookedBetween(
            branch.code,
            new Date(requested.getTime() - 1),
            new Date(requested.getTime() + 1),
            now,
          )
        : {};
      const result = checkSlot({
        settings,
        timezone: branch.timezone,
        now,
        leadTimeMinutes,
        startsAt,
        booked,
      });
      if (!result.ok) {
        throw new OrderingError(result.code, 'the requested pickup slot is not available', {
          details: result.earliest ? { earliest: result.earliest } : {},
        });
      }
      return { mode: 'scheduled', slot: result.slot, readyAt: new Date(result.slot.startsAt) };
    },

    /**
     * Seats one order in a slot inside the caller's transaction. The advisory lock is released at
     * commit/rollback; the recount after the lock is what makes the last seat exclusive.
     */
    async reserveInTransaction(
      trx: TransactionClient,
      input: { orderId: number; groupId?: number; locationRef: string; slot: Slot; capacity: number },
      ctx: ServiceContext,
    ): Promise<void> {
      const resourceRef = slotResourceRef(input.locationRef, input.slot.startsAt);
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [resourceRef]);
      const rows = (await holds().findMany({
        where: { resourceRef, releasedAt: null, expiresAt: { $gt: nowOf(ctx) } },
        select: ['quantity'],
      })) as Array<{ quantity: number }>;
      const taken = rows.reduce((sum, row) => sum + row.quantity, 0);
      if (taken + 1 > input.capacity) {
        throw new OrderingError('SLOT_FULL', 'the requested pickup slot is full', {
          details: { startsAt: input.slot.startsAt },
        });
      }
      await holds().create({
        data: {
          order: input.orderId,
          group: input.groupId ?? null,
          resourceRef,
          quantity: 1,
          expiresAt: new Date(input.slot.endsAt),
        },
      });
    },
  };
  return service;
};

export default pickupScheduling;
