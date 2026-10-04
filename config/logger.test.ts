import { afterEach, describe, expect, it, vi } from 'vitest';

// The shared logger reads LOG_LEVEL when it is created; pin it so the test does not depend on
// the environment it runs in.
vi.hoisted(() => {
  process.env.LOG_LEVEL = 'trace';
});

import loggerConfig from './logger';

interface LogLine {
  level?: string;
  message?: string;
  event?: string;
  err_type?: string;
  err_message?: string;
  job_name?: string;
  access_token?: string;
}

const captureStdout = (): LogLine[] => {
  const lines: LogLine[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    lines.push(JSON.parse(String(chunk)) as LogLine);
    return true;
  });
  return lines;
};

const writeInfo = (info: Record<string, string> | Error): void => {
  const transport = loggerConfig.transports[0];
  if (!transport) {
    throw new Error('config/logger must declare one transport.');
  }
  transport.write(info);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('strapi logger configuration', () => {
  it('lets every level through so LOG_LEVEL decides', () => {
    expect(loggerConfig.level).toBe('silly');
    expect(loggerConfig.transports).toHaveLength(1);
  });

  it('writes strapi.log calls as contract JSON with snake_case fields and redaction', () => {
    const lines = captureStdout();
    writeInfo({ level: 'warn', message: 'cms webhook skipped', jobName: 'publish', accessToken: 'secret-token' });
    expect(lines[0]).toMatchObject({
      level: 'warn',
      message: 'cms webhook skipped',
      event: 'strapi.log',
      job_name: 'publish',
      access_token: '[REDACTED]',
    });
  });

  it('masks Vietnamese phone numbers in any string', () => {
    const lines = captureStdout();
    writeInfo({ level: 'info', message: 'reservation from 0912345678 notified' });
    expect(lines[0]?.message).toBe('reservation from [REDACTED] notified');
  });

  it('serializes errors passed to strapi.log.error', () => {
    const lines = captureStdout();
    writeInfo(Object.assign(new Error('smtp timeout'), { level: 'error' }));
    expect(lines[0]).toMatchObject({ level: 'error', err_type: 'Error', err_message: 'smtp timeout' });
  });
});
