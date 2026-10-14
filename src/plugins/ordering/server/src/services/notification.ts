import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { OutboxEvent } from '../contracts';
import { alertLabel, isAlertCode } from '../domain/alert-codes';
import { sha256Hex } from '../domain/hashing';
import {
  customerTemplateFor,
  deliveryFailureReason,
  formatLocalDate,
  formatLocalTime,
  type GiftCardMailData,
  type OpsAlertData,
  type TemplateCode,
  type TemplateData,
} from '../domain/notifications/templates';
import type { AnyMailData } from '../domain/notifications/template-vars';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type alertFactory from './alert';
import type alertRecipientsFactory from './alert-recipients';
import type alertRulesFactory from './alert-rules';
import type branchFactory from './branch';
import type idempotencyFactory from './idempotency';
import type {
  ChannelRule,
  NotificationChannel,
} from './notification-channel';
import type notificationChannelFactory from './notification-channel';
import type notificationTemplateFactory from './notification-template';
import type orderingSettingsFactory from './ordering-settings';
import type { OrderingRegistry } from './registry';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

/**
 * Safe failure text for the delivery log: OrderingError code + message (+ machine-readable
 * `details.reason`, e.g. `zalo-error:-1121`). Codes/reasons are whitelisted metadata — never
 * provider bodies, phones, or tokens.
 */
const failureText = (error: unknown): string => {
  const err = error as { code?: string; message?: unknown; details?: { reason?: unknown } };
  const message = String(err?.message ?? error).slice(0, 400);
  const reason =
    typeof err?.details?.reason === 'string' ? ` (${err.details.reason.slice(0, 64)})` : '';
  const code = typeof err?.code === 'string' && /^[A-Z_]+$/.test(err.code) ? `${err.code}: ` : '';
  return `${code}${message}${reason}`.slice(0, 500);
};

/** Channels that count against `notifications.dailyLimit` (paid sends). */
const PAID_CHANNELS = new Set<NotificationChannel>(['zalo', 'sms']);

const utcDayStart = (): Date => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

type DeliveryRow = {
  id: number;
  status: string;
  attempts: number;
};

type Recipient = { email?: string; phone?: string };

/**
 * Outbox-driven notifications (contracts §12, §14; O13 step 6): staff get "đơn mới" at the
 * branch email; customers get each public step on the channel chain of the matching
 * `notification-channel-rule` row (default `['email']` — the pre-O13 behavior). Every
 * (event, template, channel, recipient) has one delivery-log row: the hash key carries the
 * channel so Zalo→SMS→email fallbacks never collide on dedupe. `sent` stops the chain,
 * `failed`/`skipped` fall through to the next channel, and a re-run retries failed rows.
 * Addresses never reach logs or the delivery table — only SHA-256(`channel:value`).
 */
