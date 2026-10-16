import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import { notificationDay, notificationDayStart, notificationDayStartFor } from '../domain/notifications/budget-day';
import { skipReasonLabel } from '../domain/notifications/skip-reasons';
import { TEMPLATE_CODES, TEMPLATE_NAMES } from '../domain/notifications/template-vars';
import type { TemplateCode } from '../domain/notifications/templates';
import type { LocationScope } from '../domain/scope';
import { NOTIFICATION_CHANNELS } from './notification-channel';
import type { ServiceContext } from './context';
import type scopeFactory from './scope';

const TABLE = 'plugins_ordering_notification_delivery';
const ORDER_TABLE = 'plugins_ordering_order';
const BRANCH_TABLE = 'plugins_ordering_branch';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The screen reads at most this many days at once; the default window is the last seven. */
const MAX_LIST_DAYS = 92;
const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;
const STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
const ROLES = ['staff', 'customer'] as const;

export type NotificationLogQuery = {
  from?: string;
  to?: string;
  status?: string;
  channel?: string;
  template?: string;
  role?: string;
  q?: string;
  /** Raw value: `page=0`/negative is a validation error, not a silent default. */
  page?: unknown;
  locale?: string;
};

type Row = {
  id: number;
  created_at: string | Date;
  template: string;
  channel: string;
  recipient_role: string | null;
  order_id: number | null;
  order_code: string | null;
  location_ref: string | null;
  status: string;
  attempts: number;
  sent_at: string | Date | null;
  last_error: string | null;
  message_locale: string | null;
  provider_message_id: string | null;
  cost_estimate: number | null;
};

/** Public row shape — no recipient hash, event id, last error, provider id or cost (see `/technical`). */
export type NotificationLogRow = {
  id: number;
  createdAt: string;
  template: string;
  templateLabel: string;
  channel: string;
  recipientRole: 'staff' | 'customer' | null;
  orderId: number | null;
  orderCode: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  sentAt: string | null;
  reasonCode: string | null;
  reasonLabel: string | null;
};

const SELECT = [
  'd.id',
  'd.created_at',
  'd.template',
  'd.channel',
  'd.recipient_role',
  'd.order_id',
  'o.code as order_code',
  'o.location_ref',
  'd.status',
  'd.attempts',
  'd.sent_at',
  'd.last_error',
  'd.message_locale',
  'd.provider_message_id',
  'd.cost_estimate',
];

const parsedJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const iso = (value: string | Date): string => (value instanceof Date ? value : new Date(value)).toISOString();
const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const validation = (message: string, field: string): never => {
  throw new OrderingError('VALIDATION_ERROR', message, { details: { field } });
};

const dayOf = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return validation(`${field} must be YYYY-MM-DD`, field);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return validation(`${field} must be a real calendar date`, field);
  }
  return value;
};

const pageOf = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 1;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return validation('page must be a positive integer', 'page');
  return parsed;
};

const templateLabelOf = (template: string, locale?: string): string => {
  const names = TEMPLATE_NAMES[template as TemplateCode];
  if (!names) return template;
  return locale?.toLowerCase().startsWith('en') ? names[1] : names[0];
};

/**
 * R1b notification delivery log (read-only). Rows tied to an order follow the caller's location
 * scope (same as O15); rows without an order — alert and test sends — are visible to `allLocations`
 * staff only. Addresses are never stored, so the list shows the recipient role and channel instead.
 */
