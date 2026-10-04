import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useAuth, useFetchClient } from '@strapi/strapi/admin';

import type { ReservationInboxItem } from '../../domain/reservation-request/reservation-inbox-events';
import {
  INBOX_POLL_INTERVAL_MS,
  inboxReducer,
  initialInboxState,
  mergeNewItems,
  nextBackoffMs,
  parseSseChunk,
  type InboxMode,
} from './reservation-inbox.helper';
import type { ApiReservationInboxSummary } from './reservation-inbox.types';

export type { InboxMode };

export interface UseReservationInbox {
  mode: InboxMode;
  unreadCount: number;
  items: ReservationInboxItem[];
  markRead(documentId: string): Promise<void>;
  refresh(): Promise<void>;
}

export interface UseReservationInboxOptions {
  enabled: boolean;
  onNewItem(item: ReservationInboxItem): void;
}

const SUMMARY_PATH = '/reservation-inbox/summary';
const STREAM_PATH = '/reservation-inbox/stream';

interface SummaryEnvelope {
  data?: Partial<ApiReservationInboxSummary>;
}

const readSummary = (payload: unknown): ApiReservationInboxSummary => {
  const data = (payload as SummaryEnvelope | null)?.data;
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    unreadCount: typeof data?.unreadCount === 'number' ? data.unreadCount : 0,
  };
};

export const useReservationInbox = ({
  enabled,
  onNewItem,
}: UseReservationInboxOptions): UseReservationInbox => {
  const { get, post } = useFetchClient();
  const token = useAuth('useReservationInbox', (state) => state.token);
  const [state, dispatch] = useReducer(inboxReducer, initialInboxState);

  const stateRef = useRef(state);
  stateRef.current = state;
  const onNewItemRef = useRef(onNewItem);
  onNewItemRef.current = onNewItem;
  const clientRef = useRef({ get, post });
  clientRef.current = { get, post };
  const streamAbortRef = useRef<AbortController | null>(null);
  // Concurrent catch-ups read the same pre-render state; alert each item once.
  const notifiedRef = useRef(new Set<string>());

  const applyIncoming = useCallback(
    (incoming: ReservationInboxItem[], unreadCount?: number) => {
      const merged = mergeNewItems(
        stateRef.current.items,
        incoming,
        stateRef.current.lastSeenAt,
      );
      dispatch({ type: 'itemsArrived', items: incoming, unreadCount });
      merged.added.forEach((item) => {
        if (notifiedRef.current.has(item.documentId)) {
          return;
        }
        notifiedRef.current.add(item.documentId);
        onNewItemRef.current(item);
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    const response = await clientRef.current.get(SUMMARY_PATH);
    const summary = readSummary(response.data);
    dispatch({ type: 'refreshed', items: summary.items, unreadCount: summary.unreadCount });
  }, []);

  const refreshSince = useCallback(async () => {
    const lastSeenAt = stateRef.current.lastSeenAt;
    const query = lastSeenAt ? `?since=${encodeURIComponent(lastSeenAt)}` : '';
    const response = await clientRef.current.get(`${SUMMARY_PATH}${query}`);
    const summary = readSummary(response.data);
    applyIncoming(summary.items, summary.unreadCount);
  }, [applyIncoming]);

  const markRead = useCallback(async (documentId: string) => {
    await clientRef.current.post(
      `/reservation-inbox/${encodeURIComponent(documentId)}/read`,
    );
    dispatch({ type: 'markedRead', documentId });
  }, []);

  useEffect(() => {
    if (!enabled || !token) {
      return undefined;
    }

    let disposed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const masterAbort = new AbortController();

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const clearPollTimer = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const startPolling = () => {
      if (pollTimer !== null || disposed) {
        return;
      }
      pollTimer = setInterval(() => {
        void refreshSince().catch(() => {});
      }, INBOX_POLL_INTERVAL_MS);
    };

    const openStream = async () => {
      streamAbortRef.current?.abort();
      const streamController = new AbortController();
      streamAbortRef.current = streamController;
      const forwardAbort = () => streamController.abort();
      masterAbort.signal.addEventListener('abort', forwardAbort);

      try {
        const response = await fetch(`${window.strapi.backendURL}${STREAM_PATH}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: streamController.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`reservation inbox stream status ${response.status}`);
        }
        if (disposed || document.hidden) {
          void response.body.cancel();
          return;
        }

        attempts = 0;
        clearPollTimer();
        dispatch({ type: 'streamOpened' });
        void refreshSince().catch(() => {});

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.name !== 'reservation.created') {
              continue;
            }
            try {
              applyIncoming([JSON.parse(event.data) as ReservationInboxItem]);
            } catch {
              // Ignore malformed event payloads.
            }
          }
        }
        throw new Error('reservation inbox stream closed');
      } catch {
        if (disposed || streamController.signal.aborted) {
          return;
        }
        dispatch({ type: 'streamClosed' });
        startPolling();
        const delay = nextBackoffMs(attempts);
        attempts += 1;
        reconnectTimer = setTimeout(() => {
          if (!disposed && !document.hidden) {
            void openStream();
          }
        }, delay);
      } finally {
        masterAbort.signal.removeEventListener('abort', forwardAbort);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        streamAbortRef.current?.abort();
        clearReconnectTimer();
        clearPollTimer();
      } else {
        // Alert on requests that arrived while hidden, then resync the list.
        void refreshSince()
          .then(refresh)
          .catch(() => {});
        void openStream();
      }
    };

    void refresh().catch(() => {});
    if (!document.hidden) {
      void openStream();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearReconnectTimer();
      clearPollTimer();
      streamAbortRef.current?.abort();
      masterAbort.abort();
    };
  }, [enabled, token, applyIncoming, refresh, refreshSince]);

  return {
    mode: state.mode,
    unreadCount: state.unreadCount,
    items: state.items,
    markRead,
    refresh,
  };
};
