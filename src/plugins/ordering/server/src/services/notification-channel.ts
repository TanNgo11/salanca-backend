import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { JsonObject } from '../contracts/common';
import { sha256Hex } from '../domain/hashing';
import type { TemplateCode } from '../domain/notifications/templates';
import {
  TEMPLATE_CODES,
  TEMPLATE_NAMES,
  sampleDataFor,
} from '../domain/notifications/template-vars';
import { OrderingError } from '../domain/errors';
import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { normalizeEmailTarget } from '../domain/customers/otp';
import type changeLogFactory from './change-log';
import type notificationTemplateFactory from './notification-template';
import type { ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

/** Channels the delivery chain understands, cheapest last by convention — order is the rule's. */
export const NOTIFICATION_CHANNELS = ['zalo', 'sms', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type ZnsRule = { templateId: string; params: Record<string, string> };
export type ChannelRule = { channels: NotificationChannel[]; zns: ZnsRule | null };

type RuleRow = {
  id: number;
  template: string;
  channels: unknown;
  zns: unknown;
  active: boolean;
};

const TEMPLATE_CODE_SET = new Set<string>(TEMPLATE_CODES);
const VAR_NAME = /^[a-z][a-z0-9_]*$/i;

const validation = (message: string, details: Record<string, unknown> = {}): never => {
  throw new OrderingError('VALIDATION_ERROR', message, { details });
};

/** Validates + normalizes a rule payload; throws VALIDATION_ERROR on anything off-shape. */
export const parseChannelRule = (input: unknown): ChannelRule => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validation('rule must be an object');
  }
  const raw = input as { channels?: unknown; zns?: unknown };
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    return validation('channels must be a non-empty array');
  }
  const channels = raw.channels.map((value) => {
    const channel = String(value);
    if (!NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
      return validation('unknown notification channel', { channel });
    }
    return channel as NotificationChannel;
  });
  if (new Set(channels).size !== channels.length) {
    return validation('channels must not repeat');
  }

  let zns: ZnsRule | null = null;
  if (raw.zns !== undefined && raw.zns !== null) {
    const z = raw.zns as { templateId?: unknown; params?: unknown };
    const templateId = typeof z.templateId === 'string' ? z.templateId.trim() : '';
    if (templateId === '' || templateId.length > 64) {
      return validation('zns.templateId is required (≤64 chars) when zalo is configured');
    }
    const params: Record<string, string> = {};
    const rawParams = z.params ?? {};
    if (typeof rawParams !== 'object' || Array.isArray(rawParams)) {
      return validation('zns.params must be an object {znsParam: pluginVar}');
    }
    for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) {
      const varName = String(value);
      if (key.length > 48 || varName.length > 48 || !VAR_NAME.test(varName)) {
        return validation('zns.params maps {znsParam ≤48: pluginVar identifier}', {
          param: key,
        });
      }
      params[key] = varName;
    }
    zns = { templateId, params };
  }
  if (channels.includes('zalo') && !zns) {
    return validation('channel "zalo" needs zns.templateId + params');
  }
  return { channels, zns };
};

/**
 * Per-template channel ordering for customer notifications (O13 step 6, screens P3). A row maps
 * one `TemplateCode` to an ordered fallback chain and the Zalo ZNS mapping; templates without a
 * row stay on the pre-O13 default `['email']`. Rules are validated before persistence, audited
 * per template, and read by `notification.deliver` via `ruleFor`.
 */
