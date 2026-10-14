import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrderingError } from '../domain/errors';
import { createProviderHttp, jsonObject } from './_http';

let server: Server;
let baseUrl = '';
const requests: Array<{ method: string; url: string; body: string; auth?: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body,
        auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      });
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"resultCode":0,"payUrl":"https://pay.example/x"}');
        return;
      }
      if (req.url === '/empty') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === '/html') {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<html>error</html>');
        return;
      }
      if (req.url === '/endless') {
        // Never ends: a reader that buffers the whole body would hang until the timeout.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const timer = setInterval(() => res.write('x'.repeat(16 * 1024)), 5);
        res.on('close', () => clearInterval(timer));
        return;
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(`{"pad":"${'x'.repeat(200_000)}"}`);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('providers/_http', () => {
  const client = () => createProviderHttp({ baseUrl });

  it('posts JSON and parses the response body', async () => {
    const res = await client().postJson('/ok', { a: 1 }, { Authorization: 'Bearer t' });
    expect(res.status).toBe(200);
    expect(jsonObject(res)?.payUrl).toBe('https://pay.example/x');
    const sent = requests.at(-1);
    expect(sent?.method).toBe('POST');
    expect(sent?.body).toBe('{"a":1}');
    expect(sent?.auth).toBe('Bearer t');
  });

  it('returns null body for an empty response', async () => {
    const res = await client().postJson('/empty', {});
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('never throws on non-JSON bodies — the caller inspects status + null body', async () => {
    const res = await client().postJson('/html', {});
    expect(res.status).toBe(502);
    expect(res.body).toBeNull();
  });

  it('caps the response body', async () => {
    await expect(
      createProviderHttp({ baseUrl, maxBytes: 1024 }).postJson('/big', {}),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { reason: 'response-too-large' } });
  });

  it('stops reading an endless body as soon as it passes the cap', async () => {
    const started = Date.now();
    await expect(
      createProviderHttp({ baseUrl, maxBytes: 1024, timeoutMs: 5_000 }).postJson('/endless', {}),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { reason: 'response-too-large' } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('times out a hung endpoint', async () => {
    await expect(
      createProviderHttp({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 }).postJson('/ok', {}),
    ).rejects.toBeInstanceOf(OrderingError);
  });

  it('encodes form bodies', async () => {
    await client().postForm('/ok', { a: 'b c', d: '1' });
    expect(requests.at(-1)?.body).toBe('a=b+c&d=1');
  });
});
