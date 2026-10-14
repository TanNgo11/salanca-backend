import { OrderingError } from '../domain/errors';

/**
 * Shared outbound HTTP for the O13 provider adapters (docs/providers/*.md). Every call gets a
 * bounded timeout and a response-size cap, follows no redirects (a provider base URL is config,
 * never user input — a redirect is a misconfiguration), and fails as `PROVIDER_UNAVAILABLE`
 * with the upstream status code only. Request and response bodies are NEVER logged or copied
 * into errors — they may carry API keys or customer phone numbers.
 */

export type ProviderHttpOptions = {
  baseUrl: string;
  /** Whole-request timeout; default 10s (providers document no slower SLA). */
  timeoutMs?: number;
  /** Response body read cap in bytes; default 64 KB (provider payloads are tiny). */
  maxBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 64 * 1024;

export type ProviderResponse = {
  status: number;
  /** Parsed JSON body — an object/array, or null when the body was empty or not JSON. */
  body: unknown;
};

const isJsonLike = (value: unknown): value is Record<string, unknown> | unknown[] =>
  value !== null && typeof value === 'object';

const fail = (reason: string, status?: number): never => {
  throw new OrderingError('PROVIDER_UNAVAILABLE', 'provider request failed', {
    details: { reason, ...(status === undefined ? {} : { status }) },
  });
};

/**
 * Reads the body chunk by chunk and gives up (cancelling the stream) as soon as it passes
 * `maxBytes` — a huge or endless response is never buffered. Non-JSON parses to null.
 */
const readBody = async (
  res: Response,
  maxBytes: number,
): Promise<ProviderResponse> => {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    fail('response-too-large', res.status);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        fail('response-too-large', res.status);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // providers answering non-JSON (HTML error pages) land here
    }
  }
  return { status: res.status, body };
};

const request = async (
  options: ProviderHttpOptions,
  input: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<ProviderResponse> => {
  const url = `${options.baseUrl.replace(/\/+$/, '')}${input.path.startsWith('/') ? '' : '/'}${input.path}`;
  const res = await fetch(url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  }).catch(() => fail('network-or-timeout'));
  try {
    return await readBody(res, options.maxBytes ?? DEFAULT_MAX_BYTES);
  } catch (error) {
    if (error instanceof OrderingError) throw error;
    return fail('body-read-failed', res.status);
  }
};

export type ProviderHttpClient = {
  postJson(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<ProviderResponse>;
  /** eSMS/Ahamove-style endpoints that read a form-encoded body. */
  postForm(
    path: string,
    fields: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<ProviderResponse>;
  deleteJson(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<ProviderResponse>;
};

export const createProviderHttp = (options: ProviderHttpOptions): ProviderHttpClient => ({
  postJson: (path, body, headers) =>
    request(options, {
      method: 'POST',
      path,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  postForm: (path, fields, headers) =>
    request(options, {
      method: 'POST',
      path,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields).toString(),
    }),
  deleteJson: (path, body, headers) =>
    request(options, {
      method: 'DELETE',
      path,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
});

/** True when the provider answered `2xx` with a JSON body that looks like an object. */
export const jsonObject = (response: ProviderResponse): Record<string, unknown> | null =>
  isJsonLike(response.body) && !Array.isArray(response.body)
    ? (response.body as Record<string, unknown>)
    : null;
