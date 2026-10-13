import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { OutboxEvent } from '../contracts';
import { alertLabel, isAlertCode } from '../domain/alert-codes';
import { sha256Hex } from '../domain/hashing';
import {
  customerTemplateFor,
  deliveryFailureReason,
  formatLocalTime,
  type OpsAlertData,
  type TemplateCode,
  type TemplateData,
} from '../domain/notifications/templates';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type alertRecipientsFactory from './alert-recipients';
import type alertRulesFactory from './alert-rules';
import type branchFactory from './branch';
import type idempotencyFactory from './idempotency';
import type notificationTemplateFactory from './notification-template';
import type orderingSettingsFactory from './ordering-settings';
import type { OrderingRegistry } from './registry';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

/**
 * Email notifications driven by outbox events (contracts §12, §14; plan step 11):
 * staff get "đơn mới" at the branch email; customers who left an email get each public step in the
 * language they ordered in. Each (event, template, recipient) has one delivery-log row keyed by
 * the recipient's hash, so a dispatcher re-run (or a retried event) never sends twice. Addresses
 * never reach logs or the delivery table.
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
  const alertRules = () => plugin().service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const alertRecipients = () =>
    plugin().service('alert-recipients') as ReturnType<typeof alertRecipientsFactory>;
  const repo = orderRepository({ strapi });

  const deliver = async (input: {
    event: OutboxEvent;
    template: TemplateCode;
    email: string;
    role: 'staff' | 'customer';
    /** Alerts carry no order; the delivery log column is nullable. */
    orderId?: number | null;
    locale: string;
    data: TemplateData | OpsAlertData;
  }) => {
    const recipientHash = sha256Hex(input.email.trim().toLowerCase());
    const key = { eventId: String(input.event.id), template: input.template, recipientHash };
    let row = (await deliveries().findOne({ where: key })) as {
      id: number;
      status: string;
      attempts: number;
    } | null;
    if (row && (row.status === 'sent' || row.status === 'skipped')) return;
    if (!row) {
      try {
        row = (await deliveries().create({
          data: {
            ...key,
            channel: 'email',
            recipientRole: input.role,
            orderId: input.orderId ?? null,
            messageLocale: input.locale,
            status: 'pending',
            attempts: 0,
          },
        })) as { id: number; status: string; attempts: number };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = (await deliveries().findOne({ where: key })) as typeof row;
        if (!row || row.status === 'sent' || row.status === 'skipped') return;
      }
    }
    if (!config().notifications.email.enabled) {
      await deliveries().update({ where: { id: row.id }, data: { status: 'skipped' } });
      return;
    }
    // A staff-edited `notification-template` row overrides the built-in copy; a broken one falls
    // back to the default and raises `notification-template-broken` inside renderFor.
    const rendered = await templates().renderFor(input.template, input.locale, input.data);
    try {
      await registry()
        .notificationProvider('email')
        .send({ recipient: { email: input.email }, template: input.template, data: rendered });
      await deliveries().update({
        where: { id: row.id },
        data: { status: 'sent', sentAt: new Date(), attempts: row.attempts + 1, lastError: null },
      });
    } catch (error) {
      await deliveries().update({
        where: { id: row.id },
        data: {
          status: 'failed',
          attempts: row.attempts + 1,
          lastError: String((error as Error)?.message ?? error).slice(0, 500),
        },
      });
      throw error; // the outbox retries with backoff
    }
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

  const customerEmail = (aggregate: OrderAggregate): string | undefined => {
    const email = (aggregate.order.contactSnapshot as { email?: string }).email;
    return typeof email === 'string' && email.includes('@') ? email : undefined;
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
          email: branch.email,
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
      const email = customerEmail(aggregate);
      if (email && aggregate.order.origin.kind === 'storefront') {
        await deliver({ event, template: 'customer.order-placed', email, role: 'customer', orderId, locale, data });
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
        email: branch.email,
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
          email,
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
      const email = customerEmail(aggregate);
      if (!email) return;
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
        email,
        role: 'customer',
        orderId,
        locale,
        data: { ...data, ...(reason ? { reason } : {}) },
      });
    },

    /** `order.edited`: the updated items and total. A balance link replaces the order link. */
    async onOrderEdited(event: OutboxEvent): Promise<void> {
      if (event.payload.notifyCustomer === false) return;
      const orderId = Number(event.payload.orderId);
      const aggregate = await repo.loadOrderAggregate(orderId);
      if (!aggregate) return;
      const email = customerEmail(aggregate);
      if (!email) return;
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
        email,
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