const notificationChannel = ({ strapi }: { strapi: Core.Strapi }) => {
  const rules = () => strapi.db.query('plugin::ordering.notification-channel-rule');
  const deliveries = () => strapi.db.query('plugin::ordering.notification-delivery');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;
  const templates = () =>
    strapi.plugin('ordering').service('notification-template') as ReturnType<
      typeof notificationTemplateFactory
    >;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const normalize = (row: RuleRow): { rule: ChannelRule; valid: boolean } => {
    try {
      return { rule: parseChannelRule({ channels: row.channels, zns: row.zns }), valid: true };
    } catch {
      return { rule: { channels: [], zns: null }, valid: false };
    }
  };

  /** Paid channels share the `notifications.dailyLimit` bucket (UTC day, sent rows only). */
  const paidSentToday = async (): Promise<number> => {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    return deliveries().count({
      where: { channel: { $in: ['zalo', 'sms'] }, status: 'sent', sentAt: { $gt: dayStart } },
    }) as Promise<number>;
  };

  const service = {
    /**
     * Takes one slot of today's paid-message budget (`notifications.dailyLimit`, UTC day) or
     * answers false when it is spent. Atomic across processes: a per-day counter in the plugin
     * store, updated under an advisory lock (seeded from today's sent rows). Every paid send —
     * notifications, OTP, the staff test — calls this right before the provider call; a slot
     * taken by a send that then fails is not given back (the cap errs on the low side).
     */
    async reservePaidSend(): Promise<boolean> {
      const limit = config().notifications.dailyLimit;
      const day = new Date().toISOString().slice(0, 10);
      return (await strapi.db.transaction(async ({ trx }) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', ['ordering-paid-daily']);
        const store = strapi.store({ type: 'plugin', name: 'ordering', key: 'paid-daily-usage' });
        const saved = (await store.get({})) as { day?: string; used?: number } | null;
        const used = saved?.day === day && typeof saved.used === 'number' ? saved.used : await paidSentToday();
        if (used >= limit) {
          if (saved?.day !== day) await store.set({ value: { day, used } });
          return false;
        }
        await store.set({ value: { day, used: used + 1 } });
        return true;
      })) as boolean;
    },

    /** Active rule for a template — `null` means the default email-only chain applies. */
    async ruleFor(template: string): Promise<ChannelRule | null> {
      const row = (await rules().findOne({
        where: { template, active: true },
      })) as RuleRow | null;
      if (!row) return null;
      const { rule, valid } = normalize(row);
      return valid ? rule : null;
    },

    /**
     * Settings → Kênh thông báo: every template × its effective chain plus channel state
     * (provider registered? email enabled? over the daily cap?) and usage counters.
     */
    async overview() {
      const rows = (await rules().findMany({})) as RuleRow[];
      const byTemplate = new Map(rows.map((row) => [row.template, row]));
      const notifications = config().notifications;
      const providers = {
        zalo: registry().hasNotificationProvider('zalo'),
        sms: registry().hasNotificationProvider('sms'),
        email: notifications.email.enabled,
      };
      const templates_ = TEMPLATE_CODES.map((template) => {
        const row = byTemplate.get(template);
        const { rule, valid } = row ? normalize(row) : { rule: null, valid: true };
        return {
          template,
          label: TEMPLATE_NAMES[template as TemplateCode]?.[0] ?? template,
          customized: row !== undefined,
          valid,
          active: row?.active ?? true,
          channels: rule?.channels ?? ['email'],
          zns: rule?.zns ?? null,
        };
      });
      return {
        providers,
        dailyLimit: notifications.dailyLimit,
        costEstimates: notifications.costEstimates,
        sentToday: await paidSentToday(),
        rules: templates_,
      };
    },

    /** PUT — validate then upsert the single row per template; audited per change. */
    async put(template: string, input: unknown, ctx: ServiceContext) {
      if (!TEMPLATE_CODE_SET.has(template)) {
        return validation('unknown template code', { template });
      }
      const body = (typeof input === 'object' && input !== null ? input : {}) as {
        channels?: unknown;
        zns?: unknown;
        active?: unknown;
      };
      const rule = parseChannelRule({ channels: body.channels, zns: body.zns });
      const active = body.active !== false;
      const existing = (await rules().findOne({ where: { template } })) as RuleRow | null;
      const after = {
        channels: rule.channels,
        ...(rule.zns ? { zns: rule.zns } : {}),
        active,
      };
      if (existing) {
        await rules().update({ where: { id: existing.id }, data: { ...rule, active } });
      } else {
        await rules().create({ data: { template, ...rule, active } });
      }
      await changeLog().record(
        {
          action: 'notification-channel.update',
          entityType: 'notification-channel-rule',
          entityId: template,
          entityLabel: TEMPLATE_NAMES[template as TemplateCode]?.[0] ?? template,
          before: existing
            ? { channels: existing.channels, zns: existing.zns, active: existing.active }
            : null,
          after,
        },
        ctx,
      );
      return { template, ...rule, active };
    },

    /**
     * POST …/test — renders the sample payload and sends through one explicit channel to a
     * phone/email typed by staff. Writes a `test:<uuid>` delivery row (hash-only target) so the
     * result is auditable; provider id comes back in the response.
     */
    async sendTest(
      input: { template?: unknown; channel?: unknown; target?: unknown },
      ctx: ServiceContext,
    ) {
      const template = String(input.template ?? '');
      if (!TEMPLATE_CODE_SET.has(template)) {
        return validation('unknown template code', { template });
      }
      const channel = String(input.channel ?? '');
      if (!NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) {
        return validation('unknown notification channel', { channel });
      }
      const rule = await service.ruleFor(template);
      const data = sampleDataFor(template as TemplateCode) as JsonObject;
      const recipient: JsonObject = {};
      if (channel === 'email') {
        const email = normalizeEmailTarget(input.target);
        if (!email) return validation('target must be an email address', { channel });
        recipient.email = email;
        if (!config().notifications.email.enabled) {
          return validation('email notifications are disabled', { channel });
        }
      } else {
        const phone = normalizeVietnamesePhone(input.target);
        if (!phone.valid) {
          return validation('target must be a Vietnamese phone number', { channel });
        }
        recipient.phone = phone.e164;
        if (!registry().hasNotificationProvider(channel)) {
          return validation('channel provider is not configured', { channel });
        }
        if (channel === 'zalo') {
          if (!rule?.zns) return validation('no zns template configured for this template');
          data.znsTemplateId = rule.zns.templateId;
          data.znsParams = Object.fromEntries(
            Object.entries(rule.zns.params).map(([key, varName]) => [
              key,
              (data as Record<string, unknown>)[varName] ?? '',
            ]),
          );
        }
      }
      const rendered = await templates().renderFor(
        template as TemplateCode,
        'vi',
        data as Parameters<ReturnType<typeof templates>['renderFor']>[2],
      );
      if (channel !== 'email' && !(await service.reservePaidSend())) {
        return validation('the daily paid-message limit is reached', { channel });
      }
      const row = (await deliveries().create({
        data: {
          eventId: `test:${randomUUID()}`,
          template,
          channel,
          recipientHash: sha256Hex(
            `${channel}:${String(recipient.email ?? recipient.phone)}`,
          ),
          recipientRole: 'staff',
          orderId: null,
          messageLocale: 'vi',
          status: 'pending',
          attempts: 0,
        },
      })) as { id: number };
      data.trackingId = `nd-${row.id}`;
      data.smsText = `${rendered.subject} — ${rendered.text}`;
      try {
        const result = await registry().notificationProvider(channel).send({
          recipient,
          template,
          data: { ...data, ...rendered },
        });
        const providerMessageId =
          result && typeof result === 'object'
            ? (result as { providerMessageId?: string }).providerMessageId
            : undefined;
        await deliveries().update({
          where: { id: row.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            attempts: 1,
            providerMessageId: providerMessageId ?? null,
          },
        });
        await changeLog().record(
          {
            action: 'notification-channel.test',
            entityType: 'notification-channel-rule',
            entityId: template,
            entityLabel: TEMPLATE_NAMES[template as TemplateCode]?.[0] ?? template,
            after: { channel, deliveryId: row.id },
          },
          ctx,
        );
        return { sent: true, channel, providerMessageId: providerMessageId ?? null };
      } catch (error) {
        await deliveries().update({
          where: { id: row.id },
          data: {
            status: 'failed',
            attempts: 1,
            lastError: String((error as Error)?.message ?? error).slice(0, 500),
          },
        });
        throw error;
      }
    },
  };
  return service;
};

export default notificationChannel;
