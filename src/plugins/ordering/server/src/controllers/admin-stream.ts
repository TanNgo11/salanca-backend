import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import type orderStreamFactory from '../services/order-stream';
import type scopeFactory from '../services/scope';
import { adminContext, sendError, type HttpCtx } from './http';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  // Same anti-buffering header the app's reservation inbox uses behind proxies.
  'X-Accel-Buffering': 'no',
} as const;
const HEARTBEAT_MS = 25_000;

type RawCtx = HttpCtx & {
  respond?: boolean;
  res: NodeJS.WritableStream & {
    writeHead(status: number, headers: Record<string, string>): void;
    on(event: 'close', listener: () => void): void;
    end(): void;
  };
};

/**
 * GET /ordering/orders/stream — Server-Sent Events for the realtime inbox (plan step 8). The admin
 * page reads it with `fetch` + `Authorization: Bearer` (EventSource cannot send headers, and the
 * admin JWT must never sit in a URL). Only events of branches inside the viewer's scope are
 * written; the page refetches details through the scoped API. One instance in v1.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async stream(ctx: RawCtx) {
    const serviceCtx = await adminContext(strapi, ctx);
    let staffScope;
    try {
      staffScope = await (strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>).loadScope(
        serviceCtx,
      );
      if (staffScope === null) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    } catch (error) {
      sendError(ctx, error, serviceCtx.requestId);
      return;
    }
    const stream = strapi.plugin('ordering').service('order-stream') as ReturnType<typeof orderStreamFactory>;
    ctx.respond = false;
    ctx.status = 200;
    ctx.res.writeHead(200, { ...SSE_HEADERS });
    const write = (chunk: string) => {
      try {
        ctx.res.write(chunk);
      } catch (error) {
        strapi.log.warn(`[ordering] inbox stream write failed: ${(error as Error)?.message ?? error}`);
      }
    };
    write(': connected\n\n');
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    const unsubscribe = stream.subscribe((event) => {
      if (!scopeIncludes(staffScope, event.locationRef)) return;
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    let cleaned = false;
    ctx.res.on('close', () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      try {
        ctx.res.end();
      } catch {
        // socket already closed
      }
    });
  },
});
