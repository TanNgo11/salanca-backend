import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { OutboxEvent } from '../contracts/outbox';
import { OrderingError } from '../domain/errors';
import {
  PING_EVENT_TYPE,
  PUBLIC_EVENT_TYPES,
  WEBHOOK_API_VERSION,
  publicPayload,
} from '../domain/webhooks/events';
import { checkWebhookUrl, displayUrl, type CheckedWebhookUrl } from '../domain/webhooks/url-guard';
import type { TransactionClient } from '../migrations/runner';
import type alertFactory from './alert';
import type changeLogFactory from './change-log';
import { nowOf, type ServiceContext } from './context';
import type webhookEndpointFactory from './webhook-endpoint';
import type { WebhookEndpointRow } from './webhook-endpoint';

const TABLE = 'plugins_ordering_webhook_delivery';

/** Fixed attempt schedule in seconds (plan): 1m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 24h. */
export const RETRY_SCHEDULE_SECONDS = [60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400];

const documentId = () => randomBytes(18).toString('base64url').slice(0, 24);

const hmacHex = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

export type DeliveryRow = {
  id: number;
  endpointId: number;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  leaseUntil: string | null;
  lockedBy: string | null;
  succeededAt: string | null;
  createdAt: string;
};

export type DeliveryAttempt = {
  ok: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
};

type PostResult = { statusCode?: number; error?: string; durationMs: number };

/**
 * One POST attempt through the checked channel: DNS was already resolved and verified by the
 * url-guard, so the request pins the first verified address through a custom `lookup` — TLS SNI
 * and the Host header keep the real hostname while a rebinding change can no longer reroute the
 * connection. No redirects are followed; the response body is read for at most
 * `maxResponseBytes` then discarded (it is never stored or logged).
 */
const postOnce = (
  checked: CheckedWebhookUrl,
  headers: Record<string, string>,
  body: string,
  options: { timeoutMs: number; maxResponseBytes: number },
): Promise<PostResult> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const { url, addresses } = checked;
    const pinned = addresses[0];
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
        lookup: (_hostname, _options, callback) => callback(null, pinned, isIP(pinned)),
      },
      (response) => {
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > options.maxResponseBytes) response.destroy();
        });
        const finish = () =>
          resolve({ statusCode: response.statusCode, durationMs: Date.now() - startedAt });
        response.on('end', finish);
        response.on('close', finish);
        response.on('error', finish);
      },
    );
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(Object.assign(new Error('request timed out'), { code: 'ETIME' }));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      const code = typeof error.code === 'string' ? error.code : 'error';
      resolve({ error: code, durationMs: Date.now() - startedAt });
    });
    request.write(body);
    request.end();
  });

/**
 * Fanout + delivery for outbound webhooks (O10 plan step 3). The fanout is a plain outbox
 * consumer that only writes pending `webhook-delivery` rows — HTTP never runs inside an outbox
 * lease. The dispatcher claims due rows (`FOR UPDATE SKIP LOCKED` + lease, same shape as the
 * outbox claim), posts the signed body and records the outcome against the retry schedule.
 * 50 consecutive endpoint failures auto-disable and raise `webhook-endpoint-disabled`.
 */
