import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatSseComment,
  formatSseEvent,
  SSE_EVENT_RESERVATION_CREATED,
  SSE_HEARTBEAT_INTERVAL_MS,
  startSseHeartbeat,
} from './reservation-inbox.sse';

describe('formatSseEvent', () => {
  it('serializes name and JSON data into an SSE frame', () => {
    const frame = formatSseEvent(SSE_EVENT_RESERVATION_CREATED, {
      documentId: 'abc123',
      guestCount: 4,
    });
    expect(frame).toBe(
      'event: reservation.created\ndata: {"documentId":"abc123","guestCount":4}\n\n',
    );
  });
});

describe('formatSseComment', () => {
  it('writes a comment frame terminated by a blank line', () => {
    expect(formatSseComment('connected')).toBe(': connected\n\n');
    expect(formatSseComment('ping')).toBe(': ping\n\n');
  });
});

describe('startSseHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a ping comment every interval and stops cleanly', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const stop = startSseHeartbeat(write);

    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(': ping\n\n');

    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 3);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
