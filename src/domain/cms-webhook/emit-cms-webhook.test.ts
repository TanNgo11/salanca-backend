import type { Core } from '@strapi/strapi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import { CmsWebhookContentUid, CmsWebhookEvent } from './cms-webhook.types';
import { emitCmsWebhook } from './emit-cms-webhook';

const UID = CmsWebhookContentUid.HomePage;

const createStrapi = () =>
  ({ log: { warn: vi.fn(), info: vi.fn() } }) as unknown as Core.Strapi & {
    log: { warn: ReturnType<typeof vi.fn> };
  };

const createContext = (
  overrides: Partial<DocumentMiddlewareContext> = {},
): DocumentMiddlewareContext => ({
  uid: UID,
  action: 'publish',
  params: { documentId: 'doc-1' },
  ...overrides,
});

/** Wait for the fire-and-forget deliveries kicked off with `void`. */
const flushDeliveries = () => new Promise((resolve) => setImmediate(resolve));

describe('emitCmsWebhook', () => {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
    process.env.CMS_WEBHOOK_URL = 'https://www.example.com/api/cms/revalidate';
    process.env.CMS_WEBHOOK_SECRET = 'test-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CMS_WEBHOOK_URL;
    delete process.env.CMS_WEBHOOK_SECRET;
  });

  const localesDelivered = () =>
    fetchSpy.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).locale,
    );

  it('fans out to every allowed locale when publishing all locales', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext({ params: { documentId: 'doc-1', locale: '*' } }), {
      documentId: 'doc-1',
    });
    await flushDeliveries();

    expect(localesDelivered().sort()).toEqual(['en', 'vi']);
  });

  it('fans out when no locale is given instead of assuming vi', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext(), { documentId: 'doc-1' });
    await flushDeliveries();

    expect(localesDelivered().sort()).toEqual(['en', 'vi']);
  });

  it('emits a single payload for one explicit locale', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext({ params: { documentId: 'doc-1', locale: 'en' } }), {
      documentId: 'doc-1',
    });
    await flushDeliveries();

    expect(localesDelivered()).toEqual(['en']);
  });

  it('emits one payload per entry of a locale array', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(
      strapi,
      createContext({ params: { documentId: 'doc-1', locale: ['en', 'vi', 'en'] } }),
      { documentId: 'doc-1' },
    );
    await flushDeliveries();

    expect(localesDelivered()).toEqual(['en', 'vi']);
  });

  it('warns and skips a locale outside the allowlist', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext({ params: { documentId: 'doc-1', locale: 'de' } }), {
      documentId: 'doc-1',
    });
    await flushDeliveries();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining('"de"'));
  });

  it('ignores actions and UIDs outside the allowlist', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext({ action: 'update' }), { documentId: 'doc-1' });
    await emitCmsWebhook(strapi, createContext({ uid: 'api::contact-message.contact-message' }), {
      documentId: 'doc-1',
    });
    await flushDeliveries();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the params documentId when the result carries none', async () => {
    const strapi = createStrapi();

    await emitCmsWebhook(
      strapi,
      createContext({ params: { documentId: 'from-params', locale: 'vi' } }),
      null,
    );
    await flushDeliveries();

    const payload = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(payload).toMatchObject({
      documentId: 'from-params',
      event: CmsWebhookEvent.Publish,
      uid: UID,
    });
  });

  it('skips delivery when the webhook is not configured', async () => {
    delete process.env.CMS_WEBHOOK_URL;
    const strapi = createStrapi();

    await emitCmsWebhook(strapi, createContext({ params: { documentId: 'doc-1', locale: 'vi' } }), {
      documentId: 'doc-1',
    });
    await flushDeliveries();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
