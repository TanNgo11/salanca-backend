import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError, isOrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import {
  laterDeadline,
  paymentDeadline,
  paymentDeadlineStoreKey,
  paymentWindowStart,
} from '../domain/payments/deadline';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../domain/token-cipher';
import { isOnlinePaymentProvider } from '../providers/cash';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type orderServiceFactory from './order';
import type { OrderingRegistry } from './registry';

/** Same shape as the order token: `randomBytes(32).toString('base64url')`. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type StoredLink = { tokenHash: string; expiresAt: string; cipher: string };

type PluginStore = {
  get(params: { key: string }): Promise<unknown>;
  set(params: { key: string; value: unknown }): Promise<unknown>;
  delete(params: { key: string }): Promise<unknown>;
};

const paymentTokenStoreKey = (hash: string): string => `payment-token:${hash}`;
const paymentLinkStoreKey = (orderId: number): string => `payment-link:${orderId}`;

const orderIdOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
};

const asLink = (value: unknown): StoredLink | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.tokenHash !== 'string' || typeof row.expiresAt !== 'string' || typeof row.cipher !== 'string') {
    return null;
  }
  return { tokenHash: row.tokenHash, expiresAt: row.expiresAt, cipher: row.cipher };
};

const live = (link: StoredLink, now: Date): boolean => {
  const at = new Date(link.expiresAt).getTime();
  return Number.isFinite(at) && at > now.getTime();
};

/**
 * Staff payment link (contracts §21.3). A second bearer, sealed in the plugin store, opens only
 * the QR page. The order token is untouched. While the link is unexpired, issuing again returns
 * the same URL so a message already sent keeps working. A new link extends the order deadline.
 */
const paymentLink = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const orders = () => plugin().service('order') as ReturnType<typeof orderServiceFactory>;
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const changeLog = () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const store = () => strapi.store({ type: 'plugin', name: 'ordering' }) as unknown as PluginStore;

  const encryptionKey = (): Buffer => {
    const parsed = parseEncryptionKey(config().encryptionKey);
    if (!parsed.valid) {
      throw new OrderingError('CONFIG_INVALID', 'ORDERING_ENCRYPTION_KEY is not configured');
    }
    return parsed.key;
  };

  const paymentUrl = (token: string): string => {
    const template = config().notifications.orderLinkTemplate;
    const swapped = template.includes('#t=') ? template.replace('#t=', '#p=') : template;
    if (!swapped.includes('{token}')) {
      throw new OrderingError('CONFIG_INVALID', 'order link template has no token placeholder');
    }
    return swapped.replace('{token}', token);
  };

  return {
    /**
     * Later of the placement window and a stored extension. Presentation and the expiry job
     * both read this, so a new link keeps the QR up and the order alive.
     */
    async effectiveDeadline(orderId: number, start: Date, timeoutMinutes: number): Promise<Date> {
      const stored = await store().get({ key: paymentDeadlineStoreKey(orderId) });
      return laterDeadline(
        paymentDeadline(start, timeoutMinutes),
        typeof stored === 'string' ? stored : null,
      );
    },

    /** `{ expiresAt } | null` for the order screen. Never the token or the URL. */
    async summary(orderId: number): Promise<{ expiresAt: string } | null> {
      const link = asLink(await store().get({ key: paymentLinkStoreKey(orderId) }));
      return link ? { expiresAt: link.expiresAt } : null;
    },

    /**
     * Order id for a payment-link bearer, or null when the token is unknown or expired.
     * Callers that already resolved an order token must not call this.
     */
    async resolve(token: unknown, now: Date): Promise<number | null> {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
      const hash = sha256Hex(token);
      const orderId = orderIdOf(await store().get({ key: paymentTokenStoreKey(hash) }));
      if (orderId === null) return null;
      const link = asLink(await store().get({ key: paymentLinkStoreKey(orderId) }));
      if (!link || link.tokenHash !== hash || !live(link, now)) return null;
      return orderId;
    },

    /**
     * POST /orders/:id/payment-link. Out of scope is 404. Only an order that is awaiting
     * payment on a branch with an online provider. A live link is returned unchanged.
     */
    async issue(
      orderId: number,
      ctx: ServiceContext,
    ): Promise<{ url: string; expiresAt: string; replayed: boolean }> {
      const aggregate = await orders().getOrder(orderId, ctx);
      const waiting = aggregate.groups.find((group) => group.status === 'awaiting-payment');
      const branch = await branches().findByCode(aggregate.order.locationRef);
      const settings = branches().pickupSettings(branch ?? { fulfillment: null });
      const online = settings.paymentProviders.some((code) => {
        if (!registry().hasPaymentProvider(code)) return false;
        return isOnlinePaymentProvider(registry().paymentProvider(code));
      });
      if (!waiting || !online) {
        throw new OrderingError('VALIDATION_ERROR', 'this order is not waiting for an online payment');
      }

      const now = nowOf(ctx);
      const existing = asLink(await store().get({ key: paymentLinkStoreKey(orderId) }));
      if (existing && live(existing, now)) {
        try {
          const token = decryptSecret(existing.cipher, encryptionKey());
          if (TOKEN_PATTERN.test(token) && sha256Hex(token) === existing.tokenHash) {
            return { url: paymentUrl(token), expiresAt: existing.expiresAt, replayed: true };
          }
        } catch (error) {
          if (isOrderingError(error)) throw error;
        }
      }

      if (existing?.tokenHash) {
        await store().delete({ key: paymentTokenStoreKey(existing.tokenHash) });
      }
      const token = randomBytes(32).toString('base64url');
      const tokenHash = sha256Hex(token);
      const timeout = settings.paymentTimeoutMinutes;
      const expiresAt = new Date(now.getTime() + timeout * 60_000).toISOString();
      await store().set({ key: paymentTokenStoreKey(tokenHash), value: orderId });
      await store().set({
        key: paymentLinkStoreKey(orderId),
        value: { tokenHash, expiresAt, cipher: encryptSecret(token, encryptionKey()) },
      });

      const history = (await strapi.db.query('plugin::ordering.order-event').findMany({
        where: { order: orderId, type: 'fulfillment-group.transitioned' },
      })) as Array<{ occurredAt: string; payload: { groupId?: unknown; to?: unknown } | null }>;
      const start = paymentWindowStart({
        placedAt: new Date(aggregate.order.placedAt),
        groupId: waiting.id,
        events: history.map((row) => ({ ...row, type: 'fulfillment-group.transitioned' })),
      });
      const stored = await store().get({ key: paymentDeadlineStoreKey(orderId) });
      const current = laterDeadline(
        paymentDeadline(start, timeout),
        typeof stored === 'string' ? stored : null,
      );
      const issuedAt = new Date(expiresAt);
      const next = issuedAt.getTime() > current.getTime() ? issuedAt : current;
      await store().set({ key: paymentDeadlineStoreKey(orderId), value: next.toISOString() });
      // O15: a new link extends the payment window — staff accountability. Never the token/URL.
      await changeLog().record(
        {
          action: 'payment-link.issue',
          entityType: 'order',
          entityId: orderId,
          entityLabel: aggregate.order.code,
          orderId,
          locationRef: aggregate.order.locationRef,
          after: { expiresAt, paymentDeadline: next.toISOString() },
        },
        ctx,
      );
      return { url: paymentUrl(token), expiresAt, replayed: false };
    },
  };
};

export default paymentLink;
