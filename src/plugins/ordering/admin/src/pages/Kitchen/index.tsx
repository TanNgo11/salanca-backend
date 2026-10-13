import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Field, Flex, Loader, TextInput, Typography } from '@strapi/design-system';
import { useAuth, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useSearchParams } from 'react-router-dom';

import { minutesSince, formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_KITCHEN } from '../../lib/permissions';

type KitchenLine = {
  id: number;
  title: string;
  quantity: number;
  options: Array<{ groupName?: string; optionName?: string; quantity?: number }>;
  note: string | null;
  station: string;
  preparedAt: string | null;
};

type KitchenOrder = {
  orderId: number;
  groupId: number;
  code: string;
  status: string;
  receiveKind: string;
  placedAt: string;
  kitchenStartedAt: string | null;
  finishedAt: string | null;
  promisedAt: string | null;
  customerNote: string | null;
  lines: KitchenLine[];
};

type KitchenBoard = {
  branch: string;
  station: string | null;
  timezone: string;
  slaMinutes: number;
  orders: KitchenOrder[];
};

const BRANCH_KEY = 'ordering.kitchen.branch';
const SOUND_KEY = 'ordering.kitchen.sound';
const DONE_MINUTES = 15;

const KIND_KEY: Record<string, string> = {
  pickup: 'kind.pickup',
  delivery: 'kind.delivery',
  'dine-in': 'kind.dineIn',
  dineIn: 'kind.dineIn',
};

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
    // Autoplay policies may block sound until the first click.
  }
};

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

const aging = (minutes: number, sla: number): 'normal' | 'warning' | 'late' =>
  minutes >= sla * 2 ? 'late' : minutes >= sla ? 'warning' : 'normal';

/**
 * N2 kitchen display (`/plugins/ordering/kitchen?branch=&station=`): dark, ≥18px, three
 * columns Mới / Đang làm / Xong. Refreshes on the kitchen.read SSE stream (polling as a
 * fallback), chimes on new orders, toggles `preparedAt` per line, "Xong cả đơn" → `ready`
 * (a 409 means another screen beat it — the card shakes and a hint shows).
 */