const webhookDelivery = ({ strapi }: { strapi: Core.Strapi }) => {
  const deliveries = () => strapi.db.query('plugin::ordering.webhook-delivery');
  const endpoints = () => strapi.db.query('plugin::ordering.webhook-endpoint');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const endpointService = () =>
    strapi.plugin('ordering').service('webhook-endpoint') as ReturnType<
      typeof webhookEndpointFactory
    >;
  const alerts = () =>
    strapi.plugin('ordering').service('alert') as ReturnType<typeof alertFactory>;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const systemCtx = (now: Date): ServiceContext => ({
    actor: { kind: 'system', actorRef: 'webhook-dispatcher' },
    now,
  });

  /** Customer snapshot for an includeCustomer endpoint — never called otherwise. */
  const customerFor = async (orderId: number) => {
    const order = (await orders().findOne({
      where: { id: orderId },
      select: ['contactSnapshot', 'receiveMethod'],
    })) as {
      contactSnapshot?: { name?: string; phone?: string; email?: string } | null;
      receiveMethod?: { kind?: string; address?: Record<string, unknown> } | null;
    } | null;
    if (!order) return undefined;
    const contact = order.contactSnapshot ?? {};
    return {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      ...(order.receiveMethod?.kind === 'delivery' && order.receiveMethod.address
        ? { address: order.receiveMethod.address }
        : {}),
    };
  };

  const claimBatch = async (input: {
    owner: string;
    now: Date;
    batchSize: number;
    leaseSeconds: number;
  }): Promise<DeliveryRow[]> => {
    const leaseUntil = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const ids = await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
      const { rows } = await trx.raw(
        `SELECT id FROM ${TABLE}
           WHERE status = 'pending' AND next_attempt_at <= ?
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ?`,
        [input.now, input.now, input.batchSize],
      );
      const claimed = (rows as Array<{ id: number }>).map((row) => row.id);
      if (claimed.length === 0) return claimed;
      await trx.raw(
        `UPDATE ${TABLE}
           SET locked_by = ?, lease_until = ?, updated_at = ?
           WHERE id = ANY(?)`,
        [input.owner, leaseUntil, input.now, claimed],
      );
      return claimed;
    });
    if (ids.length === 0) return [];
    return (await deliveries().findMany({
      where: { id: { $in: ids } },
      orderBy: { id: 'asc' },
    })) as unknown as DeliveryRow[];
  };

  const attemptDelivery = async (
    row: DeliveryRow,
    endpoint: WebhookEndpointRow,
    now: Date,
  ): Promise<DeliveryAttempt> => {
    const { allowHttp, allowHosts, timeoutMs, maxResponseBytes } = config().webhooks;
    let checked: CheckedWebhookUrl;
    try {
      checked = await checkWebhookUrl(endpoint.url, { allowHttp, allowHosts });
    } catch (error) {
      const reason =
        error instanceof OrderingError && typeof error.details?.reason === 'string'
          ? error.details.reason
          : 'invalid';
      return { ok: false, error: `url-check:${reason}`, durationMs: 0 };
    }
    const secrets = await endpointService().signingSecrets(endpoint, now);
    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(now.getTime() / 1000);
    const signatures = secrets.map((secret) => `v1=${hmacHex(secret, `${timestamp}.${body}`)}`);
    const result = await postOnce(
      checked,
      {
        'content-type': 'application/json',
        'x-ordering-signature': `t=${timestamp},${signatures.join(',')}`,
        'x-ordering-event': row.eventType,
        'x-ordering-delivery': String(row.id),
      },
      body,
      { timeoutMs, maxResponseBytes },
    );
    const statusCode = result.statusCode;
    const ok = statusCode !== undefined && statusCode >= 200 && statusCode < 300;
    return {
      ok,
      statusCode,
      error: ok ? undefined : (result.error ?? `http-${statusCode ?? 'none'}`),
      durationMs: result.durationMs,
    };
  };

  /** Bumps the endpoint failure counter; disables + alerts at the configured streak. */
  const trackFailure = async (endpoint: WebhookEndpointRow, now: Date) => {
    const { rows: updated } = await strapi.db.connection.raw(
      `UPDATE plugins_ordering_webhook_endpoint
         SET consecutive_failures = consecutive_failures + 1, updated_at = ?
         WHERE id = ? RETURNING consecutive_failures AS failures`,
      [now, endpoint.id],
    );
    const failures = Number((updated as Array<{ failures: number }>)[0]?.failures ?? 0);
    if (failures >= config().webhooks.disableAfterFailures && endpoint.active) {
      await endpoints().update({
        where: { id: endpoint.id },
        data: { active: false, disabledAt: now, disabledReason: 'auto-failures' },
      });
      await alerts().open(
        {
          alertCode: 'webhook-endpoint-disabled',
          dedupeKey: `webhook-endpoint:${endpoint.id}`,
          severity: 'critical',
          aggregateRef: `webhook-endpoint:${endpoint.id}`,
        },
        systemCtx(now),
      );
    }
  };

  const resetFailures = async (endpoint: WebhookEndpointRow) => {
    if ((endpoint.consecutiveFailures ?? 0) <= 0) return;
    await endpoints().update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: 0 },
    });
  };

  /** Fenced outcome write — a lost lease can no longer mark the row. */
  const finishClaimed = async (
    row: DeliveryRow,
    owner: string,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    const written = await strapi.db
      .connection(TABLE)
      .where({ id: row.id, locked_by: owner })
      .update({ ...patch, locked_by: null, lease_until: null, updated_at: new Date() });
    return written === 1;
  };

  const deliverClaimed = async (
    row: DeliveryRow,
    owner: string,
    now: Date,
  ): Promise<'delivered' | 'retried' | 'failed'> => {
    const endpoint = (await endpoints().findOne({
      where: { id: row.endpointId },
    })) as WebhookEndpointRow | null;
    const { maxAttempts } = config().webhooks;
    if (!endpoint || !endpoint.active) {
      await finishClaimed(row, owner, {
        status: 'failed',
        last_error: 'endpoint-inactive',
        attempts: row.attempts + 1,
      });
      return 'failed';
    }
    const attempt = await attemptDelivery(row, endpoint, now);
    const attempts = row.attempts + 1;
    if (attempt.ok) {
      await finishClaimed(row, owner, {
        status: 'succeeded',
        attempts,
        succeeded_at: now,
        last_status_code: attempt.statusCode ?? null,
        last_duration_ms: attempt.durationMs,
        last_error: null,
      });
      await resetFailures(endpoint);
      return 'delivered';
    }
    await trackFailure(endpoint, now);
    if (attempts >= maxAttempts) {
      await finishClaimed(row, owner, {
        status: 'failed',
        attempts,
        last_status_code: attempt.statusCode ?? null,
        last_duration_ms: attempt.durationMs,
        last_error: attempt.error ?? null,
      });
      return 'failed';
    }
    const delay = RETRY_SCHEDULE_SECONDS[Math.min(attempts - 1, RETRY_SCHEDULE_SECONDS.length - 1)];
    await finishClaimed(row, owner, {
      attempts,
      next_attempt_at: new Date(now.getTime() + delay * 1000),
      last_status_code: attempt.statusCode ?? null,
      last_duration_ms: attempt.durationMs,
      last_error: attempt.error ?? null,
    });
    return 'retried';
  };

  const deliveryView = (row: DeliveryRow) => {
    const data = (row.payload?.data ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      lastStatusCode: row.lastStatusCode,
      lastError: row.lastError,
      lastDurationMs: row.lastDurationMs,
      succeededAt: row.succeededAt,
      createdAt: row.createdAt,
      orderCode: typeof data.code === 'string' ? data.code : null,
      payload: row.payload,
    };
  };

  return {
    /**
     * Outbox consumer `webhooks.fanout`: writes one pending delivery per subscribed active
     * endpoint. The insert is claim-invisible (`next_attempt_at` stays NULL) until the payload
     * update lands, so the dispatcher can never read an empty body; ON CONFLICT makes replays
     * of the same outbox event idempotent.
     */
    async fanout(event: OutboxEvent): Promise<void> {
      if (!PUBLIC_EVENT_TYPES.includes(event.type)) return;
      const now = new Date();
      const active = (await endpoints().findMany({
        where: { active: true },
      })) as WebhookEndpointRow[];
      for (const endpoint of active) {
        if (!Array.isArray(endpoint.events) || !endpoint.events.includes(event.type)) continue;
        const { rows: inserted } = await strapi.db.connection.raw(
          `INSERT INTO ${TABLE}
             (endpoint_id, event_id, event_type, payload, status, attempts,
              document_id, created_at, updated_at)
           VALUES (?, ?, ?, '{}', 'pending', 0, ?, ?, ?)
           ON CONFLICT (endpoint_id, event_id) DO NOTHING
           RETURNING id`,
          [endpoint.id, String(event.id), event.type, documentId(), now, now],
        );
        const id = (inserted as Array<{ id: number }>)[0]?.id;
        if (id === undefined) continue; // already fanned out for this endpoint+event
        const customer =
          endpoint.includeCustomer && event.payload?.orderId != null
            ? await customerFor(Number(event.payload.orderId))
            : undefined;
        const envelope = publicPayload(String(id), event, {
          includeCustomer: endpoint.includeCustomer,
          customer,
        });
        if (envelope === null) {
          // Unknown to the catalog (should be unreachable — fanout filters PUBLIC_EVENT_TYPES):
          // drop the just-inserted row so nothing claim-invisible is left behind.
          await strapi.db.connection.raw(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
          continue;
        }
        await strapi.db.connection.raw(
          `UPDATE ${TABLE} SET payload = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
          [JSON.stringify(envelope), now, now, id],
        );
      }
    },

    /**
     * Claims and sends due deliveries until the queue drains or `maxBatchesPerRun` is hit.
     * Multi-process safe: the claim is `FOR UPDATE SKIP LOCKED`, every outcome write is fenced
     * on `locked_by`.
     */
    async dispatch(input: { owner: string; now?: Date }) {
      const now = input.now ?? new Date();
      const { batchSize, leaseSeconds, maxBatchesPerRun } = config().webhooks;
      const totals = { claimed: 0, delivered: 0, retried: 0, failed: 0 };
      for (let batch = 0; batch < maxBatchesPerRun; batch += 1) {
        const rows = await claimBatch({ owner: input.owner, now, batchSize, leaseSeconds });
        if (rows.length === 0) break;
        totals.claimed += rows.length;
        for (const row of rows) {
          const outcome = await deliverClaimed(row, input.owner, now);
          totals[outcome === 'delivered' ? 'delivered' : outcome === 'retried' ? 'retried' : 'failed'] += 1;
        }
      }
      return totals;
    },

    /**
     * "Gửi thử": a synthetic `ordering.ping` delivery attempted synchronously so the result
     * (HTTP code, duration, short error) is shown right away; a failed ping retries on the
     * normal schedule like any delivery.
     */
    async sendTest(endpointId: number, ctx: ServiceContext) {
      const endpoint = (await endpoints().findOne({
        where: { id: endpointId },
      })) as WebhookEndpointRow | null;
      if (!endpoint) {
        throw new OrderingError('WEBHOOK_NOT_FOUND', 'webhook endpoint not found');
      }
      const now = nowOf(ctx);
      const row = (await deliveries().create({
        data: {
          endpointId: endpoint.id,
          eventId: `ping:${randomUUID()}`,
          eventType: PING_EVENT_TYPE,
          payload: {},
          status: 'pending',
          attempts: 0,
        },
      })) as unknown as DeliveryRow;
      const envelope = {
        id: String(row.id),
        type: PING_EVENT_TYPE,
        apiVersion: WEBHOOK_API_VERSION,
        occurredAt: now.toISOString(),
        data: { ping: true },
      };
      const attempt = await attemptDelivery({ ...row, payload: envelope }, endpoint, now);
      const status = attempt.ok ? 'succeeded' : 'pending';
      const delay = RETRY_SCHEDULE_SECONDS[0];
      await deliveries().update({
        where: { id: row.id },
        data: {
          payload: envelope,
          status,
          attempts: 1,
          succeededAt: attempt.ok ? now : null,
          nextAttemptAt: attempt.ok ? null : new Date(now.getTime() + delay * 1000),
          lastStatusCode: attempt.statusCode ?? null,
          lastDurationMs: attempt.durationMs,
          lastError: attempt.ok ? null : (attempt.error ?? null),
        },
      });
      if (attempt.ok) await resetFailures(endpoint);
      else await trackFailure(endpoint, now);
      await changeLog().record(
        {
          action: 'webhook-endpoint.test',
          entityType: 'webhook-endpoint',
          entityId: endpoint.id,
          entityLabel: displayUrl(endpoint.url),
          after: { statusCode: attempt.statusCode ?? null, ok: attempt.ok },
        },
        ctx,
      );
      return {
        deliveryId: row.id,
        ok: attempt.ok,
        statusCode: attempt.statusCode ?? null,
        durationMs: attempt.durationMs,
        error: attempt.error ?? null,
      };
    },

    /** Failed/succeeded delivery back to pending — a new attempt of the SAME delivery. */
    async resend(deliveryId: number, ctx: ServiceContext) {
      const row = (await deliveries().findOne({
        where: { id: deliveryId },
      })) as DeliveryRow | null;
      if (!row) {
        throw new OrderingError('WEBHOOK_DELIVERY_NOT_FOUND', 'webhook delivery not found');
      }
      const now = nowOf(ctx);
      const updated = (await deliveries().update({
        where: { id: deliveryId },
        data: { status: 'pending', nextAttemptAt: now, leaseUntil: null, lockedBy: null },
      })) as unknown as DeliveryRow;
      await changeLog().record(
        {
          action: 'webhook-delivery.resend',
          entityType: 'webhook-delivery',
          entityId: deliveryId,
          after: { eventType: row.eventType, attempts: row.attempts },
        },
        ctx,
      );
      return { delivery: deliveryView(updated) };
    },

    async listDeliveries(
      endpointId: number,
      filter: { status?: string; page?: number; pageSize?: number },
    ) {
      const page = Math.max(1, filter.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
      const where: Record<string, unknown> = { endpointId };
      if (filter.status && ['pending', 'succeeded', 'failed'].includes(filter.status)) {
        where.status = filter.status;
      }
      const [results, total] = await Promise.all([
        deliveries().findMany({
          where,
          orderBy: { id: 'desc' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        deliveries().count({ where }),
      ]);
      return {
        results: (results as unknown as DeliveryRow[]).map(deliveryView),
        pagination: { page, pageSize, total },
      };
    },
  };
};

export default webhookDelivery;
