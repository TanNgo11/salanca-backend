import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { businessDate as businessDateOf } from '../domain/business-date';
import { normalizeKitchenStation } from '../../../shared/catalog/allergens';
import type { ServiceContext } from './context';
import type branchFactory from './branch';
import type registryFactory from './registry';
import type scopeFactory from './scope';
import type transitionFactory from './transition';
import type timelineFactory from './timeline';

type OrderRow = {
  id: number;
  code: string;
  status: string;
  placedAt: string;
  businessDate: string;
  customerNote: string | null;
  locationRef: string;
  receiveMethod: { kind?: string } | null;
};

type LineRow = {
  id: number;
  sellableUid: string;
  titleSnapshot: string;
  sku: string | null;
  quantity: number;
  canceledQuantity: number;
  selectedOptionsSnapshot: unknown;
  note: string | null;
  preparedAt: string | null;
};

type GroupRow = {
  id: number;
  status: string;
  workflowName: string;
  workflowVersion: string;
  estimatedReadyAt: string | null;
  kitchenStartedAt: string | null;
  updatedAt: string;
  order: OrderRow;
  lines: LineRow[];
};

/** Statuses a kitchen screen cares about; `ready` cards age out at the next business day. */
const BOARD_STATUSES = ['awaiting-acceptance', 'preparing', 'ready'] as const;

/**
 * O12 step 6 (screens N2): the kitchen display service. The board lists in-flight
 * fulfillment groups of one branch with per-line `preparedAt` state and the resolved
 * kitchen station (adapter `metadata.catalog.kitchenStation`, so re-assigning a
 * category updates open tickets). Mutations are staff-scope-checked like every other
 * admin path; "Xong cả đơn" is the workflow `ready` transition — a group already moved
 * by someone else answers 409.
 */
