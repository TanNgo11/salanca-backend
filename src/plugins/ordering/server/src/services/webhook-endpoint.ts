import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import { encryptSecret, decryptSecret, parseEncryptionKey } from '../domain/token-cipher';
import {
  PUBLIC_EVENTS,
  PUBLIC_EVENT_TYPES,
  type PublicEventSpec,
} from '../domain/webhooks/events';
import { checkWebhookUrl, displayUrl } from '../domain/webhooks/url-guard';
import type changeLogFactory from './change-log';
import { actorRefOf, nowOf, type ServiceContext } from './context';

export type WebhookEndpointRow = {
  id: number;
  documentId: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  includeCustomer: boolean;
  secretSealed: string;
  previousSecretSealed: string | null;
  previousSecretUntil: string | null;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  createdByRef: string | null;
};

export type EndpointInput = {
  url?: string;
  description?: string;
  events?: string[];
  includeCustomer?: boolean;
};

const DESCRIPTION_MAX = 200;

/**
 * Admin CRUD for webhook endpoints (O10 plan step 2). Secrets are generated here, sealed with
 * the plugin encryption key and returned exactly once — the row keeps only ciphertext. The URL
 * runs the SSRF guard on every write; `includeCustomer` changes are change-logged because they
 * widen the data contract with the receiver.
 */
