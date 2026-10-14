import type { JsonObject, ValidationResult } from './common';
import type { Money } from '../domain/money';
import type { Fulfillment, FulfillmentGroup, Order } from './entities';
import type { RawWebhook } from './payment';

/**
 * O13 carriers (Ahamove): one stop of a booked trip. `lat`/`lng` may be 0 — the carrier
 * geocodes the address text itself (docs/providers/ahamove.md).
 */
export type CarrierEndpoint = {
  address: string;
  lat?: number;
  lng?: number;
  name?: string;
  phone?: string;
};

/** A bookable service option for the "Gọi xe" panel (screens P2). */
export type CarrierQuote = {
  providerCode: string;
  serviceId: string;
  fee: Money;
};

/** What a successful booking returns — stored on the fulfillment row. */
export type CarrierBooking = {
  /** The carrier's trip id (Ahamove `order_id`). Stored as `fulfillment.providerReference`. */
  carrierRef: string;
  /** Raw carrier status at booking time (e.g. `IDLE`); kept verbatim in `carrierStatus`. */
  carrierStatus?: string;
  trackingUrl?: string;
  /** The fee the carrier actually charges (VND integer) — the customer fee may differ. */
  carrierFee?: number;
};

/**
 * A normalized carrier status push (O13). `status` is the plugin-side mapping; the raw carrier
 * status rides `carrierStatus` so the ledger keeps the provider's own words.
 */
export type CarrierStatusEvent = {
  carrierRef: string;
  status: 'searching' | 'booked' | 'in-process' | 'delivered' | 'cancelled' | 'failed';
  /** Raw status string from the carrier payload (e.g. `IN PROCESS`). */
  carrierStatus?: string;
  driver?: { name?: string; phoneMasked?: string };
  trackingUrl?: string;
  carrierFee?: number;
  reasonCode?: string;
};

export type CarrierWebhookResult = 'accepted' | 'invalid-signature' | 'invalid-payload';

/** Fulfillment provider contract; the provider never writes order status itself (doc §5). */
export interface FulfillmentProvider {
  code: string;
  capabilities: string[];
  getOptions(input: { order: Order; group: FulfillmentGroup }): Promise<JsonObject[]>;
  validate(input: {
    order: Order;
    group: FulfillmentGroup;
    option: JsonObject;
  }): Promise<ValidationResult>;
  calculatePrice(input: {
    order: Order;
    group: FulfillmentGroup;
    option: JsonObject;
  }): Promise<Money>;
  create(input: { order: Order; group: FulfillmentGroup; option: JsonObject }): Promise<{
    providerReference?: string;
    trackingNumber?: string;
    trackingUrl?: string;
  }>;
  cancel?(input: { fulfillment: Fulfillment; reason: string }): Promise<void>;
  getDocuments?(input: { fulfillment: Fulfillment }): Promise<JsonObject[]>;

  // --- O13 carrier lifecycle (providers that can actually book a courier) ---
  /**
   * Live carrier fee for the staff booking panel — always the carrier's own quote, even when
   * `feeSource: 'zone'` prices the customer leg from zones.
   */
  quoteCarrier?(input: {
    pickup: CarrierEndpoint;
    dropoff: CarrierEndpoint;
    /** Collect-on-delivery amount in VND (the order's unpaid remainder). */
    codAmount: number;
    option?: JsonObject;
  }): Promise<CarrierQuote[]>;
  /**
   * Books one trip. The caller holds a lock on the fulfillment row — a second click finds
   * `providerReference` already set and never reaches the provider.
   */
  book?(input: {
    pickup: CarrierEndpoint;
    dropoff: CarrierEndpoint;
    codAmount: number;
    /** Staff note for the courier (free text, ≤200 chars). */
    note?: string;
    /** Order code as the trip remark so the driver can name the parcel. */
    remarks?: string;
    option?: JsonObject;
  }): Promise<CarrierBooking>;
  /** Parses + authenticates a carrier status push. Throws WEBHOOK_SIGNATURE_INVALID / VALIDATION_ERROR. */
  parseCarrierWebhook?(input: RawWebhook): Promise<CarrierStatusEvent[]>;
  /** Carrier-specific webhook ACK (Ahamove answers 200 `{success:true}` to anything valid). */
  carrierWebhookResponse?(input: { result: CarrierWebhookResult }): {
    status: number;
    body?: JsonObject;
  };
}
