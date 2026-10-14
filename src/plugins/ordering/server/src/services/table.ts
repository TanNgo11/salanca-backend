import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { businessDate as businessDateOf } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import { qrSvg } from '../domain/qr';
import { paidAmounts } from '../domain/storefront/serialize';
import { isTerminal } from '../domain/workflow/transition';
import type { OrderingConfig } from '../config';
import type { TransactionClient } from '../migrations/runner';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type orderServiceFactory from './order';
import type { OrderAggregate } from '../repositories/types';
import type paymentFactory from './payment';
import type paymentMatchingFactory from './payment-matching';
import type scopeFactory from './scope';
import type transitionFactory from './transition';
import type { OrderingRegistry } from './registry';

/**
 * O12 step 7 (screens N6–N7): dining tables and table sessions. A table's QR secret is
 * generated at create/rotate — only the sha256 hash is stored, so a leaked table list cannot
 * place orders; the full link lives in `qrUrl` purely for staff reprints (rotate revokes both).
 * Sessions open when the first dine-in order lands on a table (one open session per table,
 * enforced by the table-row FOR UPDATE lock plus the `open_table_id` unique index) and close from
 * "Thanh toán & đóng bàn": the closer collects each order's outstanding (cash capture, or a
 * witnessed counter transfer recorded like a manual SePay payment) and every live group moves
 * `served → completed`. Nothing is auto-collected at day end — the autoclose job only alerts.
 */

export type TableRow = {
  id: number;
  locationRef: string;
  code: string;
  name: string;
  area: string | null;
  seats: number | null;
  qrTokenHash: string;
  qrUrl: string | null;
  active: boolean;
};

export type TableSessionRow = {
  id: number;
  table: number;
  locationRef: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  businessDate: string;
};

const TABLE_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;
const CLOSE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]{3,40}$/;

const invalid = (field: string, message: string): OrderingError =>
  new OrderingError('VALIDATION_ERROR', message, { details: { field } });

