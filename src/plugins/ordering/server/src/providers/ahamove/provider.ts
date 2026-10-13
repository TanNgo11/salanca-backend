import type {
  CarrierBooking,
  CarrierEndpoint,
  CarrierStatusEvent,
  FulfillmentProvider,
} from '../../contracts/fulfillment';
import { quoteDelivery, type DeliveryZone } from '../../domain/delivery/zones';
import { OrderingError } from '../../domain/errors';
import type { Money } from '../../domain/money';
import { equalSecret } from '../../domain/signatures';
import type { ProviderHttpClient, ProviderResponse } from '../_http';
import { createProviderHttp, jsonObject } from '../_http';
import {
  ahamoveBaseUrl,
  parseAhamoveSettings,
  type AhamoveSettings,
} from './config';

/**
 * Ahamove v3 carrier provider (docs/providers/ahamove.md). Booking is staff-initiated
 * ("Gọi xe"), never automatic at order placement; the webhook token is the only carrier→plugin
 * credential and travels in the `apikey` header (constant-time compare). Trip states map to
 * the delivery leg per the doc table — the raw status rides `carrierStatus`.
 */

const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const num = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Ahamove order statuses that still allow DELETE /orders/{id} (docs). */
const CANCELLABLE = new Set(['IDLE', 'ASSIGNING', 'ACCEPTED', 'CONFIRMING', 'PAYING']);

const STATUS_MAP: Record<string, CarrierStatusEvent['status']> = {
  IDLE: 'searching',
  ASSIGNING: 'searching',
  ACCEPTED: 'booked',
  CONFIRMING: 'booked',
  PAYING: 'booked',
  'IN PROCESS': 'in-process',
  COMPLETED: 'delivered',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
};

const invalidPayload = (reason: string): OrderingError =>
  new OrderingError('VALIDATION_ERROR', 'invalid ahamove webhook payload', {
    details: { reason: 'invalid-payload', detail: reason },
  });

const bookingError = (reason: string): OrderingError =>
  new OrderingError('CARRIER_BOOKING_FAILED', 'the carrier could not book this trip', {
    details: { reason },
  });

/** Ahamove error body: `{code?, error?, message?}` — only the code is safe to echo. */
const carrierReason = (body: Record<string, unknown> | null, status: number): string =>
  str(body?.code) || str(body?.error) || `http-${status}`;

type AddressSnapshotLike = {
  line1?: string;
  wardName?: string;
  provinceName?: string;
  recipientName?: string;
  phone?: string;
};

