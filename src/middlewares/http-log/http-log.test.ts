import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.LOG_LEVEL = 'trace';
});

import httpLog from './index';

interface ProbeContext {
  method: string;
  url: string;
  status: number;
  state: Record<string, string>;
  headers: Record<string, string>;
  get: (name: string) => string;
  set: (name: string, value: string) => void;
}

interface RequestLine {
  event?: string;
  request_id?: string;
  upstream_request_id?: string;
  http_status?: number;
}

const createContext = (url: string, inbound: Record<string, string> = {}): ProbeContext => {
  const headers: Record<string, string> = {};
  return {
    method: 'GET',
    url,
    status: 200,
    state: {},
    headers,
    get: (name) => inbound[name.toLowerCase()] ?? '',
    set: (name, value) => {
      headers[name.toLowerCase()] = value;
    },
  };
};

const captureStdout = (): RequestLine[] => {
  const lines: RequestLine[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    lines.push(JSON.parse(String(chunk)) as RequestLine);
    return true;
  });
  return lines;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('http-log middleware', () => {
  it('issues a server request id and records the caller id as upstream_request_id', async () => {
    const lines = captureStdout();
    const ctx = createContext('/api/v1/home-page', { 'x-request-id': 'web-request-7' });
    // Narrow adapter cast: the fixture exposes only the Koa members the middleware reads.
    await httpLog()(ctx as never, async () => undefined);
    const requestId = ctx.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.state.requestId).toBe(requestId);
    expect(lines[0]).toMatchObject({
      event: 'http.request',
      request_id: requestId,
      upstream_request_id: 'web-request-7',
      http_status: 200,
    });
  });

  it('does not log the Docker healthcheck path', async () => {
    const lines = captureStdout();
    await httpLog()(createContext('/_health') as never, async () => undefined);
    expect(lines).toHaveLength(0);
  });
});