const tableService = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const tables = () => strapi.db.query('plugin::ordering.dining-table');
  const sessions = () => strapi.db.query('plugin::ordering.table-session');
  const s = {
    branch: () => plugin().service('branch') as ReturnType<typeof branchFactory>,
    changeLog: () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>,
    matching: () => plugin().service('payment-matching') as ReturnType<typeof paymentMatchingFactory>,
    order: () => plugin().service('order') as ReturnType<typeof orderServiceFactory>,
    payment: () => plugin().service('payment') as ReturnType<typeof paymentFactory>,
    registry: () => plugin().service('registry') as OrderingRegistry,
    scope: () => plugin().service('scope') as ReturnType<typeof scopeFactory>,
    transition: () => plugin().service('transition') as ReturnType<typeof transitionFactory>,
  };
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  /** 256-bit bearer token — scannable, unguessable; only the hash is persisted. */
  const newToken = (): string => randomBytes(32).toString('base64url');

  const menuUrl = (token: string): string => {
    const template = config().tables.menuUrlTemplate;
    if (!template.includes('{token}')) {
      throw new OrderingError('CONFIG_INVALID', 'tables.menuUrlTemplate has no token placeholder');
    }
    return template.replace('{token}', token);
  };

  const assertScope = async (locationRef: string, ctx: ServiceContext): Promise<void> => {
    const scope = s.scope();
    scope.assertLocationInScope(await scope.loadScope(ctx), locationRef);
  };

  /** Table for an admin mutation; 404 when missing or out of the caller's scope. */
  const scopedTable = async (id: number, ctx: ServiceContext): Promise<TableRow> => {
    const row = (await tables().findOne({ where: { id } })) as TableRow | null;
    if (!row) {
      throw new OrderingError('TABLE_NOT_FOUND', 'table not found', { details: { tableId: id } });
    }
    await assertScope(row.locationRef, ctx);
    return row;
  };

  const serialize = (row: TableRow) => ({
    id: row.id,
    locationRef: row.locationRef,
    code: row.code,
    name: row.name,
    area: row.area,
    seats: row.seats,
    active: row.active,
    qrUrl: row.qrUrl,
  });

  /** Change-log snapshot: never the QR link — it carries the live table token. */
  const logged = (row: TableRow) => {
    const { qrUrl: _qrUrl, ...rest } = serialize(row);
    return rest;
  };

  const createWithToken = async (
    data: Omit<TableRow, 'id' | 'qrTokenHash' | 'qrUrl'>,
    ctx: ServiceContext,
  ): Promise<TableRow> => {
    const token = newToken();
    const row = (await tables().create({
      data: { ...data, qrTokenHash: sha256Hex(token), qrUrl: menuUrl(token) },
    })) as TableRow;
    await s.changeLog().record(
      {
        action: 'dining-table.create',
        entityType: 'dining-table',
        entityId: row.id,
        entityLabel: `${row.code} · ${row.name}`,
        locationRef: row.locationRef,
        after: logged(row),
      },
      ctx,
    );
    return row;
  };

  return {
    /** Public + prepareOrder lookup: the QR secret resolves only to an active table. */
    async resolveByToken(token: string, locationRef?: string): Promise<TableRow | null> {
      const row = (await tables().findOne({
        where: { qrTokenHash: sha256Hex(token), ...(locationRef ? { locationRef } : {}) },
      })) as TableRow | null;
      return row?.active ? row : null;
    },

    async list(ctx: ServiceContext, branch?: string) {
      const scope = s.scope();
      const staffScope = await scope.loadScope(ctx);
      const rows = (await tables().findMany({
        where: branch ? { locationRef: branch } : {},
        orderBy: { locationRef: 'asc', code: 'asc' },
      })) as TableRow[];
      return {
        items: rows
          .filter((row) => branch === undefined || row.locationRef === branch)
          .filter((row) => {
            if (!staffScope) return true;
            try {
              scope.assertLocationInScope(staffScope, row.locationRef);
              return true;
            } catch {
              return false;
            }
          })
          .map(serialize),
      };
    },

    async create(
      input: { locationRef?: unknown; code?: unknown; name?: unknown; area?: unknown; seats?: unknown },
      ctx: ServiceContext,
    ) {
      const locationRef = typeof input.locationRef === 'string' ? input.locationRef.trim() : '';
      const branch = await s.branch().findByCode(locationRef);
      if (!branch) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
          details: { locationRef },
        });
      }
      await assertScope(branch.code, ctx);
      const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      if (!TABLE_CODE.test(code)) throw invalid('code', 'code must be 1–16 letters, digits or hyphens');
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 80) throw invalid('name', 'name is required (max 80 characters)');
      const area = input.area === undefined || input.area === null ? null : String(input.area).trim() || null;
      if (area && area.length > 80) throw invalid('area', 'area is too long');
      const seats =
        input.seats === undefined || input.seats === null || input.seats === ''
          ? null
          : Number(input.seats);
      if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 500)) {
        throw invalid('seats', 'seats must be an integer between 1 and 500');
      }
      try {
        const row = await createWithToken(
          { locationRef: branch.code, code, name, area, seats, active: true },
          ctx,
        );
        return { item: serialize(row) };
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw invalid('code', `table code "${code}" already exists at this branch`);
        }
        throw error;
      }
    },

    /**
     * Bulk-create `B<from>` … `B<to>` in one request ("Thêm nhiều bàn"). Each table gets its
     * own token; a duplicate code aborts the batch with the failing code named.
     */
    async createMany(
      input: { locationRef?: unknown; prefix?: unknown; from?: unknown; to?: unknown; area?: unknown; seats?: unknown },
      ctx: ServiceContext,
    ) {
      const locationRef = typeof input.locationRef === 'string' ? input.locationRef.trim() : '';
      const branch = await s.branch().findByCode(locationRef);
      if (!branch) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found or inactive', {
          details: { locationRef },
        });
      }
      await assertScope(branch.code, ctx);
      const prefix = typeof input.prefix === 'string' ? input.prefix.trim() : 'B';
      if (!/^[A-Za-z]{0,8}$/.test(prefix)) throw invalid('prefix', 'prefix must be letters only');
      const from = Number(input.from);
      const to = Number(input.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 99) {
        throw invalid('to', 'range must be 1 ≤ from ≤ to and at most 100 tables');
      }
      const area = input.area === undefined || input.area === null ? null : String(input.area).trim() || null;
      const seats =
        input.seats === undefined || input.seats === null || input.seats === ''
          ? null
          : Number(input.seats);
      if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 500)) {
        throw invalid('seats', 'seats must be an integer between 1 and 500');
      }
      const created: Array<ReturnType<typeof serialize>> = [];
      for (let n = from; n <= to; n += 1) {
        const code = `${prefix}${n}`;
        try {
          const row = await createWithToken(
            { locationRef: branch.code, code, name: `Bàn ${code}`, area, seats, active: true },
            ctx,
          );
          created.push(serialize(row));
        } catch (error) {
          if ((error as { code?: string }).code === '23505') {
            throw invalid('from', `table code "${code}" already exists at this branch`);
          }
          throw error;
        }
      }
      return { items: created };
    },

    async update(
      id: number,
      input: { name?: unknown; area?: unknown; seats?: unknown; active?: unknown; code?: unknown },
      ctx: ServiceContext,
    ) {
      const row = await scopedTable(id, ctx);
      const next: Partial<TableRow> = {};
      if (input.name !== undefined) {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 80) throw invalid('name', 'name is required (max 80 characters)');
        next.name = name;
      }
      if (input.area !== undefined) {
        const area = input.area === null ? null : String(input.area).trim() || null;
        if (area && area.length > 80) throw invalid('area', 'area is too long');
        next.area = area;
      }
      if (input.seats !== undefined) {
        const seats = input.seats === null || input.seats === '' ? null : Number(input.seats);
        if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 500)) {
          throw invalid('seats', 'seats must be an integer between 1 and 500');
        }
        next.seats = seats;
      }
      if (input.active !== undefined) {
        if (typeof input.active !== 'boolean') throw invalid('active', 'active must be a boolean');
        next.active = input.active;
      }
      if (input.code !== undefined) {
        const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
        if (!TABLE_CODE.test(code)) throw invalid('code', 'code must be 1–16 letters, digits or hyphens');
        next.code = code;
      }
      const updated = (await tables().update({ where: { id: row.id }, data: next })) as TableRow;
      await s.changeLog().record(
        {
          action: 'dining-table.update',
          entityType: 'dining-table',
          entityId: row.id,
          entityLabel: `${updated.code} · ${updated.name}`,
          locationRef: row.locationRef,
          before: logged(row),
          after: logged(updated),
        },
        ctx,
      );
      return { item: serialize(updated) };
    },

    /** New secret + URL; the old QR dies the moment this commits. */
    async rotateQr(id: number, ctx: ServiceContext) {
      const row = await scopedTable(id, ctx);
      const token = newToken();
      const updated = (await tables().update({
        where: { id: row.id },
        data: { qrTokenHash: sha256Hex(token), qrUrl: menuUrl(token) },
      })) as TableRow;
      await s.changeLog().record(
        {
          action: 'dining-table.rotate-qr',
          entityType: 'dining-table',
          entityId: row.id,
          entityLabel: `${row.code} · ${row.name}`,
          locationRef: row.locationRef,
          after: { tableId: row.id, code: row.code },
        },
        ctx,
      );
      return { item: serialize(updated) };
    },

    /** `GET /tables/:id/qr.svg` — the stored link encoded by the built-in QR encoder. */
    async qrSvg(id: number, ctx: ServiceContext): Promise<{ svg: string; url: string }> {
      const row = await scopedTable(id, ctx);
      const url = row.qrUrl;
      const svg = url ? qrSvg(url) : null;
      if (!url || !svg) {
        throw new OrderingError('TABLE_NOT_FOUND', 'table has no QR link', {
          details: { tableId: id },
        });
      }
      return { svg, url };
    },

    /**
     * Finds the open session for a table or creates it. Runs inside the order-create
     * transaction: the table row lock serializes two simultaneous first orders so exactly one
     * session comes out. `open_table_id` mirrors the lnk join for the UNIQUE backstop — a
     * second insert that somehow raced the lock fails the index instead of opening twice.
     */
    async openSessionFor(
      trx: TransactionClient,
      table: TableRow,
      businessDate: string,
      ctx: ServiceContext,
    ): Promise<TableSessionRow> {
      await trx('plugins_ordering_dining_table').where({ id: table.id }).forUpdate();
      const existing = (await sessions().findOne({
        where: { table: table.id, status: 'open' },
      })) as TableSessionRow | null;
      if (existing) return existing;
      const created = (await sessions().create({
        data: {
          table: table.id,
          locationRef: table.locationRef,
          status: 'open',
          openedAt: nowOf(ctx).toISOString(),
          businessDate,
        },
      })) as TableSessionRow;
      await trx('plugins_ordering_table_session')
        .where({ id: created.id })
        .update({ open_table_id: table.id });
      return created;
    },

    /** Session list for the N7 board: orders roll up to total/captured/due per session. */
    async listSessions(
      input: { branch?: string; status?: string },
      ctx: ServiceContext,
    ) {
      const scope = s.scope();
      const staffScope = await scope.loadScope(ctx);
      const rows = (await sessions().findMany({
        where: {
          ...(input.branch ? { locationRef: input.branch } : {}),
          ...(input.status === 'open' || input.status === 'closed' ? { status: input.status } : {}),
        },
        populate: {
          table: { select: ['id', 'code', 'name', 'area'] },
          orders: {
            select: ['id', 'code', 'status', 'paymentStatus', 'totalAmount', 'placedAt'],
          },
        },
        orderBy: { openedAt: 'desc' },
        limit: 200,
      })) as Array<
        TableSessionRow & {
          table: { id: number; code: string; name: string; area: string | null } | null;
          orders: Array<{
            id: number;
            code: string;
            status: string;
            paymentStatus: string;
            totalAmount: number | string;
            placedAt: string;
          }>;
        }
      >;
      const businessDates = new Map<string, string>();
      const items = [] as Array<Record<string, unknown>>;
      for (const row of rows) {
        if (staffScope) {
          try {
            scope.assertLocationInScope(staffScope, row.locationRef);
          } catch {
            continue;
          }
        }
        let today = businessDates.get(row.locationRef);
        if (today === undefined) {
          const branch = await s.branch().findByCode(row.locationRef);
          const cutoff =
            branch != null
              ? s.branch().receiveSettings(branch, 'dine-in').schedule.businessDayPolicy
                  .cutoffLocalTime
              : '04:00';
          today = businessDateOf(nowOf(ctx), branch?.timezone ?? 'Asia/Ho_Chi_Minh', cutoff);
          businessDates.set(row.locationRef, today);
        }
        const orderIds = (row.orders ?? []).map((order) => order.id);
        // Per-order captured totals: one aggregate read each (sessions hold a handful).
        const orders = [] as Array<Record<string, unknown>>;
        let total = 0;
        let captured = 0;
        let awaiting = 0;
        for (const order of row.orders ?? []) {
          const aggregate = await s.order().getOrder(order.id, ctx);
          const money = paidAmounts(aggregate);
          const live = aggregate.groups.filter(
            (group) =>
              isTerminal(
                s.registry().workflow(group.workflowName, group.workflowVersion),
                group.status,
              ) === null,
          );
          if (live.some((group) => group.status === 'awaiting-acceptance')) awaiting += 1;
          const orderTotal = order.status === 'canceled' ? 0 : Number(order.totalAmount);
          total += orderTotal;
          captured += Math.min(money.captured, orderTotal);
          orders.push({
            id: order.id,
            code: order.code,
            status: order.status,
            paymentStatus: order.paymentStatus,
            totalAmount: orderTotal,
            due: Math.max(0, orderTotal - money.captured),
            groupStatus: live[0]?.status ?? null,
            placedAt: order.placedAt,
          });
        }
        items.push({
          id: row.id,
          status: row.status,
          locationRef: row.locationRef,
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          closedBy: row.closedBy,
          businessDate: row.businessDate,
          /** N7 red card: the session outlived its business day and never closed. */
          staleOpen: row.status === 'open' && row.businessDate < today,
          table: row.table
            ? { id: row.table.id, code: row.table.code, name: row.table.name, area: row.table.area }
            : null,
          orderCount: orderIds.length,
          awaitingAcceptance: awaiting,
          total,
          captured,
          due: Math.max(0, total - captured),
          orders,
        });
      }
      return { items };
    },

    /**
     * "Thanh toán & đóng bàn" (N7). Collects each open order's outstanding by the chosen
     * method, moves every `served` group to `completed`, then closes the session. A session
     * with an order still cooking/waiting answers 409 listing the blocking codes; a session
     * already paid creates no payment rows. Close of an already-closed session is idempotent —
     * it returns the recorded summary instead of a second collection.
     */
    async closeSession(
      sessionId: number,
      input: { method?: unknown; reference?: unknown },
      ctx: ServiceContext,
    ) {
      const method = input.method === 'transfer-at-counter' ? 'transfer-at-counter' : input.method === 'cash' || input.method === undefined ? 'cash' : null;
      if (method === null) {
        throw invalid('method', "method must be 'cash' or 'transfer-at-counter'");
      }
      let reference =
        typeof input.reference === 'string' && input.reference.trim() !== ''
          ? input.reference.trim()
          : null;
      if (reference !== null && !CLOSE_REFERENCE.test(reference)) {
        throw invalid('reference', 'reference must be 4–41 letters, digits or hyphens');
      }
      if (method === 'transfer-at-counter' && reference === null) {
        reference = `tsc${sessionId}-${randomBytes(4).toString('hex')}`;
      }
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        // Lock the table row first, as order create does (openSessionFor): an order still being
        // placed on this session commits before the close reads the orders, so it is either
        // collected here or lands on a new session. Then the session row — two concurrent
        // closes serialize there, the second sees `closed` and returns the recorded summary.
        const link = (await trx('plugins_ordering_table_session_table_lnk')
          .where({ table_session_id: sessionId })
          .first('dining_table_id')) as { dining_table_id: number } | undefined;
        if (link) await trx('plugins_ordering_dining_table').where({ id: link.dining_table_id }).forUpdate();
        await trx('plugins_ordering_table_session').where({ id: sessionId }).forUpdate();
        const session = (await sessions().findOne({
          where: { id: sessionId },
          populate: { table: { select: ['id', 'code', 'name'] } },
        })) as (TableSessionRow & { table: { id: number; code: string; name: string } | null }) | null;
        if (!session) {
          throw new OrderingError('TABLE_SESSION_NOT_FOUND', 'table session not found', {
            details: { sessionId },
          });
        }
        await assertScope(session.locationRef, ctx);
        if (session.status !== 'open') {
          return {
            item: {
              id: sessionId,
              status: session.status,
              closedAt: session.closedAt,
              closedBy: session.closedBy,
              method: null,
              collected: [],
              alreadyClosed: true,
            },
          };
        }
        const orderRows = (await strapi.db.query('plugin::ordering.order').findMany({
          where: { tableSession: sessionId },
          select: ['id', 'code', 'status'],
          orderBy: { id: 'asc' },
        })) as Array<{ id: number; code: string; status: string }>;

        // One bank reference per close: the first owing order takes it as is, later ones get
        // `<base>-<orderId>` (base trimmed so it fits 41) — never a suffix on a suffix.
        const base = reference ?? '';
        let firstReferenced: number | null = null;
        const referenceFor = (orderId: number): string => {
          if (firstReferenced === null || firstReferenced === orderId) {
            firstReferenced = orderId;
            return base;
          }
          const suffix = `-${orderId}`;
          return `${base.slice(0, 41 - suffix.length)}${suffix}`;
        };
        if (method === 'transfer-at-counter') {
          // recordManual takes `sepay-ref:<reference>` before the group locks (as webhook ingest
          // does); take every reference this close may use now, before our group locks, so a
          // SePay webhook for the same reference cannot deadlock against the close.
          const candidates = new Set<string>([base]);
          for (const row of orderRows) {
            const suffix = `-${row.id}`;
            candidates.add(`${base.slice(0, 41 - suffix.length)}${suffix}`);
          }
          for (const ref of [...candidates].sort()) {
            await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`sepay-ref:sepay:${ref}`]);
          }
        }

        // Lock order groups first (stable id order), then validate every order is out of the
        // kitchen — `served`, or a terminal state when it was canceled mid-meal.
        for (const row of orderRows) {
          const groups = (await strapi.db.query('plugin::ordering.fulfillment-group').findMany({
            where: { order: row.id },
            select: ['id'],
          })) as Array<{ id: number }>;
          for (const group of groups) {
            await trx('plugins_ordering_fulfillment_group').where({ id: group.id }).forUpdate();
          }
        }
        const blocking: string[] = [];
        const aggregates = new Map<number, OrderAggregate>();
        for (const row of orderRows) {
          const aggregate = await s.order().getOrder(row.id, ctx);
          aggregates.set(row.id, aggregate);
          const unfinished = aggregate.groups.some((group) => {
            const terminal = isTerminal(
              s.registry().workflow(group.workflowName, group.workflowVersion),
              group.status,
            );
            return terminal === null && group.status !== 'served';
          });
          if (unfinished) blocking.push(row.code);
        }
        if (blocking.length > 0) {
          throw new OrderingError(
            'TABLE_SESSION_UNFINISHED',
            'orders are still being prepared or served',
            { details: { orders: blocking } },
          );
        }

        // Collect the outstanding balance of every live order — cash capture credits the
        // closer's actorRef (the cash-closing column the verification checks).
        const collected: Array<{ orderId: number; code: string; amount: number }> = [];
        for (const row of orderRows) {
          const aggregate = aggregates.get(row.id);
          if (!aggregate || row.status === 'canceled') continue;
          const due = paidAmounts(aggregate).due;
          if (due <= 0) continue;
          if (method === 'cash') {
            const payment = await s
              .payment()
              .createPayment({ orderId: row.id, providerCode: 'cash', amount: due }, ctx);
            await s.payment().capturePayment(
              {
                paymentId: payment.id,
                amount: due,
                providerTransactionId: `table-close:${sessionId}:${row.id}:${randomBytes(6).toString('hex')}`,
                rawPayload: { sessionId, method },
              },
              ctx,
            );
          } else {
            await s.matching().recordManual(
              {
                orderId: row.id,
                reference: referenceFor(row.id),
                amount: due,
                currency: aggregate.order.currency,
                transferredAt: nowOf(ctx).toISOString(),
              },
              ctx,
            );
          }
          collected.push({ orderId: row.id, code: row.code, amount: due });
        }

        // With the money settled, every still-live group (at `served`) completes.
        for (const row of orderRows) {
          const aggregate = aggregates.get(row.id);
          if (!aggregate) continue;
          for (const group of aggregate.groups) {
            const definition = s
              .registry()
              .workflow(group.workflowName, group.workflowVersion);
            if (isTerminal(definition, group.status) !== null) continue;
            const success = (definition.states[group.status]?.next ?? []).find(
              (to) => isTerminal(definition, to) === 'success',
            );
            if (!success) continue;
            await s.transition().transitionGroup(
              {
                orderId: row.id,
                groupId: group.id,
                to: success,
                reason: 'table-session-close',
                payload: { sessionId },
              },
              ctx,
            );
          }
        }

        const closed = (await sessions().update({
          where: { id: sessionId },
          data: { status: 'closed', closedAt: nowOf(ctx).toISOString(), closedBy: actorRefOf(ctx) },
        })) as TableSessionRow;
        // Release the one-open-session slot for the table's next guests.
        await trx('plugins_ordering_table_session')
          .where({ id: sessionId })
          .update({ open_table_id: null });
        await s.changeLog().record(
          {
            action: 'table-session.close',
            entityType: 'table-session',
            entityId: sessionId,
            entityLabel: session.table ? `${session.table.code} · ${session.table.name}` : `#${sessionId}`,
            locationRef: session.locationRef,
            after: { method, collected: collected.map((row) => ({ ...row })) },
          },
          ctx,
        );
        return {
          item: {
            id: sessionId,
            status: closed.status,
            closedAt: closed.closedAt,
            closedBy: closed.closedBy,
            method,
            collected,
          },
        };
      });
    },
  };
};

export default tableService;