const notification = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const deliveries = () => strapi.db.query('plugin::ordering.notification-delivery');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const idempotency = () => plugin().service('idempotency') as ReturnType<typeof idempotencyFactory>;
  const settings = () => plugin().service('ordering-settings') as ReturnType<typeof orderingSettingsFactory>;
  const templates = () =>
    plugin().service('notification-template') as ReturnType<typeof notificationTemplateFactory>;
  const channelRules = () =>
    plugin().service('notification-channel') as ReturnType<typeof notificationChannelFactory>;
  const alertRules = () => plugin().service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const alertRecipients = () =>
    plugin().service('alert-recipients') as ReturnType<typeof alertRecipientsFactory>;
  const alerts = () => plugin().service('alert') as ReturnType<typeof alertFactory>;
  const repo = orderRepository({ strapi });

  /** Value a channel reaches the recipient by — phone for zalo/sms (E.164), email for email. */
  const channelValue = (channel: NotificationChannel, recipient: Recipient): string | null => {
    const value = channel === 'email' ? recipient.email : recipient.phone;
    return typeof value === 'string' && value !== '' ? value : null;
  };

  /**
   * Why a channel cannot send right now, or null. `no-recipient` is checked by the caller —
   * it never writes a delivery row.
   */
  const blockedReason = async (
    channel: NotificationChannel,
    rule: ChannelRule | null,
    paidAtLimit: boolean,
  ): Promise<string | null> => {
    if (channel === 'email') {
      return config().notifications.email.enabled ? null : 'email-disabled';
    }
    if (!registry().hasNotificationProvider(channel)) return 'provider-not-configured';
    if (channel === 'zalo' && !rule?.zns?.templateId) return 'zns-template-missing';
    if (PAID_CHANNELS.has(channel) && paidAtLimit) return 'daily-limit';
    return null;
  };

  /** Writes a `skipped` row once — the audit trail for "channel had a recipient but could not send". */
  const markSkipped = async (
    input: {
      event: OutboxEvent;
      template: TemplateCode;
      channel: NotificationChannel;
      value: string;
      role: 'staff' | 'customer';
      orderId?: number | null;
      locale: string;
    },
    reason: string,
  ) => {
    const key = {
      eventId: String(input.event.id),
      template: input.template,
      recipientHash: sha256Hex(`${input.channel}:${input.value}`),
    };
    const existing = (await deliveries().findOne({ where: key })) as DeliveryRow | null;
    if (existing) return;
    await deliveries()
      .create({
        data: {
          ...key,
          channel: input.channel,
          recipientRole: input.role,
          orderId: input.orderId ?? null,
          messageLocale: input.locale,
          status: 'skipped',
          attempts: 0,
          lastError: reason,
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  };

  const deliver = async (input: {
    event: OutboxEvent;
    template: TemplateCode;
    /** O13: `email` and/or `phone` (E.164); channels without a value are skipped silently. */
    recipient: Recipient;
    role: 'staff' | 'customer';
    /** Alerts carry no order; the delivery log column is nullable. */
    orderId?: number | null;
    locale: string;
    data: AnyMailData;
  }) => {
    const notifications = config().notifications;
    const rule = await channelRules().ruleFor(input.template);
    // Staff templates have no rules on file → the pre-O13 single email send.
    const chain: NotificationChannel[] = rule?.channels.length
      ? rule.channels
      : ['email'];
    // A staff-edited `notification-template` row overrides the built-in copy; a broken one falls
    // back to the default and raises `notification-template-broken` inside renderFor.
    const rendered = await templates().renderFor(input.template, input.locale, input.data);
    // Daily cap for paid channels: one atomic slot per paid send (see reservePaidSend).
    const paidLimitHit = async (): Promise<boolean> => {
      const paidAtLimit = !(await channelRules().reservePaidSend());
      if (paidAtLimit) {
        await alerts()
          .open(
            {
              alertCode: 'notification-daily-limit',
              dedupeKey: `notification-daily-limit:${utcDayStart().toISOString().slice(0, 10)}`,
              severity: 'warning',
            },
            { actor: { kind: 'system' } },
          )
          .catch(() => undefined);
      }
      return paidAtLimit;
    };

    let lastError: Error | null = null;
    for (const channel of chain) {
      const value = channelValue(channel, input.recipient);
      if (!value) continue; // no address for this channel — nothing logged, next channel
      // Other reasons first, so a channel that cannot send never spends a paid slot.
      const blockedOther = await blockedReason(channel, rule, false);
      const limitHit = !blockedOther && PAID_CHANNELS.has(channel) ? await paidLimitHit() : false;
      const blocked = blockedOther ?? (limitHit ? 'daily-limit' : null);
      if (blocked) {
        await markSkipped(
          {
            event: input.event,
            template: input.template,
            channel,
            value,
            role: input.role,
            orderId: input.orderId,
            locale: input.locale,
          },
          blocked,
        );
        continue;
      }
      const key = {
        eventId: String(input.event.id),
        template: input.template,
        recipientHash: sha256Hex(`${channel}:${value}`),
      };
      let row = (await deliveries().findOne({ where: key })) as DeliveryRow | null;
      if (row?.status === 'sent') return; // already delivered on this channel — done
      if (row?.status === 'skipped') continue;
      if (!row) {
        try {
          row = (await deliveries().create({
            data: {
              ...key,
              channel,
              recipientRole: input.role,
              orderId: input.orderId ?? null,
              messageLocale: input.locale,
              status: 'pending',
              attempts: 0,
            },
          })) as DeliveryRow;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          row = (await deliveries().findOne({ where: key })) as DeliveryRow | null;
          if (!row) continue;
          if (row.status === 'sent') return;
          if (row.status === 'skipped') continue;
        }
      }
      // Channel-specific payload: rendered copy for email/sms (`smsText`), ZNS mapping for zalo.
      const data = { ...(input.data as Record<string, unknown>), ...rendered } as Record<
        string,
        unknown
      >;
      data.trackingId = `nd-${row.id}`;
      if (channel === 'zalo') {
        data.znsTemplateId = rule?.zns?.templateId;
        data.znsParams = Object.fromEntries(
          Object.entries(rule?.zns?.params ?? {}).map(([key, varName]) => [
            key,
            (input.data as Record<string, unknown>)[varName] ?? '',
          ]),
        );
      }
      // SMS stands alone — the order code lives in the subject, so prepend it to the body.
      if (channel === 'sms') data.smsText = `${rendered.subject} — ${rendered.text}`;
      try {
        const result = await registry().notificationProvider(channel).send({
          recipient: channel === 'email' ? { email: value } : { phone: value },
          template: input.template,
          data,
        });
        const providerMessageId =
          result && typeof result === 'object'
            ? ((result as { providerMessageId?: string }).providerMessageId ?? null)
            : null;
        await deliveries().update({
          where: { id: row.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            attempts: row.attempts + 1,
            lastError: null,
            providerMessageId,
            costEstimate: notifications.costEstimates[channel] ?? null,
          },
        });
        return; // first successful channel ends the chain
      } catch (error) {
        lastError = error as Error;
        await deliveries().update({
          where: { id: row.id },
          data: {
            status: 'failed',
            attempts: row.attempts + 1,
            lastError: failureText(lastError ?? error),
          },
        });
        // fall through to the next channel
      }
    }
    // Nothing sent: retryable failures rethrow so the outbox backs off and re-runs the chain
    // (each failed row retries once per event run); all-skipped/all-unavailable ends quietly.
    if (lastError) throw lastError;
  };

  const baseData = async (aggregate: OrderAggregate) => {
    const branch = await branches().findByCode(aggregate.order.locationRef);
    const timezone = branch?.timezone ?? 'Asia/Ho_Chi_Minh';
    const locale = aggregate.order.placedLocale === 'en' ? 'en' : 'vi';
    const name = (branch?.name ?? {}) as Record<string, string>;
    const receive = aggregate.order.receiveMethod as {
      kind?: string;
      timing?: { mode?: string; slot?: { startsAt?: string } };
    };
    const group = aggregate.groups[0];
    const token = await idempotency().revealSecret('order.create', `order:${aggregate.order.id}`);
    const template = config().notifications.orderLinkTemplate;
    const timingLabel = receive.timing?.slot?.startsAt
      ? formatLocalTime(receive.timing.slot.startsAt, timezone)
      : receive.timing?.mode === 'asap'
        ? 'ASAP'
        : undefined;
    const data: TemplateData = {
      code: aggregate.order.code,
      branchName: name[locale] ?? name.vi ?? aggregate.order.locationRef,
      total: aggregate.order.totalAmount,
      items: aggregate.lines.map((line) => ({
        title: line.titleSnapshot,
        quantity: line.quantity - line.canceledQuantity,
      })),
      // "Giờ lấy" is pickup wording; a delivery order's slot reads "Giao lúc" instead.
      pickupLabel: receive.kind === 'delivery' ? undefined : timingLabel,
      deliveryLabel: receive.kind === 'delivery' ? timingLabel : undefined,
      readyLabel: group?.estimatedReadyAt ? formatLocalTime(group.estimatedReadyAt, timezone) : undefined,
      link: token && template.includes('{token}') ? template.replace('{token}', token) : undefined,
    };
    return { branch, locale, data };
  };

  /** O13: customer contact channels — email plus the E.164 phone left at checkout. */
  const customerRecipient = (aggregate: OrderAggregate): Recipient | null => {
    const contact = aggregate.order.contactSnapshot as { email?: string; phone?: string };
    const email = typeof contact.email === 'string' && contact.email.includes('@')
      ? contact.email
      : undefined;
    const phone = typeof contact.phone === 'string' && contact.phone !== '' ? contact.phone : undefined;
    return email || phone ? { email, phone } : null;
  };

  const service = {
    /** `order.created` (and a confirmed staff draft): staff alert + customer receipt. */
    async onOrderPlaced(event: OutboxEvent): Promise<void> {
      const orderId = Number(event.payload.orderId);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate || aggregate.order.status === 'draft') return;
      const { branch, locale, data } = await baseData(aggregate);
      if (branch?.email) {
        await deliver({
          event,
          template: 'staff.order-created',
          recipient: { email: branch.email },
          role: 'staff',
          orderId,
          locale: 'vi',
          data: {
            ...data,
            customerName: (aggregate.order.contactSnapshot as { name?: string }).name,
            note: aggregate.order.customerNote ?? undefined,
          },
        });
      }
      const recipient = customerRecipient(aggregate);
      if (recipient && aggregate.order.origin.kind === 'storefront') {
        await deliver({
          event,
          template: 'customer.order-placed',
          recipient,
          role: 'customer',
          orderId,
          locale,
          data,
        });
      }
    },

    /** `order-awaiting-acceptance` keeps its rich order template for the branch mailbox. */
    async sendOrderOverdue(event: OutboxEvent, branchEmails: string[]): Promise<void> {
      const ref = /^order:(\d+)$/.exec(String(event.payload.aggregateRef ?? ''));
      if (!ref) return;
      const orderId = Number(ref[1]);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate) return;
      const { branch, data } = await baseData(aggregate);
      if (!branch?.email || !branchEmails.includes(branch.email)) return;
      await deliver({
        event,
        template: 'staff.order-overdue',
        recipient: { email: branch.email },
        role: 'staff',
        orderId,
        locale: 'vi',
        data,
      });
    },

    /**
     * `ops-alert.opened` / `ops-alert.escalated`: resolve the alert rule's recipients — branch
     * mailbox for 'branch-email', active admin holders of each listed action otherwise — and
     * send one `staff.ops-alert` per address (deduped across actions and by the delivery log).
     */
    async onOpsAlert(event: OutboxEvent): Promise<void> {
      const alertCode = String(event.payload.alertCode ?? '');
      const locationRef =
        typeof event.payload.locationRef === 'string' ? event.payload.locationRef : undefined;
      const rule = isAlertCode(alertCode) ? (await alertRules().get())[alertCode] : undefined;
      if (!rule || !rule.enabled) return;
      const { emails, branchEmails } = await alertRecipients().resolve(rule, locationRef);
      const generic = new Set(emails);
      // The overdue order keeps its detailed template; everything else gets the alert summary.
      if (alertCode === 'order-awaiting-acceptance' && event.type === 'ops-alert.opened') {
        await service.sendOrderOverdue(event, branchEmails);
        for (const email of branchEmails) generic.delete(email);
      }
      if (generic.size === 0) return;
      const row = (await strapi.db.query('plugin::ordering.ops-alert').findOne({
        where: { id: Number(event.payload.alertId) },
      })) as {
        severity?: string;
        count?: number;
        firstSeenAt?: string;
        lastSeenAt?: string;
      } | null;
      const severity = (['info', 'warning', 'critical'].includes(String(event.payload.severity))
        ? event.payload.severity
        : row?.severity ?? 'warning') as OpsAlertData['severity'];
      const data: OpsAlertData = {
        label: alertLabel(alertCode, 'vi'),
        severity,
        count: Number(event.payload.count ?? row?.count ?? 1),
        firstSeen: row?.firstSeenAt ? formatLocalTime(String(row.firstSeenAt), 'Asia/Ho_Chi_Minh') : '—',
        lastSeen: row?.lastSeenAt ? formatLocalTime(String(row.lastSeenAt), 'Asia/Ho_Chi_Minh') : '—',
        branchRef: locationRef,
        aggregateRef:
          typeof event.payload.aggregateRef === 'string' ? event.payload.aggregateRef : undefined,
      };
      for (const email of generic) {
        await deliver({
          event,
          template: 'staff.ops-alert',
          recipient: { email },
          role: 'staff',
          orderId: null,
          locale: 'vi',
          data,
        });
      }
    },

    /** `order.transitioned` from draft = staff confirmed a phone order. */
    async onOrderTransitioned(event: OutboxEvent): Promise<void> {
      if (event.payload.from !== 'draft') return;
      await service.onOrderPlaced(event);
    },

    /** `fulfillment-group.transitioned`: customer email for public steps when staff chose to notify. */
    async onGroupTransitioned(event: OutboxEvent): Promise<void> {
      if (event.payload.notifyCustomer === false || event.payload.isPublic === false) return;
      const orderId = Number(event.payload.orderId);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate) return;
      const groupId = Number(event.payload.groupId);
      const group = aggregate.groups.find((item) => item.id === groupId) ?? aggregate.groups[0];
      const receiveKind =
        (group?.receiveMethod as { kind?: string } | undefined)?.kind ??
        (aggregate.order.receiveMethod as { kind?: string }).kind;
      const template = customerTemplateFor(String(event.payload.to), {
        delayed: event.payload.delayed === true,
        from: typeof event.payload.from === 'string' ? event.payload.from : undefined,
        receiveKind,
      });
      if (!template) return;
      const recipient = customerRecipient(aggregate);
      if (!recipient) return;
      const { locale, data } = await baseData(aggregate);
      let reason: string | undefined;
      const reasonCode = event.payload.reasonCode;
      if (typeof reasonCode === 'string' && template === 'customer.order-rejected') {
        const found = (await settings().get()).rejectReasons.find((item) => item.code === reasonCode);
        reason = found ? (found.label[locale] ?? found.label.vi) : undefined;
      }
      if (typeof reasonCode === 'string' && template === 'customer.delivery-failed') {
        reason = deliveryFailureReason(reasonCode, locale);
      }
      await deliver({
        event,
        template,
        recipient,
        role: 'customer',
        orderId,
        locale,
        data: { ...data, ...(reason ? { reason } : {}) },
      });
    },

    /**
     * `rating.invite` (O8): sent `ratingInviteDelayMinutes` after the order completed, once, only
     * while the order is still completed and not yet rated. The link opens the order page on its
     * rating block (`&rate=1` after the `#t=` token, `#rate` when the template has no fragment).
     */
    async onRatingInvite(event: OutboxEvent): Promise<void> {
      const orderId = Number(event.payload.orderId);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate || aggregate.order.status !== 'completed') return;
      if (!(await settings().get()).ratingInviteEnabled) return;
      const rated = await strapi.db.query('plugin::ordering.order-rating').count({ where: { orderId } });
      if (rated > 0) return;
      const recipient = customerRecipient(aggregate);
      if (!recipient) return;
      const { locale, data } = await baseData(aggregate);
      const link = data.link ? `${data.link}${data.link.includes('#') ? '&rate=1' : '#rate'}` : undefined;
      await deliver({
        event,
        template: 'customer.rating-invite',
        recipient,
        role: 'customer',
        orderId,
        locale,
        data: { ...data, ...(link ? { link } : {}) },
      });
    },

    /**
     * O9 `customer.gift-card-issued`: the purchaser's or recipient's mailbox gets the plaintext
     * codes — the only mail that ever carries them. Deduped by the delivery log on
     * (event, template, recipientHash); the order link only rides along when the recipient is
     * the purchaser, so a gifted recipient never gets the buyer's token URL.
     */
    async sendGiftCardIssued(
      event: OutboxEvent,
      input: {
        orderId: number;
        email: string;
        recipientName?: string;
        message?: string;
        cards: Array<{ code: string; amount: number }>;
        /** True when `email` is the purchaser's own contact address. */
        includeOrderLink: boolean;
        expiresAt?: string;
      },
    ): Promise<void> {
      const aggregate = await repo.loadOrderAggregate(input.orderId);
      if (!aggregate) return;
      const { branch, locale, data } = await baseData(aggregate);
      const timezone = branch?.timezone ?? 'Asia/Ho_Chi_Minh';
      const name = (branch?.name ?? {}) as Record<string, string>;
      const mail: GiftCardMailData = {
        orderCode: aggregate.order.code,
        branch: name[locale] ?? name.vi ?? aggregate.order.locationRef,
        cards: input.cards,
        ...(input.expiresAt ? { expiresAt: formatLocalDate(input.expiresAt, timezone) } : {}),
        ...(input.recipientName ? { recipientName: input.recipientName } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.includeOrderLink && data.link ? { link: data.link } : {}),
      };
      await deliver({
        event,
        template: 'customer.gift-card-issued',
        // Email only: a card code never rides SMS/Zalo.
        recipient: { email: input.email },
        role: 'customer',
        orderId: input.orderId,
        locale,
        data: mail,
      });
    },

    /**
     * Orderless gift-card mail (O9 step 5): complimentary issue and staff resend ride the same
     * `customer.gift-card-issued` template but carry no order — no order line, no order link.
     * `dedupeKey` is a staff-action id (`issue:<cardId>`, `resend:<cardId>:<n>`) so a retried
     * mutation can't double-send while each deliberate resend gets its own delivery row.
     */
    async sendGiftCardManual(
      input: {
        dedupeKey: string;
        email: string;
        recipientName?: string;
        message?: string;
        cards: Array<{ code: string; amount: number }>;
        expiresAt?: string;
        /** Staff's branch context — sender label + timezone for the formatted expiry. */
        locationRef?: string | null;
        locale?: string;
      },
    ): Promise<void> {
      const branch = input.locationRef ? await branches().findByCode(input.locationRef) : null;
      const timezone = branch?.timezone ?? 'Asia/Ho_Chi_Minh';
      const locale = input.locale === 'en' ? 'en' : 'vi';
      const name = (branch?.name ?? {}) as Record<string, string>;
      const mail: GiftCardMailData = {
        branch: name[locale] ?? name.vi ?? input.locationRef ?? '—',
        cards: input.cards,
        ...(input.expiresAt ? { expiresAt: formatLocalDate(input.expiresAt, timezone) } : {}),
        ...(input.recipientName ? { recipientName: input.recipientName } : {}),
        ...(input.message ? { message: input.message } : {}),
      };
      await deliver({
        event: { id: input.dedupeKey, payload: {} } as OutboxEvent,
        template: 'customer.gift-card-issued',
        // Email only: a card code never rides SMS/Zalo.
        recipient: { email: input.email },
        role: 'customer',
        orderId: null,
        locale,
        data: mail,
      });
    },

    /** `order.edited`: the updated items and total. A balance link replaces the order link. */
    async onOrderEdited(event: OutboxEvent): Promise<void> {
      if (event.payload.notifyCustomer === false) return;
      const orderId = Number(event.payload.orderId);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate) return;
      const recipient = customerRecipient(aggregate);
      if (!recipient) return;
      const { locale, data } = await baseData(aggregate);
      const paymentLink = event.payload.paymentLink === true;
      let link = data.link;
      if (paymentLink) {
        const url = await (
          plugin().service('payment-link') as {
            currentUrl(id: number, now: Date): Promise<string | null>;
          }
        ).currentUrl(orderId, new Date());
        if (url) link = url;
      }
      const reason = paymentLink
        ? locale === 'en'
          ? 'Pay the difference with the link below.'
          : 'Phần chênh thanh toán qua liên kết bên dưới.'
        : undefined;
      await deliver({
        event,
        template: 'customer.order-updated',
        recipient,
        role: 'customer',
        orderId,
        locale,
        data: {
          ...data,
          items: data.items.filter((item) => item.quantity > 0),
          ...(link ? { link } : {}),
          ...(reason ? { reason } : {}),
        },
      });
    },
  };
  return service;
};

export default notification;
