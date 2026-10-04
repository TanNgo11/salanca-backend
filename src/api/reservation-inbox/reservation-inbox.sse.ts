export const SSE_EVENT_RESERVATION_CREATED = 'reservation.created';
export const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export const formatSseEvent = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

export const formatSseComment = (comment: string): string => `: ${comment}\n\n`;

/**
 * Writes `: ping` frames on an interval; returns the stop function to run on
 * connection close so the timer never outlives the socket.
 */
export const startSseHeartbeat = (
  write: (chunk: string) => unknown,
  intervalMs: number = SSE_HEARTBEAT_INTERVAL_MS,
): (() => void) => {
  const timer = setInterval(() => {
    write(formatSseComment('ping'));
  }, intervalMs);
  return () => clearInterval(timer);
};
