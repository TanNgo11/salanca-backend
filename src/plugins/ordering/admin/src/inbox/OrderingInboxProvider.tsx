import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth, useFetchClient, useRBAC } from '@strapi/strapi/admin';

import { RBAC_INBOX } from '../lib/permissions';
import type { InboxSettings, OrderDetail } from '../lib/types';
import { NewOrderDialog } from './NewOrderDialog';

const PLUGIN = 'ordering';
const POLL_MS = 20_000;
const SOUND_KEY = 'ordering.inbox.sound';

type Listener = (event: { type: string; orderId: number }) => void;

type InboxContext = {
  awaiting: number;
  settings: InboxSettings | null;
  sound: boolean;
  setSound: (on: boolean) => void;
  /** Pages subscribe to refetch when any order in scope changes. */
  subscribe: (listener: Listener) => () => void;
  /** Pages under the provider skip mounting a second one. */
  mounted: true;
};

const Context = createContext<InboxContext | null>(null);

export const useOrderingInbox = () => useContext(Context);

const readSound = (fallback: boolean): boolean => {
  try {
    const value = window.localStorage.getItem(SOUND_KEY);
    return value === null ? fallback : value === 'on';
  } catch {
    return fallback;
  }
};

/** Short two-tone chime with WebAudio — no audio file to ship or cache. */
const chime = () => {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const audio = new AudioCtor();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, audio.currentTime + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + index * 0.18 + 0.16);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + index * 0.18);
      oscillator.stop(audio.currentTime + index * 0.18 + 0.17);
    });
  } catch {
    // Autoplay policies may block sound until the first click; the dialog still shows.
  }
};

/** Parses complete `event:`/`data:` frames out of an SSE buffer. */
const parseFrames = (buffer: string) => {
  const events: Array<{ name: string; data: string }> = [];
  let rest = buffer;
  let index = rest.indexOf('\n\n');
  while (index >= 0) {
    const frame = rest.slice(0, index);
    rest = rest.slice(index + 2);
    const name = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    if (name && data) events.push({ name, data });
    index = rest.indexOf('\n\n');
  }
  return { events, rest };
};

/**
 * Realtime order inbox for every Admin page (plan step 8; screens S2). Reads the SSE stream with
 * fetch + Bearer, falls back to polling `/orders/summary` every 20 s while the stream is down, and
 * queues new orders for the "Đơn mới" dialog. Mounted globally by the host app (Salanca wraps the
 * router in `src/admin/app.tsx`); plugin pages mount it themselves when the host did not.
 */
export const OrderingInboxProvider = ({ children }: { children: ReactNode }) => {
  const parent = useContext(Context);
  if (parent) return <>{children}</>;
  return <InboxRuntime>{children}</InboxRuntime>;
};

const InboxRuntime = ({ children }: { children: ReactNode }) => {
  const { get } = useFetchClient();
  const token = useAuth('OrderingInbox', (state) => state.token);
  const { allowedActions, isLoading } = useRBAC(RBAC_INBOX);
  const canRead = !isLoading && allowedActions.canRead === true;
  const canProcess = !isLoading && allowedActions.canProcess === true;

  const [awaiting, setAwaiting] = useState(0);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [sound, setSoundState] = useState(true);
  const [queue, setQueue] = useState<OrderDetail[]>([]);
  const listeners = useRef(new Set<Listener>());
  const seen = useRef(new Set<number>());
  const since = useRef(new Date().toISOString());
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const notify = useCallback((event: { type: string; orderId: number }) => {
    listeners.current.forEach((listener) => listener(event));
  }, []);

  const enqueue = useCallback(
    async (orderId: number) => {
      if (seen.current.has(orderId)) return;
      seen.current.add(orderId);
      try {
        const { data } = await get(`/${PLUGIN}/orders/${orderId}`);
        const detail = data as OrderDetail;
        // Drafts (phone orders not yet confirmed) and handled orders never pop up; a draft is
        // queued again when its confirmation streams as `order.updated` → `open`.
        if (detail.order.status !== 'open' || detail.group?.status !== 'awaiting-acceptance') {
          seen.current.delete(orderId);
          return;
        }
        setQueue((current) => [...current, detail]);
        if (soundRef.current) chime();
      } catch {
        seen.current.delete(orderId);
      }
    },
    [get],
  );

  const refreshSummary = useCallback(async () => {
    const { data } = await get(`/${PLUGIN}/orders/summary?since=${encodeURIComponent(since.current)}`);
    const summary = data as { awaiting: number; newOrders: Array<{ id: number }>; at: string; settings: InboxSettings };
    setAwaiting(summary.awaiting);
    setSettings(summary.settings);
    since.current = summary.at;
    for (const order of summary.newOrders) {
      notify({ type: 'order.created', orderId: order.id });
      void enqueue(order.id);
    }
    return summary;
  }, [enqueue, get, notify]);

  useEffect(() => {
    if (!canRead) return;
    void refreshSummary()
      .then((summary) => setSoundState(readSound(summary.settings.soundByDefault)))
      .catch(() => {});
  }, [canRead, refreshSummary]);

  useEffect(() => {
    if (!canRead || !token) return undefined;
    let disposed = false;
    let attempts = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();
    const startPolling = () => {
      poll ??= setInterval(() => void refreshSummary().catch(() => {}), POLL_MS);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const open = async () => {
      try {
        const response = await fetch(`${window.strapi.backendURL}/${PLUGIN}/orders/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        attempts = 0;
        stopPolling();
        void refreshSummary().catch(() => {});
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseFrames(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.events) {
            try {
              const event = JSON.parse(frame.data) as { type: string; orderId: number };
              notify(event);
              if (event.type === 'order.created') {
                setAwaiting((count) => count + 1);
                void enqueue(event.orderId);
              } else if ((event as { to?: string }).to === 'open') {
                void enqueue(event.orderId);
                void refreshSummary().catch(() => {});
              } else {
                void refreshSummary().catch(() => {});
              }
            } catch {
              // ignore malformed frames
            }
          }
        }
        throw new Error('stream closed');
      } catch {
        if (disposed) return;
        startPolling();
        const delay = Math.min(30_000, 1000 * 2 ** attempts);
        attempts += 1;
        retry = setTimeout(() => void open(), delay);
      }
    };
    void open();
    return () => {
      disposed = true;
      abort.abort();
      stopPolling();
      if (retry) clearTimeout(retry);
    };
  }, [canRead, enqueue, notify, refreshSummary, token]);

  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    try {
      window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // private mode: the choice lasts for this tab only
    }
  }, []);

  const value = useMemo<InboxContext>(
    () => ({
      awaiting,
      settings,
      sound,
      setSound,
      mounted: true,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [awaiting, settings, sound, setSound],
  );

  const current = queue[0];
  return (
    <Context.Provider value={value}>
      {children}
      {current && canProcess && settings?.newOrderDialog !== false ? (
        <NewOrderDialog
          key={current.order.id}
          detail={current}
          position={1}
          total={queue.length}
          settings={settings}
          onDone={() => {
            setQueue((items) => items.slice(1));
            void refreshSummary().catch(() => {});
            notify({ type: 'order.updated', orderId: current.order.id });
          }}
        />
      ) : null}
    </Context.Provider>
  );
};
