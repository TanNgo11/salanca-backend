import { existsSync, readFileSync } from 'node:fs';

import type { NormalizedPaymentEvent } from '../../contracts/payment';

/** Env var the test fixture reads. Integration tests share one file across processes. */
export const SEPAY_TEST_TRANSACTIONS_FILE = 'SEPAY_TEST_TRANSACTIONS_FILE';

const MAX_PER_PAGE = 100;
const DEFAULT_INTERVAL_MS = 334;

export type SepayListedRow = {
  id: string;
  accountNumber: string | null;
  event: NormalizedPaymentEvent | null;
};

export type SepayTransactionPage = {
  rows: SepayListedRow[];
  lastId: string | null;
  /** How many API rows this page contained, before unusable rows were dropped. */
  fetched: number;
};

export type SepayTransactionClient = {
  listPage(input: { sinceId?: string; perPage?: number }): Promise<SepayTransactionPage>;
};

type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'error' }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const textId = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '' && value.trim().length <= 80) return value.trim();
  return null;
};

const asAmount = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
};

const cap = (perPage: number | undefined): number =>
  Math.min(MAX_PER_PAGE, Math.max(1, perPage ?? MAX_PER_PAGE));

/**
 * One user-API row. `id` is a UUID (the webhook's integer id is a different key for the same
 * transfer). Rows without an id are dropped. Rows with an id but no usable amount stay in the
 * page so the cursor can move past them; `event` is null and the job does not ingest them.
 */
export const mapSepayApiRow = (row: unknown): SepayListedRow | null => {
  const body = asRecord(row);
  if (!body) return null;
  const id = textId(body.id);
  if (!id) return null;
  const accountNumber = text(body.account_number) ?? null;
  const transferType = body.transfer_type === 'in' || body.transfer_type === 'out' ? body.transfer_type : null;
  const amountIn = asAmount(body.amount_in);
  const amountOut = asAmount(body.amount_out);
  const amount = transferType === 'out' ? amountOut : amountIn;
  if (!transferType || amount === null || amount < 0) return { id, accountNumber, event: null };
  const reference = text(body.reference_number);
  return {
    id,
    accountNumber,
    event: {
      providerCode: 'sepay',
      providerTransactionId: id,
      kind: 'transfer',
      amount: { amount, currency: 'VND' },
      transferType,
      ...(reference ? { reference } : {}),
      metadata: {
        accountNumber,
        subAccount: text(body.va) ?? null,
        content: typeof body.transaction_content === 'string' ? body.transaction_content : undefined,
        code: text(body.code) ?? null,
        gateway: text(body.bank_brand_name),
        transactionDate: text(body.transaction_date),
      },
    },
  };
};

const pageOf = (rawRows: unknown[], perPage: number): SepayTransactionPage => {
  const limited = rawRows.slice(0, perPage);
  const rows = limited.map(mapSepayApiRow).filter((row): row is SepayListedRow => row !== null);
  return { rows, lastId: rows.at(-1)?.id ?? null, fetched: limited.length };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Live client. The token is sent as a bearer header and is never put on the URL or in an error.
 * Redirects are refused so the header cannot follow to another host.
 */
export const createSepayTransactionClient = (deps: {
  apiBaseUrl: () => string;
  apiToken: () => string;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRetries?: number;
}): SepayTransactionClient => {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const pause = deps.sleep ?? sleep;
  const interval = deps.minIntervalMs ?? DEFAULT_INTERVAL_MS;
  const maxRetries = deps.maxRetries ?? 3;
  let nextAt = 0;

  const waitTurn = async () => {
    const now = deps.now?.() ?? Date.now();
    const wait = Math.max(0, nextAt - now);
    nextAt = now + wait + interval;
    if (wait > 0) await pause(wait);
  };

  return {
    async listPage(input) {
      const token = deps.apiToken();
      if (!token) throw new Error('sepay api token is not configured');
      const perPage = cap(input.perPage);
      const base = deps.apiBaseUrl().replace(/\/$/, '');
      const params = new URLSearchParams();
      params.set('per_page', String(perPage));
      if (input.sinceId) params.set('since_id', input.sinceId);
      const url = `${base}/v2/transactions?${params.toString()}`;

      let attempt = 0;
      while (attempt <= maxRetries) {
        await waitTurn();
        const response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          redirect: 'error',
        });
        if (response.status === 429 && attempt < maxRetries) {
          attempt += 1;
          const retryAfter = Number(response.headers.get('retry-after'));
          const backoff =
            Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
          await pause(backoff);
          continue;
        }
        if (response.status !== 200) {
          throw new Error(`sepay transactions request failed (${response.status})`);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new Error('sepay transactions request failed (bad-response)');
        }
        const body = asRecord(payload);
        const data = body && Array.isArray(body.data) ? body.data : null;
        if (!body || body.status !== 'success' || !data) {
          throw new Error('sepay transactions request failed (bad-response)');
        }
        return pageOf(data, perPage);
      }
      throw new Error('sepay transactions request failed (429)');
    },
  };
};

/** Reads a JSON array of user-API rows from disk. No network. An unknown cursor returns the whole file. */
export const createFixtureSepayClient = (): SepayTransactionClient => ({
  async listPage(input) {
    const file = process.env[SEPAY_TEST_TRANSACTIONS_FILE];
    if (!file || !existsSync(file)) return { rows: [], lastId: null, fetched: 0 };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new Error('sepay test transactions file is unreadable');
    }
    const all = Array.isArray(parsed) ? parsed : [];
    const mapped = all.map(mapSepayApiRow).filter((row): row is SepayListedRow => row !== null);
    const sinceId = input.sinceId;
    const start = sinceId ? mapped.findIndex((row) => row.id === sinceId) : -1;
    const rest = start >= 0 ? mapped.slice(start + 1) : mapped;
    const perPage = cap(input.perPage);
    const rows = rest.slice(0, perPage);
    return { rows, lastId: rows.at(-1)?.id ?? null, fetched: rows.length };
  },
});
