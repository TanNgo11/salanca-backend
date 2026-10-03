import type { Core } from '@strapi/strapi';

export const HEALTH_DB_TIMEOUT_MS = 2000;

export type HealthReport = {
  statusCode: 200 | 503;
  body: { status: 'ok' | 'error'; db: 'up' | 'down' };
};

const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Health database check timed out.')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export const checkHealth = async (
  strapi: Core.Strapi,
  timeoutMs: number = HEALTH_DB_TIMEOUT_MS,
): Promise<HealthReport> => {
  try {
    await withTimeout(Promise.resolve(strapi.db.connection.raw('select 1')), timeoutMs);
    return { statusCode: 200, body: { status: 'ok', db: 'up' } };
  } catch (error) {
    strapi.log.warn(
      `Health check database probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return { statusCode: 503, body: { status: 'error', db: 'down' } };
  }
};
