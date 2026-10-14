import type { NotificationProvider } from '../../contracts';
import { OrderingError } from '../../domain/errors';
import type { ProviderHttpClient } from '../_http';
import { createProviderHttp, jsonObject } from '../_http';
import { parseEsmsSettings, type EsmsSettings } from './config';

const SEND_PATH = '/MainService.svc/json/SendMultipleMessage_V4_post_json/';
const SMS_MAX_CHARS = 450;

/** `+84xxxxxxxxx` → `84xxxxxxxxx`. */
const esmsPhone = (e164: string): string => e164.replace(/^\+/, '');

const esmsError = (code: unknown): OrderingError =>
  new OrderingError('PROVIDER_UNAVAILABLE', 'esms rejected the sms send', {
    details: { reason: `esms-code:${String(code ?? 'no-json-response')}` },
  });

/**
 * eSMS.vn `SendMultipleMessage_V4` (docs/providers/sms-esms.md, O13 step 6). `RequestId` is the
 * delivery-log row id (`nd-<id>`): eSMS dedupes it for 24h and answers `124` on a repeat, which
 * we treat as already accepted — never a resend. Secrets stay in env; only `CodeResult` numbers
 * surface in errors. `data.smsText` is the rendered text copy (≤450 chars, provider limit).
 */
export const createEsmsNotificationProvider = (deps: {
  settings: () => EsmsSettings | null;
  /** Injectable for tests; default builds a bounded client per send from the env base URL. */
  client?: ProviderHttpClient;
}): NotificationProvider => {
  const requireSettings = (): EsmsSettings => {
    const settings = deps.settings();
    if (!settings) throw new OrderingError('CONFIG_INVALID', 'esms is not configured');
    return settings;
  };
  const client = (settings: EsmsSettings): ProviderHttpClient =>
    deps.client ?? createProviderHttp({ baseUrl: settings.baseUrl });

  return {
    async send({ recipient, data }) {
      const settings = requireSettings();
      const phone = esmsPhone(String(recipient.phone ?? ''));
      const content = String(data.smsText ?? data.text ?? '').slice(0, SMS_MAX_CHARS);
      const requestId = String(data.trackingId ?? '');
      if (!phone || !content || !requestId) {
        throw new OrderingError(
          'CONFIG_INVALID',
          'esms send needs recipient phone, sms text and trackingId',
        );
      }
      const response = await client(settings).postJson(SEND_PATH, {
        ApiKey: settings.apiKey,
        SecretKey: settings.secretKey,
        Phone: phone,
        Content: content,
        ...(settings.brandname ? { Brandname: settings.brandname } : {}),
        SmsType: settings.smsType,
        IsUnicode: settings.isUnicode ? '1' : '0',
        Sandbox: settings.sandbox ? '1' : '0',
        ...(settings.campaign ? { campaignid: settings.campaign } : {}),
        RequestId: requestId,
      });
      const body = jsonObject(response);
      const code = String(body?.CodeResult ?? '');
      if (code === '100') {
        const smsId = body?.SMSID;
        return { providerMessageId: typeof smsId === 'string' ? smsId : undefined };
      }
      if (code === '124') return {}; // duplicate RequestId — already accepted upstream
      throw esmsError(code || response.status);
    },
  };
};

export const esmsSettingsFromConfig = (notificationProviders: unknown): EsmsSettings | null =>
  parseEsmsSettings((notificationProviders as { sms?: unknown } | undefined)?.sms);