/** `[line1, wardName, provinceName]` — the only address text the carrier receives. */
export const addressText = (snapshot: AddressSnapshotLike | null | undefined): string =>
  [snapshot?.line1, snapshot?.wardName, snapshot?.provinceName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(', ');

export const endpointOf = (snapshot: AddressSnapshotLike | null | undefined): CarrierEndpoint => ({
  address: addressText(snapshot),
  lat: 0,
  lng: 0,
  ...(snapshot?.recipientName ? { name: snapshot.recipientName } : {}),
  ...(snapshot?.phone ? { phone: snapshot.phone } : {}),
});

export const createAhamoveProvider = (deps: {
  settings: () => AhamoveSettings | null;
  /** Branch-zone fees when `feeSource: 'zone'` (same dep as self-delivery). */
  zonesFor: (locationRef: string) => Promise<DeliveryZone[]> | DeliveryZone[];
  /** Injectable for tests; default builds a bounded client per call. */
  client?: ProviderHttpClient;
}): FulfillmentProvider => {
  const requireSettings = (): AhamoveSettings => {
    const settings = deps.settings();
    if (!settings) {
      throw new OrderingError('CARRIER_NOT_CONFIGURED', 'ahamove is not configured', {
        details: { providerCode: 'ahamove' },
      });
    }
    return settings;
  };
  const client = (settings: AhamoveSettings): ProviderHttpClient =>
    deps.client ?? createProviderHttp({ baseUrl: ahamoveBaseUrl(settings) });

  // Bearer token: lazy authenticate then cache in memory; a restart simply re-authenticates.
  let cachedToken: string | null = null;
  const token = async (settings: AhamoveSettings, force = false): Promise<string> => {
    if (!force) {
      if (settings.token) return settings.token;
      if (cachedToken) return cachedToken;
    }
    if (settings.mobile === undefined) {
      throw new OrderingError('CARRIER_NOT_CONFIGURED', 'ahamove needs mobile or a fixed token', {
        details: { providerCode: 'ahamove' },
      });
    }
    const response = await client(settings).postJson('/v3/accounts/token', {
      mobile: settings.mobile,
      api_key: settings.apiKey,
    });
    const body = jsonObject(response);
    const value = str(body?.token);
    if (response.status !== 200 || value === '') {
      throw bookingError(carrierReason(body, response.status));
    }
    cachedToken = value;
    return value;
  };

  /** Authorized call; a 401 clears the cached token and retries once (expired token). */
  const call = async (
    settings: AhamoveSettings,
    run: (http: ProviderHttpClient, headers: Record<string, string>) => Promise<ProviderResponse>,
  ): Promise<ProviderResponse> => {
    const http = client(settings);
    const headers = { Authorization: `Bearer ${await token(settings)}` };
    const first = await run(http, headers);
    if (first.status !== 401 || settings.token) return first;
    cachedToken = null;
    return run(http, { Authorization: `Bearer ${await token(settings, true)}` });
  };

  const pathOf = (pickup: CarrierEndpoint, dropoff: CarrierEndpoint, codAmount: number) => [
    {
      lat: pickup.lat ?? 0,
      lng: pickup.lng ?? 0,
      address: pickup.address,
      ...(pickup.name ? { name: pickup.name } : {}),
      ...(pickup.phone ? { mobile: pickup.phone } : {}),
    },
    {
      lat: dropoff.lat ?? 0,
      lng: dropoff.lng ?? 0,
      address: dropoff.address,
      ...(dropoff.name ? { name: dropoff.name } : {}),
      ...(dropoff.phone ? { mobile: dropoff.phone } : {}),
      cod: codAmount,
    },
  ];

  const estimate = async (
    settings: AhamoveSettings,
    pickup: CarrierEndpoint,
    dropoff: CarrierEndpoint,
    serviceId: string,
    codAmount: number,
  ): Promise<Money> => {
    const response = await call(settings, (http, headers) =>
      http.postJson(
        '/v3/orders/estimates',
        {
          order_time: 0,
          path: pathOf(pickup, dropoff, codAmount),
          services: [{ _id: serviceId, requests: settings.requests }],
        },
        headers,
      ),
    );
    const body = jsonObject(response);
    const data = Array.isArray(body?.data) ? (body.data as unknown[]) : [];
    const first = (data[0] ?? null) as Record<string, unknown> | null;
    const fee = num(first?.total_fee ?? first?.fee);
    if (response.status !== 200 || fee === undefined) {
      throw bookingError(carrierReason(body, response.status));
    }
    return { amount: fee, currency: 'VND' };
  };

  return {
    code: 'ahamove',
    capabilities: [
      'quote',
      'delivery',
      'carrier',
      'signed-webhook',
      ...(deps.settings()?.feeSource === 'carrier' ? ['carrier-pricing'] : []),
    ],

    async getOptions() {
      const settings = deps.settings();
      return settings ? [{ serviceId: settings.serviceId }] : [];
    },

    async validate(input) {
      const settings = deps.settings();
      if (settings?.feeSource === 'carrier') {
        // Carrier pricing only needs a usable address text; the estimate is the real check.
        return typeof input.option.address === 'object' && input.option.address !== null
          ? { valid: true }
          : { valid: false, code: 'DELIVERY_UNAVAILABLE', message: 'a delivery address is required' };
      }
      const communeCode = str(input.option.communeCode).trim().toUpperCase();
      const quoted = quoteDelivery(
        await deps.zonesFor(input.order.locationRef ?? str(input.option.locationRef)),
        {
          communeCode,
          subtotal: num(input.option.subtotal) ?? 0,
        },
      );
      if (!quoted.available) {
        return {
          valid: false,
          code: 'DELIVERY_UNAVAILABLE',
          message: 'delivery is not available for this commune',
          details: {
            communeCode,
            reason: quoted.reason,
            ...(quoted.minOrderAmount !== undefined ? { minOrderAmount: quoted.minOrderAmount } : {}),
          },
        };
      }
      return { valid: true };
    },

    async calculatePrice(input): Promise<Money> {
      const settings = requireSettings();
      if (settings.feeSource === 'zone') {
        const quoted = quoteDelivery(
          await deps.zonesFor(input.order.locationRef ?? str(input.option.locationRef)),
          {
            communeCode: str(input.option.communeCode).trim().toUpperCase(),
            subtotal: num(input.option.subtotal) ?? 0,
          },
        );
        if (!quoted.available) {
          throw new OrderingError('DELIVERY_UNAVAILABLE', 'delivery is not available for this commune', {
            details: {
              communeCode: str(input.option.communeCode).trim().toUpperCase(),
              reason: quoted.reason,
              ...(quoted.minOrderAmount !== undefined ? { minOrderAmount: quoted.minOrderAmount } : {}),
            },
          });
        }
        return { amount: quoted.fee, currency: 'VND' };
      }
      const dropoff = endpointOf(input.option.address as AddressSnapshotLike | undefined);
      if (dropoff.address === '') {
        throw new OrderingError('DELIVERY_UNAVAILABLE', 'a delivery address is required', {
          details: { reason: 'missing-address' },
        });
      }
      return estimate(
        settings,
        { address: str(input.option.pickupAddress) },
        dropoff,
        typeof input.option.serviceId === 'string' ? input.option.serviceId : settings.serviceId,
        num(input.option.codAmount) ?? 0,
      );
    },

    // Booking is manual ("Gọi xe"); order placement never calls the carrier.
    async create() {
      return {};
    },

    async quoteCarrier(input) {
      const settings = requireSettings();
      const serviceId = str(input.option?.serviceId) || settings.serviceId;
      const fee = await estimate(settings, input.pickup, input.dropoff, serviceId, input.codAmount);
      return [{ providerCode: 'ahamove', serviceId, fee }];
    },

    async book(input): Promise<CarrierBooking> {
      const settings = requireSettings();
      if (input.pickup.address === '' || input.dropoff.address === '') {
        throw bookingError('missing-address');
      }
      const serviceId = str(input.option?.serviceId) || settings.serviceId;
      const response = await call(settings, (http, headers) =>
        http.postJson(
          '/v3/orders',
          {
            order_time: 0,
            service_id: serviceId,
            payment_method: settings.paymentMethod,
            requests: settings.requests,
            remarks: input.remarks ?? '',
            path: [
              { ...pathOf(input.pickup, input.dropoff, input.codAmount)[0], remarks: '' },
              { ...pathOf(input.pickup, input.dropoff, input.codAmount)[1], remarks: input.note ?? '' },
            ],
          },
          headers,
        ),
      );
      const body = jsonObject(response);
      const carrierRef = str(body?.order_id ?? body?._id ?? body?.id);
      if (response.status !== 200 || carrierRef === '') {
        throw bookingError(carrierReason(body, response.status));
      }
      const trackingUrl =
        str(body?.shared_link) ||
        str(body?.tracking_link) ||
        (Array.isArray(body?.path)
          ? str((body.path[1] as Record<string, unknown> | undefined)?.tracking_link)
          : '');
      const carrierFee = num(body?.total_fee ?? body?.fee);
      return {
        carrierRef,
        carrierStatus: str(body?.status) || 'IDLE',
        ...(trackingUrl !== '' ? { trackingUrl } : {}),
        ...(carrierFee !== undefined ? { carrierFee } : {}),
      };
    },

    async cancel(input) {
      const settings = requireSettings();
      const carrierRef = str((input.fulfillment as { providerReference?: unknown }).providerReference);
      if (carrierRef === '') throw bookingError('missing-carrier-ref');
      const status = str((input.fulfillment as { carrierStatus?: unknown }).carrierStatus).toUpperCase();
      if (status !== '' && !CANCELLABLE.has(status)) {
        throw bookingError('not-cancellable');
      }
      const response = await call(settings, (http, headers) =>
        http.deleteJson(
          `/v3/orders/${encodeURIComponent(carrierRef)}`,
          { comment: input.reason.slice(0, 200) },
          headers,
        ),
      );
      if (response.status !== 200) {
        throw bookingError(carrierReason(jsonObject(response), response.status));
      }
    },

    async parseCarrierWebhook(input) {
      const settings = requireSettings();
      if (!equalSecret(input.headers['apikey'], settings.webhookToken)) {
        throw new OrderingError('WEBHOOK_SIGNATURE_INVALID', 'ahamove webhook token rejected', {
          details: { reason: 'bad-apikey' },
        });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(input.body);
      } catch {
        throw invalidPayload('not-json');
      }
      const body = (payload ?? {}) as Record<string, unknown>;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw invalidPayload('not-an-object');
      }
      const carrierRef = str(body._id ?? body.order_id ?? body.id);
      if (carrierRef === '') throw invalidPayload('missing-order-id');
      const rawStatus = str(body.status).toUpperCase();
      const status = STATUS_MAP[rawStatus];
      if (!status) return []; // valid but uninteresting — still ACKed 200 so Ahamove does not retry
      const driverRaw = (body.supplier ?? body.driver ?? {}) as Record<string, unknown>;
      const driverName = str(driverRaw.name ?? body.supplier_name ?? body.driver_name);
      const driverPhone = str(driverRaw.mobile ?? driverRaw.phone ?? body.supplier_phone ?? body.driver_phone);
      const phoneMasked = driverPhone === '' ? '' : `***${driverPhone.slice(-4)}`;
      const trackingUrl =
        str(body.shared_link) ||
        str(body.tracking_link) ||
        (Array.isArray(body.path)
          ? str((body.path[1] as Record<string, unknown> | undefined)?.tracking_link)
          : '');
      return [
        {
          carrierRef,
          status,
          carrierStatus: rawStatus,
          ...(driverName !== '' || phoneMasked !== ''
            ? {
                driver: {
                  ...(driverName !== '' ? { name: driverName } : {}),
                  ...(phoneMasked !== '' ? { phoneMasked } : {}),
                },
              }
            : {}),
          ...(trackingUrl !== '' ? { trackingUrl } : {}),
          ...(num(body.total_fee ?? body.fee) !== undefined
            ? { carrierFee: num(body.total_fee ?? body.fee) }
            : {}),
          ...(str(body.sub_status) !== '' ? { reasonCode: str(body.sub_status) } : {}),
        },
      ];
    },

    carrierWebhookResponse({ result }) {
      if (result === 'invalid-signature') return { status: 401 };
      if (result === 'invalid-payload') return { status: 400 };
      return { status: 200, body: { success: true } };
    },
  };
};

export const ahamoveSettingsFromConfig = (fulfillmentProviders: unknown): AhamoveSettings | null => {
  const ahamove = (fulfillmentProviders as { ahamove?: unknown } | undefined)?.ahamove;
  return parseAhamoveSettings(ahamove);
};
