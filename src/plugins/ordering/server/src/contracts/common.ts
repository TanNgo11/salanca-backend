import type { Money } from '../domain/money';

/** Common types shared by every contract (contracts doc §3, §21.4). Pure types only. */
export type JsonObject = Record<string, unknown>;
export type Locale = string;

export type AddressSnapshot = {
  recipientName: string;
  phone: string;
  line1: string;
  provinceCode?: string;
  wardCode?: string;
  provinceName?: string;
  wardName?: string;
  note?: string;
};

export type SlotSelection = {
  scheduleRef: string;
  resourceRef?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type ReceiveMethod =
  | { kind: 'pickup'; locationRef: string }
  | { kind: 'delivery'; address: AddressSnapshot; providerCode?: string }
  | { kind: 'appointment'; locationRef: string; slot: SlotSelection };

export type ValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string; details?: JsonObject };

export type SelectedOptionInput = { groupUid: string; optionUid: string; quantity: number };

export type AdapterContext = { now: string; locationRef?: string; channel?: string };

export type AvailabilityResult = {
  available: boolean;
  reasonCode?: string;
  availableQuantity?: number;
};

export type Hold = { id: string; expiresAt: string; quantity: number; resourceRef?: string };

export type ConsentSnapshot = {
  policyVersion: string;
  acceptedAt: string;
  channel: 'web-checkout' | 'phone-staff';
  actorRef?: string;
  marketingOptIn: boolean;
};

export type Adjustment = {
  code: string;
  label: string;
  amount: Money;
  priority: number;
  taxable: boolean;
};

export type QuoteTotals = {
  subtotal: Money;
  adjustmentTotal: Money;
  fulfillmentTotal: Money;
  taxTotal: Money;
  grandTotal: Money;
};

export type Quote = {
  quoteVersion: string;
  cartHash: string;
  lines: JsonObject[];
  adjustments: Adjustment[];
  totals: QuoteTotals;
};
