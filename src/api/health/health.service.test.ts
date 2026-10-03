import { describe, expect, it, vi } from 'vitest';
import type { Core } from '@strapi/strapi';

import { checkHealth } from './health.service';

const createStrapi = (raw: () => Promise<unknown>) =>
  ({
    db: { connection: { raw: vi.fn(raw) } },
    log: { warn: vi.fn() },
  }) as unknown as Core.Strapi;

describe('checkHealth', () => {
  it('reports ok when the database answers', async () => {
    const strapi = createStrapi(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));

    await expect(checkHealth(strapi)).resolves.toEqual({
      statusCode: 200,
      body: { status: 'ok', db: 'up' },
    });
  });

  it('reports 503 without leaking the error when the database fails', async () => {
    const strapi = createStrapi(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')));

    const report = await checkHealth(strapi);

    expect(report).toEqual({ statusCode: 503, body: { status: 'error', db: 'down' } });
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
  });

  it('reports 503 when the database does not answer in time', async () => {
    const strapi = createStrapi(() => new Promise(() => undefined));

    await expect(checkHealth(strapi, 20)).resolves.toEqual({
      statusCode: 503,
      body: { status: 'error', db: 'down' },
    });
  });
});
