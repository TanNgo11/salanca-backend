import { createHmac, timingSafeEqual } from 'node:crypto';

export const SPIKE_SIGNATURE_HEADER = 'x-spike-signature';
export const SPIKE_TIMESTAMP_HEADER = 'x-spike-timestamp';

export function readUnparsedBody(request: { body?: unknown; rawBody?: unknown }): Buffer | null {
  const body = request.rawBody ?? (request.body as Record<PropertyKey, unknown> | undefined)?.[
    Symbol.for('unparsedBody')
  ];
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  return null;
}

export function signSpikeBody(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString()}`).digest('hex');
  return `sha256=${digest}`;
}

export function verifySpikeSignature(secret: string, timestamp: string, rawBody: Buffer, signature: string): boolean {
  if (!/^\d{10,13}$/.test(timestamp) || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signSpikeBody(secret, timestamp, rawBody));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function spikeWebhookController(ctx: {
  request: { body?: unknown; rawBody?: unknown; headers: Record<string, string | undefined> };
  status: number;
  body: unknown;
}, strapi: { config: { get: (key: string) => unknown } }) {
  const rawBody = readUnparsedBody(ctx.request);
  const config = strapi.config.get('plugin::ordering') as { spike?: { enabled?: boolean; webhookSecret?: string } };
  const timestamp = ctx.request.headers[SPIKE_TIMESTAMP_HEADER] ?? '';
  const signature = ctx.request.headers[SPIKE_SIGNATURE_HEADER] ?? '';
  if (!rawBody || !config.spike?.enabled) { ctx.status = 404; ctx.body = { error: 'SPIKE_DISABLED' }; return; }
  if (!verifySpikeSignature(config.spike.webhookSecret ?? '', timestamp, rawBody, signature)) {
    ctx.status = 401; ctx.body = { error: 'INVALID_SIGNATURE' }; return;
  }
  ctx.status = 200;
  ctx.body = { ok: true, bytes: rawBody.byteLength };
}
