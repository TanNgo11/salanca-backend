import type { NotificationProvider } from '../../contracts';
import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient } from '../_http';
import { createProviderHttp, jsonObject } from '../_http';
import { parseZaloSettings, type ZaloSettings } from './config';

/**
 * Zalo ZNS template messages (docs/providers/zalo-zns.md, O13 step 6). Credentials are either a
 * static `accessToken` or the OAuth triple — the adapter refreshes once on Zalo error `-124`
 * (expired token) and caches the token for its declared lifetime. Only the numeric Zalo error
 * code reaches errors/logs: response `message` fields can carry customer data.
 *
 * `data` from the notification service carries `trackingId` (`nd-<deliveryId>`), `znsTemplateId`
 * and `znsParams` (param name → value, already mapped from plugin variables by the channel rule).
 */
type ZaloToken = { value: string; expiresAt: number };

/** `+84xxxxxxxxx` → `84xxxxxxxxx` (ZNS wants the digits, no plus). */
const zaloPhone = (e164: string): string => e164.replace(/^\+/, '');

const zaloError = (code: unknown): OrderingError =>
  new OrderingError('PROVIDER_UNAVAILABLE', 'zalo zns rejected the template send', {
    details: { reason: `zalo-error:${String(code ?? 'no-json-response')}` },
  });

export const createZaloNotificationProvider = (deps: {
  settings: () => ZaloSettings | null;
  /** Injectable for tests; default builds a bounded client per send from the env base URL. */
  client?: ProviderHttpClient;
  /** Injectable for tests; the OAuth host differs from the API host — one bounded client each. */
  oauthClient?: ProviderHttpClient;
}): NotificationProvider => {
  let token: ZaloToken | null = null;

  const requireSettings = (): ZaloSettings => {
    const settings = deps.settings();
    if (!settings) throw new OrderingError('CONFIG_INVALID', 'zalo zns is not configured');
    return settings;
  };
  const client = (settings: ZaloSettings): ProviderHttpClient =>
    deps.client ?? createProviderHttp({ baseUrl: settings.baseUrl });
  // `oauthUrl` is a full endpoint URL — a `''` path posts straight to it.
  const oauth = (settings: ZaloSettings): ProviderHttpClient =>
    deps.oauthClient ?? createProviderHttp({ baseUrl: settings.oauthUrl.replace(/\/+$/, '') });

  /** Static token wins; otherwise refresh (cached until `expires_in` − 60s skew). */
  const accessToken = async (settings: ZaloSettings, forceRefresh = false): Promise<string> => {
    if (settings.accessToken) return settings.accessToken;
    if (!forceRefresh && token && token.expiresAt > Date.now()) return token.value;
    const response = await oauth(settings).postForm(
      '',
      {
        app_id: String(settings.appId),
        grant_type: 'refresh_token',
        refresh_token: String(settings.refreshToken),
      },
      { secret_key: String(settings.appSecret) },
    );
    const body = jsonObject(response);
    const value = typeof body?.access_token === 'string' ? body.access_token : null;
    if (!value) throw zaloError(body?.error ?? response.status);
    const expiresIn = Number(body?.expires_in);
    token = {
      value,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000) - 60_000,
    };
    return value;
  };

  return {
    async send({ recipient, data }) {
      const settings = requireSettings();
      const phone = zaloPhone(String(recipient.phone ?? ''));
      const templateId = typeof data.znsTemplateId === 'string' ? data.znsTemplateId : null;
      if (!phone || !templateId) {
        throw new OrderingError('CONFIG_INVALID', 'zalo zns send needs recipient phone and znsTemplateId');
      }
      const params =
        data.znsParams && typeof data.znsParams === 'object' && !Array.isArray(data.znsParams)
          ? data.znsParams
          : {};
      const trackingId = String(data.trackingId ?? '').slice(0, 48) || undefined;
      const payload = {
        phone,
        template_id: templateId,
        template_data: params,
        ...(trackingId ? { tracking_id: trackingId } : {}),
      };

      // One retry: `-124` means the token died — refresh once (when OAuth is configured) then
      // re-send; a second rejection or any other code fails the delivery row.
      let refreshed = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const tokenValue = await accessToken(settings, refreshed);
        const response = await client(settings).postJson('/message/template', payload, {
          access_token: tokenValue,
        });
        const body = jsonObject(response);
        const code = body?.error;
        if (code === 0) {
          const msgId = jsonObject({ status: 0, body: body?.data })?.msg_id;
          return { providerMessageId: typeof msgId === 'string' ? msgId : undefined };
        }
        if (code === -124 && !settings.accessToken && !refreshed) {
          refreshed = true;
          continue;
        }
        throw zaloError(code ?? response.status);
      }
      throw zaloError(-124);
    },
  };
};

export const zaloSettingsFromConfig = (notificationProviders: unknown): ZaloSettings | null =>
  parseZaloSettings((notificationProviders as { zalo?: unknown } | undefined)?.zalo);
