import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCmsWebhookPayload } from './cms-webhook.helper';
import { CmsWebhookEvent } from './cms-webhook.types';
import { CMS_WEBHOOK_RETRY_DELAYS_MS, deliverCmsWebhook } from './emit-cms-webhook';

const payload = buildCmsWebhookPayload(
  'api::home-page.home-page',
  'vi',
  'doc123',
  CmsWebhookEvent.Publish,
);

const buildStrapi = () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { log, strapi: { log } as never };
};

const response = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

const noSleep = vi.fn(async () => undefined);

describe('deliverCmsWebhook', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    noSleep.mockClear();
  });

  const configure = () => {
    vi.stubEnv('CMS_WEBHOOK_URL', 'https://web.example/api/cms/revalidate');
    vi.stubEnv('CMS_WEBHOOK_SECRET', 'secret');
  };

  it('does nothing when the webhook is not configured', async () => {
    vi.stubEnv('CMS_WEBHOOK_URL', '');
    const fetchImpl = vi.fn();
    const { strapi } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends once when the web answers 2xx', async () => {
    configure();
    const fetchImpl = vi.fn(async () => response(200));
    const { strapi, log } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('retries a 5xx and a network error, then succeeds', async () => {
    configure();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(502))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(response(200));
    const { strapi, log } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(noSleep).toHaveBeenNthCalledWith(1, CMS_WEBHOOK_RETRY_DELAYS_MS[0]);
    expect(noSleep).toHaveBeenNthCalledWith(2, CMS_WEBHOOK_RETRY_DELAYS_MS[1]);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('retries a 429', async () => {
    configure();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const { strapi } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx such as a bad signature', async () => {
    configure();
    const fetchImpl = vi.fn(async () => response(400));
    const { strapi, log } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      'CMS webhook rejected with status 400 for api::home-page.home-page/vi; not retrying.',
    );
  });

  it('gives up after every attempt fails and logs an error', async () => {
    configure();
    const fetchImpl = vi.fn(async () => response(503));
    const { strapi, log } = buildStrapi();

    await deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(CMS_WEBHOOK_RETRY_DELAYS_MS.length + 1);
    expect(log.error).toHaveBeenCalledWith(
      `CMS webhook gave up after ${CMS_WEBHOOK_RETRY_DELAYS_MS.length + 1} attempts for api::home-page.home-page/vi: status 503.`,
    );
  });

  it('never throws, even when logging the failure', async () => {
    configure();
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const { strapi } = buildStrapi();

    await expect(
      deliverCmsWebhook(strapi, payload, { fetchImpl, sleep: noSleep }),
    ).resolves.toBeUndefined();
  });
});