const notificationLog = ({ strapi }: { strapi: Core.Strapi }) => {
  const knex = () => strapi.db.connection;
  const plugin = () => strapi.plugin('ordering');
  const scope = () => plugin().service('scope') as ReturnType<typeof scopeFactory>;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  const callerScope = async (ctx: ServiceContext): Promise<LocationScope> => {
    const loaded = await scope().loadScope(ctx);
    if (!loaded) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    return loaded;
  };

  const visible = (staffScope: LocationScope, locationRef: string | null): boolean =>
    staffScope.allLocations ||
    (locationRef !== null && staffScope.locationRefs.includes(locationRef));

  /** Join to the order for the code + branch; scope is applied on the order's branch. */
  const base = (staffScope: LocationScope) => {
    const builder = knex()(`${TABLE} as d`).leftJoin(`${ORDER_TABLE} as o`, 'd.order_id', 'o.id');
    if (!staffScope.allLocations) builder.whereIn('o.location_ref', staffScope.locationRefs);
    return builder;
  };

  const rangeOf = (query: NotificationLogQuery, timezone: string) => {
    const to = query.to ? dayOf(query.to, 'to') : notificationDay(new Date(), timezone);
    const from = query.from ? dayOf(query.from, 'from') : shiftDay(to, -6);
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
    if (from > to || span > MAX_LIST_DAYS) {
      return validation(`range must be at most ${MAX_LIST_DAYS} days`, 'to');
    }
    return { from, to };
  };

  const filtersOf = (query: NotificationLogQuery) => {
    if (query.status && !(STATUSES as readonly string[]).includes(query.status)) {
      validation('unknown status', 'status');
    }
    if (query.channel && !(NOTIFICATION_CHANNELS as readonly string[]).includes(query.channel)) {
      validation('unknown channel', 'channel');
    }
    if (query.template && !(TEMPLATE_CODES as readonly string[]).includes(query.template)) {
      validation('unknown template', 'template');
    }
    if (query.role && !(ROLES as readonly string[]).includes(query.role)) {
      validation('unknown role', 'role');
    }
    return query;
  };

  /** Time window in the notification timezone: `[startOfDay(from), startOfDay(to) + 1 day)`. */
  const windowed = (staffScope: LocationScope, from: string, to: string, timezone: string) => {
    const start = notificationDayStartFor(from, timezone);
    const end = new Date(notificationDayStartFor(to, timezone).getTime() + DAY_MS);
    return base(staffScope).where('d.created_at', '>=', start).where('d.created_at', '<', end);
  };

  const toPublic = (row: Row, locale?: string): NotificationLogRow => ({
    id: Number(row.id),
    createdAt: iso(row.created_at),
    template: row.template,
    templateLabel: templateLabelOf(row.template, locale),
    channel: row.channel,
    recipientRole: (row.recipient_role as 'staff' | 'customer' | null) ?? null,
    orderId: row.order_id === null ? null : Number(row.order_id),
    orderCode: row.order_code ?? null,
    status: row.status as NotificationLogRow['status'],
    attempts: Number(row.attempts),
    sentAt: row.sent_at ? iso(row.sent_at) : null,
    reasonCode: row.status === 'skipped' ? row.last_error : null,
    reasonLabel: row.status === 'skipped' ? skipReasonLabel(row.last_error, locale) : null,
  });

  const fetchRow = async (staffScope: LocationScope, id: number): Promise<Row | null> => {
    const row = (await base(staffScope).where('d.id', id).first(SELECT)) as Row | undefined;
    if (!row || !visible(staffScope, row.location_ref)) return null;
    return row;
  };

  return {
    async list(query: NotificationLogQuery, ctx: ServiceContext) {
      const timezone = config().notifications.timezone;
      const { from, to } = rangeOf(query, timezone);
      filtersOf(query);
      const page = pageOf(query.page);
      const staffScope = await callerScope(ctx);
      const builder = windowed(staffScope, from, to, timezone);
      if (query.status) builder.where('d.status', query.status);
      if (query.channel) builder.where('d.channel', query.channel);
      if (query.template) builder.where('d.template', query.template);
      if (query.role) builder.where('d.recipient_role', query.role);
      const q = query.q?.trim();
      if (q) {
        const order = (await knex()(ORDER_TABLE).whereRaw('upper(code) = upper(?)', [q]).first('id')) as
          | { id: number }
          | undefined;
        // No matching order code → an empty result, never an error.
        if (!order) return { range: { from, to, timezone }, page, hasNext: false, rows: [] };
        builder.where('d.order_id', order.id);
      }
      const rows = (await builder
        .orderBy('d.id', 'desc')
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE + 1)
        .select(SELECT)) as Row[];
      return {
        range: { from, to, timezone },
        page,
        hasNext: rows.length > PAGE_SIZE,
        rows: rows.slice(0, PAGE_SIZE).map((row) => toPublic(row, query.locale)),
      };
    },

    async detail(id: number, query: { locale?: string }, ctx: ServiceContext) {
      const staffScope = await callerScope(ctx);
      const row = await fetchRow(staffScope, id);
      if (!row) {
        throw new OrderingError('NOTIFICATION_DELIVERY_NOT_FOUND', 'delivery not found', { details: { id } });
      }
      return { ...toPublic(row, query.locale), messageLocale: row.message_locale ?? null };
    },

    /** The technical tail is a separate route so the second permission can gate it at the policy. */
    async technical(id: number, ctx: ServiceContext) {
      const staffScope = await callerScope(ctx);
      const row = await fetchRow(staffScope, id);
      if (!row) {
        throw new OrderingError('NOTIFICATION_DELIVERY_NOT_FOUND', 'delivery not found', { details: { id } });
      }
      return {
        id: Number(row.id),
        lastError: row.last_error ?? null,
        providerMessageId: row.provider_message_id ?? null,
        costEstimate: row.cost_estimate === null ? null : Number(row.cost_estimate),
      };
    },

    async summary(ctx: ServiceContext) {
      const notifications = config().notifications;
      const timezone = notifications.timezone;
      const staffScope = await callerScope(ctx);
      const since = new Date(Date.now() - DAY_MS);

      const statusCounts = (await base(staffScope)
        .where('d.created_at', '>=', since)
        .select('d.status')
        .count('* as n')
        .groupBy('d.status')) as Array<{ status: string; n: string | number }>;
      const last24h = { sent: 0, failed: 0, skipped: 0, pending: 0 };
      for (const entry of statusCounts) {
        if (entry.status in last24h) last24h[entry.status as keyof typeof last24h] = Number(entry.n);
      }

      const channelCounts = (await base(staffScope)
        .where('d.created_at', '>=', since)
        .select('d.channel', 'd.status')
        .count('* as n')
        .max('d.sent_at as last_sent')
        .groupBy('d.channel', 'd.status')) as Array<{
        channel: string;
        status: string;
        n: string | number;
        last_sent: string | Date | null;
      }>;
      const byChannel = NOTIFICATION_CHANNELS.map((channel) => {
        const entries = channelCounts.filter((entry) => entry.channel === channel);
        const count = (status: string) =>
          Number(entries.find((entry) => entry.status === status)?.n ?? 0);
        const lastSent = entries.map((entry) => entry.last_sent).filter((value): value is string | Date => Boolean(value));
        return {
          channel,
          sent: count('sent'),
          failed: count('failed'),
          skipped: count('skipped'),
          lastSentAt: lastSent.length
            ? iso(lastSent.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)))
            : null,
        };
      });

      const dayStart = notificationDayStart(new Date(), timezone);
      const paidRow = (await knex()(TABLE)
        .whereIn('channel', ['zalo', 'sms'])
        .where('status', 'sent')
        .where('sent_at', '>', dayStart)
        .count('* as n')
        .first()) as { n: string | number } | undefined;

      const branchRows = (await knex()(BRANCH_TABLE)
        .where('is_active', true)
        .modify((builder) => {
          if (!staffScope.allLocations) builder.whereIn('code', staffScope.locationRefs);
        })
        .where((builder) => builder.whereNull('email').orWhereRaw("btrim(email) = ''"))
        .orderBy('code', 'asc')
        .select('code', 'name')) as Array<{ code: string; name: unknown }>;

      return {
        timezone,
        last24h,
        byChannel,
        paid: { sentToday: Number(paidRow?.n ?? 0), dailyLimit: notifications.dailyLimit },
        mode: notifications.mode,
        branchesWithoutEmail: branchRows.map((row) => ({
          code: row.code,
          name: (parsedJson(row.name) ?? {}) as Record<string, string>,
        })),
      };
    },
  };
};

export default notificationLog;