const kitchen = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const groups = () => strapi.db.query('plugin::ordering.fulfillment-group');
  const lines = () => strapi.db.query('plugin::ordering.order-line');
  const s = {
    branch: () => plugin().service('branch') as ReturnType<typeof branchFactory>,
    registry: () => plugin().service('registry') as ReturnType<typeof registryFactory>,
    scope: () => plugin().service('scope') as ReturnType<typeof scopeFactory>,
    timeline: () => plugin().service('timeline') as ReturnType<typeof timelineFactory>,
    transition: () => plugin().service('transition') as ReturnType<typeof transitionFactory>,
  };

  /** sellableUid → kitchenStation for every line on the board, one adapter call per uid. */
  const stationsOf = async (uids: string[], locationRef: string, timezone: string) => {
    const catalog = s.registry().catalogAdapter(strapi.config.get('plugin::ordering.catalog.adapter'));
    const adapterCtx = {
      now: new Date().toISOString(),
      locationRef,
      channel: 'staff',
      timezone,
    };
    const map = new Map<string, string>();
    await Promise.all(
      [...new Set(uids)].map(async (uid) => {
        const sellable = await catalog.getSellable(adapterCtx, { uid }, { locale: 'vi' });
        const station = normalizeKitchenStation(
          (sellable?.metadata?.catalog as { kitchenStation?: unknown } | undefined)?.kitchenStation,
        );
        map.set(uid, station ?? '');
      }),
    );
    return map;
  };

  /** Loads an order id + locationRef for a scoped mutation; 404 when missing or out of scope. */
  const scopedOrder = async (orderId: number, ctx: ServiceContext) => {
    const order = (await strapi.db.query('plugin::ordering.order').findOne({
      where: { id: orderId },
      select: ['id', 'locationRef'],
    })) as { id: number; locationRef: string } | null;
    if (!order) {
      throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { orderId } });
    }
    const scope = s.scope();
    scope.assertLocationInScope(await scope.loadScope(ctx), order.locationRef);
    return order;
  };

  return {
    async board(branch: string, station: string | undefined, ctx: ServiceContext) {
      const scope = s.scope();
      const staffScope = await scope.loadScope(ctx);
      scope.assertLocationInScope(staffScope, branch);
      const branchRow = await s.branch().findByCode(branch);
      if (!branchRow) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
          details: { branch },
        });
      }
      const timezone = branchRow.timezone ?? 'Asia/Ho_Chi_Minh';
      const pickupSettings = s.branch().pickupSettings(branchRow);
      const today = businessDateOf(
        new Date(),
        timezone,
        pickupSettings.schedule.businessDayPolicy.cutoffLocalTime,
      );
      const rows = (await groups().findMany({
        where: {
          order: { locationRef: branch },
          status: { $in: [...BOARD_STATUSES] },
        },
        populate: {
          order: {
            select: ['id', 'code', 'status', 'placedAt', 'businessDate', 'customerNote', 'locationRef', 'receiveMethod'],
          },
          lines: true,
        },
        orderBy: { id: 'asc' },
      })) as unknown as GroupRow[];

      const stations = await stationsOf(
        rows.flatMap((row) => (row.lines ?? []).map((line) => line.sellableUid)),
        branch,
        timezone,
      );
      const wanted = normalizeKitchenStation(station) ?? null;

      const orders = rows
        // Done cards only for the current business day — yesterday's stragglers stay out.
        .filter((row) => row.status !== 'ready' || row.order.businessDate === today)
        .map((row) => {
          const openLines = (row.lines ?? [])
            .filter((line) => line.quantity - line.canceledQuantity > 0)
            .map((line) => ({
              id: line.id,
              title: line.titleSnapshot,
              sku: line.sku,
              quantity: line.quantity - line.canceledQuantity,
              options: (line.selectedOptionsSnapshot as Array<{ groupName?: string; optionName?: string; quantity?: number }> | null) ?? [],
              note: line.note,
              station: stations.get(line.sellableUid) ?? '',
              preparedAt: line.preparedAt,
            }))
            .filter((line) => wanted === null || line.station === wanted);
          if (openLines.length === 0) return null;
          return {
            orderId: row.order.id,
            groupId: row.id,
            code: row.order.code,
            status: row.status,
            receiveKind: row.order.receiveMethod?.kind ?? 'pickup',
            placedAt: row.order.placedAt,
            kitchenStartedAt: row.kitchenStartedAt,
            finishedAt: row.status === 'ready' ? row.updatedAt : null,
            promisedAt: row.estimatedReadyAt,
            customerNote: row.order.customerNote,
            lines: openLines,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      return {
        branch,
        station: wanted,
        timezone,
        slaMinutes: pickupSettings.slaMinutes,
        businessDate: today,
        orders,
      };
    },

    async setLinePrepared(lineId: number, prepared: boolean, ctx: ServiceContext) {
      const line = (await lines().findOne({
        where: { id: lineId },
        populate: { order: { select: ['id', 'locationRef'] } },
      })) as (LineRow & { order: { id: number; locationRef: string } | null }) | null;
      if (!line?.order) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found', { details: { lineId } });
      }
      const scope = s.scope();
      scope.assertLocationInScope(await scope.loadScope(ctx), line.order.locationRef);
      const preparedAt = prepared ? new Date().toISOString() : null;
      await lines().update({ where: { id: lineId }, data: { preparedAt } });
      await s.timeline().record(
        {
          orderId: line.order.id,
          type: 'kitchen.line-prepared',
          isPublic: false,
          payload: { lineId, prepared },
        },
        ctx,
      );
      return { id: lineId, preparedAt };
    },

    /** "Bắt đầu" — stamps `kitchenStartedAt` once; idempotent when a board repeats it. */
    async startOrder(orderId: number, ctx: ServiceContext) {
      await scopedOrder(orderId, ctx);
      const group = (await groups().findOne({
        where: { order: orderId, status: { $in: ['awaiting-acceptance', 'preparing'] } },
      })) as { id: number; kitchenStartedAt: string | null } | null;
      if (!group) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order has no open fulfillment group', {
          details: { orderId },
        });
      }
      if (!group.kitchenStartedAt) {
        const at = new Date().toISOString();
        await groups().update({ where: { id: group.id }, data: { kitchenStartedAt: at } });
        await s.timeline().record(
          {
            orderId,
            type: 'kitchen.started',
            isPublic: false,
            payload: { groupId: group.id },
          },
          ctx,
        );
        group.kitchenStartedAt = at;
      }
      return { orderId, kitchenStartedAt: group.kitchenStartedAt };
    },

    async completeOrder(orderId: number, ctx: ServiceContext) {
      await scopedOrder(orderId, ctx);
      const live = (await groups().findMany({
        where: { order: orderId, status: { $in: [...BOARD_STATUSES] } },
      })) as Array<{ id: number; status: string }>;
      const group = live.find((row) => row.status === 'preparing') ?? live[0];
      if (!group) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order has no open fulfillment group', {
          details: { orderId },
        });
      }
      // `ready` only flows from `preparing` — the workflow edge itself returns 409 when the
      // group already moved (another screen/counter beat this board to it).
      return s.transition().transitionGroup(
        { orderId, groupId: group.id, to: 'ready', reason: 'kitchen-complete' },
        ctx,
      );
    },
  };
};

export default kitchen;