const KitchenPage = () => {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const { get, post } = useFetchClient();
  const token = useAuth('KitchenPage', (state) => state.token);
  const rbac = useRBAC(RBAC_KITCHEN);
  const allowed = !rbac.isLoading && Object.values(rbac.allowedActions).some(Boolean);

  const rememberedBranch = () => {
    try {
      return window.localStorage.getItem(BRANCH_KEY) ?? '';
    } catch {
      return '';
    }
  };
  const branch = params.get('branch') ?? rememberedBranch();
  const station = params.get('station') ?? '';

  const [board, setBoard] = useState<KitchenBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [branchDraft, setBranchDraft] = useState(rememberedBranch());
  const [sound, setSound] = useState(() => {
    try {
      return window.localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [stale, setStale] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0); // re-render the aging clocks every 30 s
  const boardRef = useRef<KitchenBoard | null>(null);
  boardRef.current = board;

  const load = useCallback(async () => {
    if (!branch) return;
    try {
      const qs = new URLSearchParams({ branch });
      if (station) qs.set('station', station);
      const { data } = await get(`/ordering/kitchen?${qs}`);
      setBoard(data as KitchenBoard);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [branch, get, station]);

  useEffect(() => {
    setBoard(null);
    void load();
  }, [load]);

  // Aging clocks re-tint without refetching.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // SSE: the kitchen stream emits the same order events as the inbox, scoped to this
  // staff member's branches. Any order event refetches the board; `order.created` chimes.
  useEffect(() => {
    if (!allowed || !token || !branch) return undefined;
    const abort = new AbortController();
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const open = async () => {
      try {
        const response = await fetch(
          `${(window.strapi as typeof window.strapi & { backendURL: string }).backendURL}/ordering/kitchen/stream`,
          { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal },
        );
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        attempts = 0;
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
              const event = JSON.parse(frame.data) as { type: string };
              void load();
              if (event.type === 'order.created' && sound) chime();
            } catch {
              // ignore malformed frames
            }
          }
        }
        throw new Error('stream closed');
      } catch {
        if (disposed) return;
        poll ??= setInterval(() => void load(), 30_000);
        retry = setTimeout(() => void open(), Math.min(30_000, 1000 * 2 ** attempts));
        attempts += 1;
      }
    };
    void open();
    return () => {
      disposed = true;
      abort.abort();
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
    };
  }, [allowed, token, branch, load, sound]);

  const toggleLine = async (line: KitchenLine) => {
    await post(`/ordering/kitchen/lines/${line.id}/prepared`, { prepared: !line.preparedAt });
    await load();
  };

  const start = async (orderId: number) => {
    await post(`/ordering/kitchen/orders/${orderId}/start`, {});
    await load();
  };

  const complete = async (orderId: number) => {
    try {
      await post(`/ordering/kitchen/orders/${orderId}/complete`, {});
      await load();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setStale((current) => new Set(current).add(orderId));
        setTimeout(() => setStale((current) => {
          const next = new Set(current);
          next.delete(orderId);
          return next;
        }), 4000);
      }
      await load();
    }
  };

  const setBranch = (code: string) => {
    try {
      window.localStorage.setItem(BRANCH_KEY, code);
    } catch {
      // private mode
    }
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('branch', code);
      return next;
    });
  };

  const setStation = (value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('station', value);
      else next.delete('station');
      return next;
    });
  };

  const columns = useMemo(() => {
    const orders = board?.orders ?? [];
    return {
      fresh: orders.filter((order) => order.status !== 'ready' && !order.kitchenStartedAt),
      doing: orders.filter((order) => order.status !== 'ready' && order.kitchenStartedAt),
      done: orders.filter(
        (order) =>
          order.status === 'ready' &&
          order.finishedAt &&
          minutesSince(order.finishedAt) <= DONE_MINUTES,
      ),
    };
  }, [board]);

  const stations = useMemo(
    () => [...new Set((board?.orders ?? []).flatMap((order) => order.lines.map((line) => line.station)).filter(Boolean))].sort(),
    [board],
  );

  if (!allowed && !rbac.isLoading) {
    return (
      <Flex padding={10} justifyContent="center">
        <Typography variant="beta">{t('common.forbidden.body')}</Typography>
      </Flex>
    );
  }
  if (!branch) {
    return (
      <Flex padding={10} direction="column" gap={4} alignItems="stretch" maxWidth="320px">
        <Typography variant="beta">{t('kitchen.title')}</Typography>
        <Field.Root>
          <Field.Label>{t('kitchen.branch')}</Field.Label>
          <Flex gap={2}>
            <TextInput value={branchDraft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBranchDraft(e.target.value)} />
            <Button disabled={!branchDraft.trim()} onClick={() => setBranch(branchDraft.trim())}>
              {t('common.save')}
            </Button>
          </Flex>
        </Field.Root>
      </Flex>
    );
  }

  const orderCard = (order: KitchenOrder, column: 'fresh' | 'doing' | 'done') => {
    const waited = minutesSince(order.placedAt);
    const tone = aging(waited, board?.slaMinutes ?? 10);
    const doneFade =
      column === 'done' && order.finishedAt ? 1 - minutesSince(order.finishedAt) / DONE_MINUTES : 1;
    return (
      <div
        key={order.orderId}
        className={`kds-card${stale.has(order.orderId) ? ' shake' : ''}`}
        style={{ opacity: column === 'done' ? 0.45 + 0.5 * Math.max(0, doneFade) : 1 }}
      >
        <div className="kds-card-head">
          <span className="kds-code">{order.code}</span>
          <Badge>{t(KIND_KEY[order.receiveKind] ?? 'kind.pickup')}</Badge>
        </div>
        <div className={`kds-clock ${tone}`}>
          {waited}′
          {order.promisedAt ? ` · ${formatTime(order.promisedAt, board?.timezone)}` : ''}
          {order.kitchenStartedAt ? ` · ${t('kitchen.started', { time: formatTime(order.kitchenStartedAt, board?.timezone) })}` : ''}
        </div>
        <div className="kds-lines">
          {order.lines.map((line) => (
            <button
              key={line.id}
              type="button"
              className={`kds-line${line.preparedAt ? ' prepared' : ''}`}
              onClick={() => void toggleLine(line)}
            >
              <b>{line.quantity}</b> {line.title}
              {line.options.map((option, index) => (
                <span className="kds-opt" key={index}>
                  + {option.optionName ?? option.groupName}
                  {(option.quantity ?? 1) > 1 ? ` x${option.quantity}` : ''}
                </span>
              ))}
              {line.note ? <span className="kds-linenote">{line.note}</span> : null}
            </button>
          ))}
        </div>
        {order.customerNote ? <div className="kds-note">{order.customerNote}</div> : null}
        {stale.has(order.orderId) ? <div className="kds-stale">{t('kitchen.stale')}</div> : null}
        <div className="kds-actions">
          {column === 'fresh' ? (
            <Button onClick={() => void start(order.orderId)}>{t('kitchen.start')}</Button>
          ) : null}
          {column !== 'done' ? (
            <Button variant="secondary" onClick={() => void complete(order.orderId)}>
              {t('kitchen.order.done')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        .kds { background: #111827; min-height: 100vh; margin: -3.2rem; padding: 1.2rem; color: #f9fafb; font-size: 18px; }
        .kds-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
        .kds-bar .kds-station { padding: 6px 14px; border-radius: 999px; border: 1px solid #4b5563; background: transparent; color: #f9fafb; font-size: 18px; cursor: pointer; }
        .kds-bar .kds-station.active { background: #f9fafb; color: #111827; }
        .kds-bar label { color: #f9fafb; font-size: 18px; display: flex; align-items: center; gap: 6px; }
        .kds-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; align-items: start; }
        .kds-col h2 { font-size: 20px; margin: 0 0 10px; color: #d1d5db; }
        .kds-card { background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
        .kds-card-head { display: flex; justify-content: space-between; align-items: center; }
        .kds-code { font-size: 26px; font-weight: 700; }
        .kds-clock { font-size: 20px; font-weight: 700; margin: 6px 0; }
        .kds-clock.normal { color: #34d399; }
        .kds-clock.warning { color: #fbbf24; }
        .kds-clock.late { color: #f87171; }
        .kds-lines { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
        .kds-line { text-align: left; background: transparent; border: 0; color: #f9fafb; font-size: 20px; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
        .kds-line:hover { background: #374151; }
        .kds-line.prepared { opacity: 0.45; text-decoration: line-through; }
        .kds-line b { margin-right: 8px; }
        .kds-opt { display: block; padding-left: 28px; font-size: 17px; color: #d1d5db; }
        .kds-linenote { display: block; padding-left: 28px; font-size: 16px; font-style: italic; color: #fbbf24; }
        .kds-note { background: #92400e; color: #fef3c7; border-radius: 6px; padding: 6px 10px; font-size: 17px; margin: 8px 0; }
        .kds-stale { color: #f87171; font-size: 16px; margin: 6px 0; }
        .kds-actions { display: flex; gap: 8px; margin-top: 8px; }
        .kds.shake, .kds-card.shake { animation: kds-shake 0.4s; }
        @keyframes kds-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
        .kds-empty { color: #4b5563; font-size: 18px; }
      `}</style>
      <div className="kds">
        <div className="kds-bar">
          <button type="button" className={`kds-station${station === '' ? ' active' : ''}`} onClick={() => setStation('')}>
            {t('kitchen.station.all')}
          </button>
          {stations.map((item) => (
            <button
              key={item}
              type="button"
              className={`kds-station${station === item ? ' active' : ''}`}
              onClick={() => setStation(item)}
            >
              {item}
            </button>
          ))}
          <label>
            <Checkbox
              checked={sound}
              onCheckedChange={(checked: boolean) => {
                const on = checked === true;
                setSound(on);
                try {
                  window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
                } catch {
                  // private mode
                }
              }}
            />
            {t('kitchen.sound')}
          </label>
          <button
            type="button"
            className="kds-station"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          >
            {t('kitchen.fullscreen')}
          </button>
        </div>
        {failed ? (
          <Typography variant="beta" textColor="danger400">
            {t('kitchen.loadFailed')}
          </Typography>
        ) : !board ? (
          <Loader />
        ) : (
          <div className="kds-grid">
            {(['fresh', 'doing', 'done'] as const).map((column) => (
              <div className="kds-col" key={column}>
                <h2>{t(`kitchen.column.${column}`)}</h2>
                {columns[column].length === 0 ? <div className="kds-empty">{t('kitchen.empty')}</div> : null}
                {columns[column].map((order) => orderCard(order, column))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default KitchenPage;