const webhookEndpoint = ({ strapi }: { strapi: Core.Strapi }) => {
  const rows = () => strapi.db.query('plugin::ordering.webhook-endpoint');
  const deliveries = () => strapi.db.query('plugin::ordering.webhook-delivery');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const encryptionKey = (): Buffer => {
    const parsed = parseEncryptionKey(config().encryptionKey);
    if (!parsed.valid) {
      throw new OrderingError(
        'WEBHOOK_SECRET_UNAVAILABLE',
        'ordering encryptionKey is not configured; webhook secrets cannot be issued',
      );
    }
    return parsed.key;
  };

  const generateSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

  const guardedUrl = async (raw: unknown): Promise<string> => {
    const { allowHttp, allowHosts } = config().webhooks;
    const checked = await checkWebhookUrl(raw, { allowHttp, allowHosts });
    return checked.url.toString();
  };

  const validateEvents = (input: unknown): string[] => {
    const list = Array.isArray(input) ? input.filter((item) => typeof item === 'string') : [];
    const unique = [...new Set(list)];
    if (unique.length === 0) {
      throw new OrderingError('VALIDATION_ERROR', 'at least one event is required', {
        details: { field: 'events' },
      });
    }
    const unknown = unique.filter((type) => !PUBLIC_EVENT_TYPES.includes(type));
    if (unknown.length > 0) {
      throw new OrderingError('VALIDATION_ERROR', 'unknown event types', {
        details: { field: 'events', unknown },
      });
    }
    return unique;
  };

  const validateDescription = (input: unknown): string | null => {
    if (input === undefined || input === null) return null;
    if (typeof input !== 'string') {
      throw new OrderingError('VALIDATION_ERROR', 'description must be a string', {
        details: { field: 'description' },
      });
    }
    const trimmed = input.trim();
    if (trimmed.length > DESCRIPTION_MAX) {
      throw new OrderingError('VALIDATION_ERROR', 'description is too long', {
        details: { field: 'description' },
      });
    }
    return trimmed === '' ? null : trimmed;
  };

  const findRow = async (id: number): Promise<WebhookEndpointRow> => {
    const row = (await rows().findOne({ where: { id } })) as WebhookEndpointRow | null;
    if (!row) throw new OrderingError('WEBHOOK_NOT_FOUND', 'webhook endpoint not found');
    return row;
  };

  /** Shape safe for the Admin: the URL never carries its query string, secrets never leave. */
  const view = (row: WebhookEndpointRow) => ({
    id: row.id,
    url: displayUrl(row.url),
    description: row.description,
    events: row.events,
    active: row.active,
    includeCustomer: row.includeCustomer,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt,
    disabledReason: row.disabledReason,
    createdByRef: row.createdByRef,
  });

  /** Change-log snapshot: sanitized URL, no secret material at all. */
  const snapshot = (row: WebhookEndpointRow) => ({
    url: displayUrl(row.url),
    description: row.description,
    events: row.events,
    active: row.active,
    includeCustomer: row.includeCustomer,
  });

  const statsFor = async (endpointId: number, since: Date) => {
    const recent = (await deliveries().findMany({
      where: { endpointId, createdAt: { $gte: since } },
      select: ['status', 'attempts'],
    })) as { status: string; attempts: number }[];
    return {
      succeeded: recent.filter((row) => row.status === 'succeeded').length,
      failed: recent.filter(
        (row) => row.status === 'failed' || (row.status === 'pending' && row.attempts > 0),
      ).length,
    };
  };

  return {
    async list(_ctx: ServiceContext) {
      const all = (await rows().findMany({ orderBy: { id: 'asc' } })) as WebhookEndpointRow[];
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return Promise.all(
        all.map(async (row) => ({ ...view(row), stats24h: await statsFor(row.id, since) })),
      );
    },

    async get(id: number, _ctx: ServiceContext) {
      return view(await findRow(id));
    },

    eventCatalog(_ctx: ServiceContext) {
      return PUBLIC_EVENTS.map((spec: PublicEventSpec) => ({
        type: spec.type,
        group: spec.group,
        description: spec.description,
        orderScoped: spec.orderScoped,
        sample: spec.sample,
      }));
    },

    async create(input: EndpointInput, ctx: ServiceContext) {
      const url = await guardedUrl(input.url);
      const events = validateEvents(input.events);
      const description = validateDescription(input.description);
      const secret = generateSecret();
      const row = (await rows().create({
        data: {
          url,
          description,
          events,
          active: true,
          includeCustomer: input.includeCustomer === true,
          secretSealed: encryptSecret(secret, encryptionKey()),
          consecutiveFailures: 0,
          createdByRef: actorRefOf(ctx),
        },
      })) as WebhookEndpointRow;
      await changeLog().record(
        {
          action: 'webhook-endpoint.create',
          entityType: 'webhook-endpoint',
          entityId: row.id,
          entityLabel: displayUrl(url),
          after: snapshot(row),
        },
        ctx,
      );
      // The plaintext secret is returned here and nowhere else — it is never written to a log.
      return { endpoint: view(row), secret };
    },

    async update(id: number, input: EndpointInput, ctx: ServiceContext) {
      const before = await findRow(id);
      const patch: Record<string, unknown> = {};
      if (input.url !== undefined) patch.url = await guardedUrl(input.url);
      if (input.events !== undefined) patch.events = validateEvents(input.events);
      if (input.description !== undefined) {
        patch.description = validateDescription(input.description);
      }
      if (input.includeCustomer !== undefined) {
        patch.includeCustomer = input.includeCustomer === true;
      }
      const row = (await rows().update({ where: { id }, data: patch })) as WebhookEndpointRow;
      await changeLog().record(
        {
          action: 'webhook-endpoint.update',
          entityType: 'webhook-endpoint',
          entityId: id,
          entityLabel: displayUrl(row.url),
          before: snapshot(before),
          after: snapshot(row),
        },
        ctx,
      );
      return { endpoint: view(row) };
    },

    /**
     * Issues a new secret, keeps the previous one usable for `rotationGraceHours` (the
     * dispatcher signs with both so receivers can rotate on their own schedule).
     */
    async rotateSecret(id: number, ctx: ServiceContext) {
      const before = await findRow(id);
      const secret = generateSecret();
      const until = new Date(
        nowOf(ctx).getTime() + config().webhooks.rotationGraceHours * 60 * 60 * 1000,
      );
      const row = (await rows().update({
        where: { id },
        data: {
          secretSealed: encryptSecret(secret, encryptionKey()),
          previousSecretSealed: before.secretSealed,
          previousSecretUntil: until,
        },
      })) as WebhookEndpointRow;
      await changeLog().record(
        {
          action: 'webhook-endpoint.rotate-secret',
          entityType: 'webhook-endpoint',
          entityId: id,
          entityLabel: displayUrl(row.url),
          after: { rotated: true },
        },
        ctx,
      );
      return { endpoint: view(row), secret };
    },

    async setActive(id: number, active: boolean, ctx: ServiceContext) {
      const before = await findRow(id);
      const now = nowOf(ctx);
      const data = active
        ? { active: true, consecutiveFailures: 0, disabledAt: null, disabledReason: null }
        : { active: false, disabledAt: now, disabledReason: 'manual' };
      const row = (await rows().update({ where: { id }, data })) as WebhookEndpointRow;
      await changeLog().record(
        {
          action: 'webhook-endpoint.set-active',
          entityType: 'webhook-endpoint',
          entityId: id,
          entityLabel: displayUrl(row.url),
          before: { active: before.active },
          after: { active },
        },
        ctx,
      );
      return { endpoint: view(row) };
    },

    /**
     * Signing material for the dispatcher (server-side only — never exposed through a route):
     * the current secret plus the previous one while its grace window is still open.
     */
    async signingSecrets(row: WebhookEndpointRow, now: Date): Promise<string[]> {
      const key = encryptionKey();
      const secrets = [decryptSecret(row.secretSealed, key)];
      if (
        row.previousSecretSealed &&
        row.previousSecretUntil &&
        new Date(row.previousSecretUntil).getTime() > now.getTime()
      ) {
        secrets.push(decryptSecret(row.previousSecretSealed, key));
      }
      return secrets;
    },

    /** Internal: full row for the dispatcher (raw URL, sealed secrets). Not route-reachable. */
    async findRaw(id: number): Promise<WebhookEndpointRow | null> {
      return (await rows().findOne({ where: { id } })) as WebhookEndpointRow | null;
    },
  };
};

export default webhookEndpoint;
