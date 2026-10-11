import { EventEmitter } from 'node:events';

import type { Core } from '@strapi/strapi';

/**
 * In-process fan-out for the realtime inbox (plan step 8; contracts §21.9: one instance in v1).
 * Events are published only after the surrounding transaction commits (see `outbox.enqueue`), so
 * a rolled-back order never shows up. Payloads carry ids and the branch ref only — the SSE route
 * filters by the viewer's scope and the page refetches details through the scoped API.
 */
export type StreamEvent =
  | { type: 'order.created'; orderId: number; code?: string; locationRef: string }
  | { type: 'order.updated'; orderId: number; locationRef: string; to?: string };

const orderStream = (_deps: { strapi: Core.Strapi }) => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    publish(event: StreamEvent): void {
      emitter.emit('event', event);
    },
    subscribe(listener: (event: StreamEvent) => void): () => void {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
    listenerCount(): number {
      return emitter.listenerCount('event');
    },
  };
};

export default orderStream;
